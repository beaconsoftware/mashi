-- 023_status_invariants.sql
--
-- S2D task-movement reliability — Track 3 of Phase 1.
--
-- Codifies invariants the application has always assumed but never
-- enforced at the DB layer. The investigation (see INVESTIGATION.md
-- B5, C3, E5) found multiple bugs where the app drifted into states
-- it never expected:
--   - Cards stuck in `needs_review` while also being `in_progress`,
--     so they were neither visible in Review nor actionable in the
--     board.
--   - Activity-watcher suggestions targeting items still in Review,
--     which the matcher had no business proposing state-changes for.
--   - `done` rows with no `done_at`, `in_queue` rows with no
--     `queue_reason`, and `sprint_start_at` set on `backlog` /
--     `in_queue` items.
--
-- All constraints here are CHECK + NOT VALID so existing rows aren't
-- retroactively rejected — they enforce from this migration forward.
-- The DO blocks pre-flight via RAISE NOTICE (never EXCEPTION) per
-- AGENTS.md "works on empty + populated DBs".
--
-- Additive + idempotent. Safe to re-run; DROP CONSTRAINT IF EXISTS
-- before ADD, DROP TRIGGER IF EXISTS before CREATE.

-- ============================================================================
-- Pre-flight: count rows that would violate each new invariant. NEVER raise.
-- ============================================================================

DO $$
DECLARE
  bad_review_in_progress INT := 0;
  bad_done_without_done_at INT := 0;
  bad_in_queue_without_reason INT := 0;
  bad_sprint_start_with_wrong_status INT := 0;
  bad_suggestions_targeting_review INT := 0;
BEGIN
  -- B5: needs_review = true AND status = 'in_progress'
  SELECT COUNT(*) INTO bad_review_in_progress
    FROM public.s2d_items
    WHERE needs_review = true AND status = 'in_progress';
  IF bad_review_in_progress > 0 THEN
    RAISE NOTICE 'B5: % existing s2d_items have needs_review=true AND status=in_progress; new constraint is NOT VALID so they are tolerated, but app code should reconcile.', bad_review_in_progress;
  END IF;

  -- E5a: status = 'done' XOR done_at IS NOT NULL
  SELECT COUNT(*) INTO bad_done_without_done_at
    FROM public.s2d_items
    WHERE (status = 'done') <> (done_at IS NOT NULL);
  IF bad_done_without_done_at > 0 THEN
    RAISE NOTICE 'E5a: % existing s2d_items violate (status=done) <-> (done_at IS NOT NULL); constraint NOT VALID, app must reconcile.', bad_done_without_done_at;
  END IF;

  -- E5b: status = 'in_queue' => queue_reason IS NOT NULL
  SELECT COUNT(*) INTO bad_in_queue_without_reason
    FROM public.s2d_items
    WHERE status = 'in_queue' AND queue_reason IS NULL;
  IF bad_in_queue_without_reason > 0 THEN
    RAISE NOTICE 'E5b: % existing s2d_items are in_queue without queue_reason; constraint NOT VALID, app must reconcile.', bad_in_queue_without_reason;
  END IF;

  -- E5c: sprint_start_at IS NOT NULL => status IN ('todo','in_progress','done')
  SELECT COUNT(*) INTO bad_sprint_start_with_wrong_status
    FROM public.s2d_items
    WHERE sprint_start_at IS NOT NULL
      AND status NOT IN ('todo', 'in_progress', 'done');
  IF bad_sprint_start_with_wrong_status > 0 THEN
    RAISE NOTICE 'E5c: % existing s2d_items have sprint_start_at set but status is not in (todo,in_progress,done); constraint NOT VALID, app must reconcile.', bad_sprint_start_with_wrong_status;
  END IF;

  -- C3: activity_suggestions pointing at needs_review=true items
  SELECT COUNT(*) INTO bad_suggestions_targeting_review
    FROM public.activity_suggestions s
    JOIN public.s2d_items i ON i.id = s.s2d_item_id
    WHERE i.needs_review = true;
  IF bad_suggestions_targeting_review > 0 THEN
    RAISE NOTICE 'C3: % existing activity_suggestions point at needs_review=true s2d_items; trigger enforces forward only, app must reconcile.', bad_suggestions_targeting_review;
  END IF;
END $$;

-- ============================================================================
-- B5 — needs_review and in_progress are mutually exclusive
-- ============================================================================
--
-- A row in Review hasn't been adopted by the user yet, so it can't be
-- something they're actively working on. The two states represent
-- different lifecycle phases and should never overlap. Conflating them
-- produced the "ghost card" bug where an item disappeared from Review
-- (because status != recommended) but never appeared on the board
-- (because needs_review=true gates board visibility).

ALTER TABLE public.s2d_items
  DROP CONSTRAINT IF EXISTS s2d_items_review_not_in_progress;

