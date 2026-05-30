-- 043_agent_attachments.sql
--
-- Mashi Agent buildout — P3 / B1 (image paste + file upload).
--
-- Two additive changes:
--
--   1. `agent_messages.attachments` — a JSONB array of attachment
--      descriptors (pointer + metadata, never bytes) persisted on the user
--      message row. Shape (each element):
--        { "kind": "image"|"document", "storagePath": "<uid>/<uuid>.<ext>",
--          "mime": "image/png", "name": "screenshot.png", "size": 12345 }
--      The loop emits a placeholder content block per descriptor on every
--      turn and resolves it to a real Anthropic image/document block by
--      downloading the bytes. NULL for every message without attachments.
--
--   2. The private `agent-attachments` Storage bucket + owner-only RLS on
--      storage.objects, scoped by the first path segment === auth.uid().
--      The composer uploads directly with the browser (anon) client, so
--      RLS confines each user to their own `${uid}/` prefix; the server
--      re-validates the prefix before downloading with the service role.
--
-- Additive + idempotent per AGENTS.md migration discipline: ADD COLUMN IF
-- NOT EXISTS, ON CONFLICT DO NOTHING for the bucket, and pg_policies
-- guards (CREATE POLICY has no IF NOT EXISTS) so re-running is a no-op.

ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS attachments JSONB NULL;

COMMENT ON COLUMN public.agent_messages.attachments IS
  'B1 (P3): JSONB array of attachment descriptors on the user message row {kind, storagePath, mime, name, size}. Bytes live in the agent-attachments Storage bucket; this is the pointer. NULL when the message has no attachments.';

-- Private bucket. 32MB hard ceiling at the bucket layer (per-kind app caps
-- in src/lib/agent/attachments.ts are tighter); allowed_mime_types left
-- NULL so the app layer owns mime policy.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('agent-attachments', 'agent-attachments', false, 33554432)
ON CONFLICT (id) DO NOTHING;

-- Owner-only RLS: the authenticated user may only touch objects whose
-- first folder segment equals their uid. Mirrors the public.* owner-only
-- doctrine for the storage.objects table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'agent_attachments_owner_select'
  ) THEN
    CREATE POLICY "agent_attachments_owner_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'agent-attachments'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'agent_attachments_owner_insert'
  ) THEN
    CREATE POLICY "agent_attachments_owner_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'agent-attachments'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'agent_attachments_owner_update'
  ) THEN
    CREATE POLICY "agent_attachments_owner_update" ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'agent-attachments'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'agent-attachments'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'agent_attachments_owner_delete'
  ) THEN
    CREATE POLICY "agent_attachments_owner_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'agent-attachments'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;
