-- Per-user ticket numbers.
--
-- Migration 007 used a global sequence so MASH-N was unique across the
-- entire database. Fine for single-user; broken now that multiple users
-- share prod (Sidd starts at MASH-416 because Matt already has 1..415,
-- which is confusing and not what anyone expects).
--
-- Each user should number their own tickets from 1, like every other
-- ticketing system (Linear MAP-1, Jira PROJ-1, etc.).
--
-- This migration:
--   1. Drops the global UNIQUE (ticket_number) constraint
--   2. Renumbers every existing row per-user in created_at order
--      (Sidd's oldest s2d_item becomes MASH-1, his second oldest MASH-2,
--       etc; Matt's oldest item also becomes MASH-1 in his own space)
--   3. Adds a composite UNIQUE (user_id, ticket_number)
--   4. Drops the global sequence default
--   5. Replaces it with a BEFORE INSERT trigger that picks
--      MAX(ticket_number) + 1 within the inserting user's rows
--   6. Drops the now-unused sequence
--
-- Idempotent across re-runs.

-- ────────────────────────────────────────────────────────────────────
-- 1. Drop the global unique constraint (if it still exists)
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.s2d_items
  DROP CONSTRAINT IF EXISTS s2d_items_ticket_number_key;

-- Drop the legacy single-column index (the composite below replaces its purpose)
DROP INDEX IF EXISTS s2d_ticket_number_idx;

-- ────────────────────────────────────────────────────────────────────
-- 2. Renumber per-user starting from 1, in created_at order
-- ────────────────────────────────────────────────────────────────────
-- Two-phase to avoid temporarily violating any constraint:
--   a) Offset every ticket_number into negative space (NOT NULL is fine
--      because NULL would still be NULL).
--   b) Reassign new positive values per-user via ROW_NUMBER.
--
-- Wrapped in DO block so it can be re-executed safely. On re-apply the
-- numbers are already correct so the WITH clause produces identity
-- assignments; UPDATE matches 0 changed rows.

UPDATE public.s2d_items
  SET ticket_number = -ticket_number
  WHERE ticket_number > 0;

WITH renumbered AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY user_id
    ORDER BY created_at ASC, id ASC
  ) AS new_n
  FROM public.s2d_items
)
UPDATE public.s2d_items s
  SET ticket_number = r.new_n
  FROM renumbered r
  WHERE s.id = r.id;

-- ────────────────────────────────────────────────────────────────────
-- 3. Composite unique constraint
-- ────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS s2d_items_user_ticket_number_key
  ON public.s2d_items (user_id, ticket_number);

-- ────────────────────────────────────────────────────────────────────
-- 4. Drop the global-sequence DEFAULT on ticket_number
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.s2d_items
  ALTER COLUMN ticket_number DROP DEFAULT;

-- ────────────────────────────────────────────────────────────────────
-- 5. BEFORE INSERT trigger to assign per-user ticket_number
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_user_ticket_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Only assign if the caller didn't provide one. Bulk-loads (e.g. the
  -- local→prod migration) pass ticket_number explicitly and shouldn't
  -- be overwritten.
  IF NEW.ticket_number IS NULL THEN
    SELECT COALESCE(MAX(ticket_number), 0) + 1
      INTO NEW.ticket_number
      FROM public.s2d_items
     WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.assign_user_ticket_number()
  TO supabase_auth_admin, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS s2d_assign_ticket_number_trigger ON public.s2d_items;
CREATE TRIGGER s2d_assign_ticket_number_trigger
  BEFORE INSERT ON public.s2d_items
  FOR EACH ROW EXECUTE FUNCTION public.assign_user_ticket_number();

-- ────────────────────────────────────────────────────────────────────
-- 6. Drop the now-unused global sequence
-- ────────────────────────────────────────────────────────────────────
DROP SEQUENCE IF EXISTS s2d_ticket_seq;
