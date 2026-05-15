-- Ticket numbers for S2D items.
--
-- Every S2D item gets a stable, human-readable ID like MASH-123. The
-- underlying integer is monotonically increasing across the whole board
-- so the user can reference any task by "MASH-N" anywhere — in chat, in
-- briefings, in notes.
--
-- Why a sequence + UNIQUE column rather than computed-from-id:
--   - Sortable as an integer, not a uuid
--   - Stable across schema changes (we don't reuse numbers on delete)
--   - Cheap to display, cheap to search
--
-- Single-user dev app: global counter is fine. If we ever go multi-tenant
-- we'd swap this for a per-user counter.

CREATE SEQUENCE IF NOT EXISTS s2d_ticket_seq;

ALTER TABLE s2d_items
  ADD COLUMN IF NOT EXISTS ticket_number INTEGER;

-- Backfill existing rows in creation order so the oldest item gets MASH-1.
DO $$
DECLARE
  r RECORD;
  n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id FROM s2d_items
    WHERE ticket_number IS NULL
    ORDER BY created_at ASC, id ASC
  LOOP
    n := n + 1;
    UPDATE s2d_items SET ticket_number = n WHERE id = r.id;
  END LOOP;

  -- Advance the sequence past the highest backfilled value so new
  -- inserts continue from there.
  IF n > 0 THEN
    PERFORM setval('s2d_ticket_seq', n);
  END IF;
END $$;

-- New rows get auto-assigned
ALTER TABLE s2d_items
  ALTER COLUMN ticket_number SET DEFAULT nextval('s2d_ticket_seq');

ALTER TABLE s2d_items
  ALTER COLUMN ticket_number SET NOT NULL;

ALTER TABLE s2d_items
  ADD CONSTRAINT s2d_items_ticket_number_key UNIQUE (ticket_number);

CREATE INDEX IF NOT EXISTS s2d_ticket_number_idx
  ON s2d_items (ticket_number);
