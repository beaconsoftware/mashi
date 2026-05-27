import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  appendMessage,
  getOrCreateThreadForItem,
} from "@/lib/agent/threads";

/**
 * Spawn-chain context inheritance (Phase 6).
 *
 * When the agent creates a follow-up item via spawn_follow_up, the
 * child's thread should open with a system message carrying the
 * parent's rolling summary. That way the agent can answer questions
 * on the child item with the same memory it had on the parent, even
 * though the new thread otherwise starts blank.
 *
 * This walks the spawn chain one step up — the parent's parent, etc.,
 * is not pulled in. Multi-step ancestry is implicit: each parent's
 * rolling summary already absorbs the grandparent's via the same
 * mechanism when *it* was spawned.
 *
 * Best-effort: failure here never rolls back the spawn itself; the
 * caller swallows errors.
 */

type Supa = SupabaseClient;

interface InheritResult {
  ok: boolean;
  childThreadId?: string;
  inherited?: boolean;
  reason?:
    | "parent_missing"
    | "child_thread_failed"
    | "parent_has_no_thread"
    | "child_already_seeded";
}

export async function inheritParentContext(opts: {
  userId: string;
  childItemId: string;
  /** Optional pre-resolved values. spawn_follow_up passes these to
   *  save a round-trip; other callers can leave them undefined. */
  parentItemId?: string;
  spawnReason?: string;
  supabase?: Supa;
}): Promise<InheritResult> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();

  let parentItemId = opts.parentItemId ?? null;
  let parentTicket: number | null = null;

  if (!parentItemId) {
    const childRow = await supabase
      .from("s2d_items")
      .select("spawned_from_item_id, spawn_reason")
      .eq("user_id", opts.userId)
      .eq("id", opts.childItemId)
      .maybeSingle();
    if (childRow.error) throw childRow.error;
    parentItemId =
      (childRow.data as { spawned_from_item_id?: string | null } | null)
        ?.spawned_from_item_id ?? null;
    if (!opts.spawnReason) {
      opts.spawnReason =
        (childRow.data as { spawn_reason?: string | null } | null)
          ?.spawn_reason ?? undefined;
    }
  }

  if (!parentItemId) {
    return { ok: false, reason: "parent_missing" };
  }

  const parentLookup = await supabase
    .from("s2d_items")
    .select("ticket_number")
    .eq("user_id", opts.userId)
    .eq("id", parentItemId)
    .maybeSingle();
  parentTicket =
    (parentLookup.data as { ticket_number?: number } | null)?.ticket_number ??
    null;

  const parentThread = await supabase
    .from("agent_threads")
    .select("summary")
    .eq("user_id", opts.userId)
    .eq("item_id", parentItemId)
    .maybeSingle();
  const parentSummary =
    (parentThread.data as { summary?: string | null } | null)?.summary ?? null;

  const parentRef = parentTicket != null ? `MASH-${parentTicket}` : "parent";

  let childThreadId: string;
  try {
    const childThread = await getOrCreateThreadForItem({
      userId: opts.userId,
      itemId: opts.childItemId,
      supabase,
    });
    childThreadId = childThread.id;
  } catch {
    return { ok: false, reason: "child_thread_failed" };
  }

  // Skip if the child thread already has a system seed — we don't
  // want to double-seed if spawn_follow_up is retried or another
  // path lands first.
  const existingSeed = await supabase
    .from("agent_messages")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("thread_id", childThreadId)
    .eq("role", "system")
    .limit(1)
    .maybeSingle();
  if (existingSeed.data) {
    return {
      ok: true,
      childThreadId,
      inherited: false,
      reason: "child_already_seeded",
    };
  }

  const reasonClause = opts.spawnReason ? ` Reason: ${opts.spawnReason}.` : "";
  const seed = parentSummary
    ? `This item was spawned from ${parentRef}.${reasonClause} Prior context: ${parentSummary}`
    : `This item was spawned from ${parentRef}.${reasonClause}`;

  await appendMessage({
    userId: opts.userId,
    threadId: childThreadId,
    role: "system",
    content: seed,
    supabase,
  });

  // Also seed the child thread's rolling summary with the parent's
  // summary, so the next agent turn picks it up via the system prompt
  // builder (which reads agent_threads.summary, not in-thread system
  // messages). Compaction will overwrite this once the child thread
  // grows large enough to merit a fresh summary.
  if (parentSummary) {
    await supabase
      .from("agent_threads")
      .update({ summary: parentSummary })
      .eq("user_id", opts.userId)
      .eq("id", childThreadId);
  }

  return {
    ok: true,
    childThreadId,
    inherited: parentSummary != null,
  };
}
