-- ============================================================================
-- RLS / tenant-isolation assertions — run against ANY live database
-- ============================================================================
--
-- Purpose: the static audit (MULTITENANCY_AUDIT.md) verifies the MIGRATIONS.
-- This script verifies the LIVE DATABASE, closing the "migrations != reality"
-- drift gap (a policy dropped/altered by hand in the dashboard, a table created
-- out-of-band, RLS toggled off). Run it in the Supabase SQL editor or via:
--
--   supabase db execute --file supabase/tests/rls_assertions.sql   (or psql)
--
-- It first PRINTS a full diagnostic report (sections 1-5), then RAISES an
-- exception (section 6) if any tenant table is not owner-only. Wire section 6
-- into CI to fail the build on drift.
--
-- "Owner-only" = RLS enabled AND, for every command, the policy restricts to
-- auth.uid() = user_id (USING for SELECT/DELETE/UPDATE, WITH CHECK for
-- INSERT/UPDATE). Tables that are intentionally global live in the allowlist
-- below and are exempt.
-- ============================================================================

-- Tables that are intentionally NOT tenant-scoped. Keep this list short and
-- justified; every entry is a deliberate exception reviewed in the audit.
--   signup_allowlist  — gates who may become a tenant; predates any user.
-- (auth.*, storage.*, and other non-public schemas are excluded by scope.)
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Tables with RLS DISABLED (anon/auth key can read everything) — CRITICAL
-- ---------------------------------------------------------------------------
SELECT '1. RLS DISABLED' AS check, c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND c.relname NOT IN ('signup_allowlist', 'schema_migrations')
ORDER BY c.relname;

-- ---------------------------------------------------------------------------
-- 2. Tables MISSING a user_id column (potential shared/global tables)
-- ---------------------------------------------------------------------------
SELECT '2. NO user_id COLUMN' AS check, c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname NOT IN ('signup_allowlist', 'schema_migrations')
  AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND a.attnum > 0 AND NOT a.attisdropped
  )
ORDER BY c.relname;

-- ---------------------------------------------------------------------------
-- 3. Tables with RLS ENABLED but ZERO policies (locked / service-role-only)
-- ---------------------------------------------------------------------------
SELECT '3. RLS ENABLED, NO POLICIES' AS check, c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = true
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
  )
ORDER BY c.relname;

-- ---------------------------------------------------------------------------
-- 4. PERMISSIVE / non-owner-scoped policies — the ai_usage_log class of bug
--    Flags any policy whose USING or WITH CHECK is `true` or omits auth.uid().
-- ---------------------------------------------------------------------------
SELECT '4. LOOSE POLICY' AS check,
       p.tablename, p.policyname, p.cmd,
       p.qual        AS using_expr,
       p.with_check  AS with_check_expr
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename NOT IN ('signup_allowlist')
  AND (
        -- SELECT/DELETE must scope via USING(auth.uid()=user_id)
        (p.cmd IN ('SELECT','DELETE') AND (p.qual IS NULL OR p.qual = 'true' OR p.qual NOT ILIKE '%auth.uid()%'))
        -- INSERT must scope via WITH CHECK(auth.uid()=user_id)
     OR (p.cmd = 'INSERT' AND (p.with_check IS NULL OR p.with_check = 'true' OR p.with_check NOT ILIKE '%auth.uid()%'))
        -- UPDATE must scope on BOTH
     OR (p.cmd = 'UPDATE' AND (p.qual IS NULL OR p.qual = 'true' OR p.qual NOT ILIKE '%auth.uid()%'
                               OR p.with_check IS NULL OR p.with_check = 'true' OR p.with_check NOT ILIKE '%auth.uid()%'))
        -- ALL must scope on both
     OR (p.cmd = 'ALL' AND (p.qual IS NULL OR p.qual = 'true' OR p.qual NOT ILIKE '%auth.uid()%'
                            OR p.with_check IS NULL OR p.with_check = 'true' OR p.with_check NOT ILIKE '%auth.uid()%'))
      )
ORDER BY p.tablename, p.cmd;

-- ---------------------------------------------------------------------------
-- 5. Storage buckets that are PUBLIC, and storage.objects policies
-- ---------------------------------------------------------------------------
SELECT '5a. PUBLIC BUCKET' AS check, id AS bucket, public
FROM storage.buckets WHERE public = true;

SELECT '5b. STORAGE POLICY' AS check, policyname, cmd, qual AS using_expr, with_check AS with_check_expr
FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- ---------------------------------------------------------------------------
-- 6. HARD ASSERTION — raises if any tenant table is not owner-only.
--    Wire into CI; non-zero exit on violation.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_global text[] := ARRAY['signup_allowlist','schema_migrations'];
  v_bad text;
  v_violations text := '';
BEGIN
  -- RLS disabled
  FOR v_bad IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false
      AND NOT (c.relname = ANY(v_global))
  LOOP
    v_violations := v_violations || format('  [RLS OFF] %s%s', v_bad, E'\n');
  END LOOP;

  -- loose policies
  FOR v_bad IN
    SELECT format('%s.%s (%s)', p.tablename, p.policyname, p.cmd)
    FROM pg_policies p
    WHERE p.schemaname='public' AND NOT (p.tablename = ANY(v_global))
      AND (
            (p.cmd IN ('SELECT','DELETE') AND (p.qual IS NULL OR p.qual='true' OR p.qual NOT ILIKE '%auth.uid()%'))
         OR (p.cmd='INSERT' AND (p.with_check IS NULL OR p.with_check='true' OR p.with_check NOT ILIKE '%auth.uid()%'))
         OR (p.cmd='UPDATE' AND (p.qual IS NULL OR p.qual='true' OR p.qual NOT ILIKE '%auth.uid()%' OR p.with_check IS NULL OR p.with_check='true' OR p.with_check NOT ILIKE '%auth.uid()%'))
         OR (p.cmd='ALL' AND (p.qual IS NULL OR p.qual='true' OR p.qual NOT ILIKE '%auth.uid()%' OR p.with_check IS NULL OR p.with_check='true' OR p.with_check NOT ILIKE '%auth.uid()%'))
          )
  LOOP
    v_violations := v_violations || format('  [LOOSE]   %s%s', v_bad, E'\n');
  END LOOP;

  IF v_violations <> '' THEN
    RAISE EXCEPTION E'Tenant-isolation RLS violations found:\n%', v_violations;
  END IF;
  RAISE NOTICE 'RLS assertions passed: all public tenant tables are owner-only.';
END $$;