ALTER TABLE public.s2d_items
  ADD CONSTRAINT s2d_items_review_not_in_progress
  CHECK (NOT (needs_review = true AND status = 'in_progress'))
  NOT VALID;

-- ============================================================================
-- E5a — status='done' <-> done_at IS NOT NULL
-- ============================================================================
--
-- Sprint history, "What did I ship?" rollups, and the sprint-complete
-- recap all rely on done_at as the timestamp of completion. If the app
-- ever sets status=done without stamping done_at (or clears done_at
-- without flipping status), those rollups silently lose the row.
-- done_at column was introduced in 001_initial_schema.sql.

ALTER TABLE public.s2d_items
  DROP CONSTRAINT IF EXISTS s2d_items_done_at_consistency;

ALTER TABLE public.s2d_items
  ADD CONSTRAINT s2d_items_done_at_consistency
  CHECK ((status = 'done') = (done_at IS NOT NULL))
  NOT VALID;

-- ============================================================================
-- E5b — status='in_queue' requires queue_reason
-- ============================================================================
--
-- The in_queue column on the S2D board groups items by why they're
-- parked (waiting on reply, blocked, scheduled, etc.). Without
-- queue_reason the UI can't render them in the right bucket and they
-- become orphaned. queue_reason column was introduced in 001.

ALTER TABLE public.s2d_items
  DROP CONSTRAINT IF EXISTS s2d_items_in_queue_requires_reason;

ALTER TABLE public.s2d_items
  ADD CONSTRAINT s2d_items_in_queue_requires_reason
  CHECK (status <> 'in_queue' OR queue_reason IS NOT NULL)
  NOT VALID;

-- ============================================================================
-- E5c — sprint_start_at only on actionable statuses
-- ============================================================================
--
-- sprint_start_at (added in 008_sprint_blocks.sql, replacing the older
-- sprint_date/sprint_type pair) is set when a user schedules an item
-- into a sprint block. A backlog or in_queue item should not be
-- claimed by a sprint — sprint membership presumes the item is ready
-- to work (todo), currently being worked (in_progress), or was worked
-- on during this sprint (done). If we ever set sprint_start_at while
-- in backlog/in_queue, the sprint UI renders ghost slots.

ALTER TABLE public.s2d_items
  DROP CONSTRAINT IF EXISTS s2d_items_sprint_start_status;

ALTER TABLE public.s2d_items
  ADD CONSTRAINT s2d_items_sprint_start_status
  CHECK (
    sprint_start_at IS NULL
    OR status IN ('todo', 'in_progress', 'done')
  )
  NOT VALID;

-- ============================================================================
-- C3 — activity_suggestions must target a non-review s2d_item
-- ============================================================================
--
-- The activity watcher proposes state changes (todo -> in_progress,
-- in_progress -> done) based on observed laptop activity. A row still
-- in Review hasn't been accepted onto the board yet, so its status
-- field is the AI's recommendation, not a user decision. Proposing
-- state changes against it short-circuits the Review gate and applies
-- changes to items the user never agreed to track.
--
-- Why a trigger, not a FK / generated column: we need to look across
-- two tables on INSERT/UPDATE of activity_suggestions, which a CHECK
-- constraint can't do (subqueries are forbidden in CHECK). The trigger
-- is BEFORE INSERT OR UPDATE so it short-circuits the write.
--
-- SECURITY DEFINER + pinned search_path follows AGENTS.md "Trigger
-- function discipline" — even though this trigger isn't on auth.users,
-- the same hygiene prevents search_path foot-guns and makes it safe
-- to invoke from any caller (service-role sync paths, user inserts).

CREATE OR REPLACE FUNCTION public.enforce_suggestion_targets_non_review_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_needs_review BOOLEAN;
BEGIN
  SELECT needs_review
    INTO target_needs_review
    FROM public.s2d_items
    WHERE id = NEW.s2d_item_id;

  IF target_needs_review IS NULL THEN
    -- Referenced s2d_item doesn't exist. The FK on activity_suggestions
    -- will reject this independently; leave the FK to surface the
    -- canonical error message.
    RETURN NEW;
  END IF;

  IF target_needs_review = true THEN
    RAISE EXCEPTION
      'activity_suggestion (id=%) cannot target s2d_item % because it is still in Review (needs_review=true). The Review gate must be cleared before activity suggestions are proposed against it.',
      COALESCE(NEW.id::TEXT, '<new>'), NEW.s2d_item_id;
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enforce_suggestion_targets_non_review_item()
  TO supabase_auth_admin, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_suggestion_targets_non_review_item_trigger
  ON public.activity_suggestions;

CREATE TRIGGER enforce_suggestion_targets_non_review_item_trigger
  BEFORE INSERT OR UPDATE ON public.activity_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_suggestion_targets_non_review_item();
