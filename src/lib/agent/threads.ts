import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AttachmentDescriptor } from "@/lib/agent/attachments";
import type { AgentReference } from "@/lib/agent/references";

/**
 * Persistence helpers for agent_threads + agent_messages. Server-only;
 * every call assumes the caller has resolved a Supabase user_id and is
 * passing it in. Service-role client + manual user_id scoping is the
 * codebase convention (AGENTS.md multi-tenancy invariants).
 *
 * One thread per item is enforced at the DB layer by a partial unique
 * index on `agent_threads.item_id`. This module's job is to read/write
 * around that invariant, not police it: getOrCreateThreadForItem uses
 * insert-then-ignore-conflict so two concurrent "Ask Mashi" clicks on
 * the same item still resolve to a single thread row.
 */

export type AgentRole = "user" | "assistant" | "system" | "tool";

export interface AgentThreadRow {
  id: string;
  user_id: string;
  item_id: string | null;
  title: string;
  summary: string | null;
  last_message_at: string | null;
  created_at: string;
  /** Quality Phase 3 plan/act mode. Default 'act' at the DB layer. */
  mode: "plan" | "act";
  /** A1 turn lock: claim token for the single in-flight turn, or null
   * when the thread is free. */
  active_turn_id: string | null;
  /** A1 turn lock: when the active turn claimed the thread. Drives the
   * claim TTL so a crashed turn can't wedge the thread forever. */
  active_turn_started_at: string | null;
}

export interface AgentMessageRow {
  id: string;
  user_id: string;
  thread_id: string;
  role: AgentRole;
  content: string | null;
  // JSONB-typed; these mirror Anthropic tool_use / tool_result content
  // blocks shape so the loop can replay them on subsequent turns.
  tool_calls: unknown | null;
  tool_results: unknown | null;
  cursor_context: unknown | null;
  // Set by compactThreadIfNeeded when the row is absorbed into the
  // thread's rolling summary; the loop ignores stamped rows on
  // subsequent turns. NULL for any message still in active replay.
  superseded_by_summary_at: string | null;
  created_at: string;
  /** A1: monotonic per-insert sequence. Deterministic tiebreaker behind
   * created_at so replay is totally ordered. */
  seq: number;
  /** P1: optional per-message annotations (A8 error/retryable, A3
   * cancelled, A9 truncated, A6 budget_exhausted). NULL for healthy
   * messages. */
  metadata: Record<string, unknown> | null;
  /** P2.b: soft-delete marker for Regenerate/Edit-and-resend truncation.
   * Rows are kept for auditability but excluded from replay, the thread
   * view, and search. NULL for live messages. */
  deleted_at: string | null;
  /** B1 (P3): attachment descriptors on a user row {kind, storagePath,
   * mime, name, size}. Bytes live in Storage; this is the pointer. NULL
   * when the message has no attachments. */
  attachments: AttachmentDescriptor[] | null;
  /** B2 (P3): @-mention reference descriptors on a user row {kind, id,
   * label, ticketNumber}. Canonicalized against the user's s2d_items
   * server-side before persist. NULL when the message has none. */
  pinned_references: AgentReference[] | null;
}

type Supa = SupabaseClient;

/**
 * Look up an item's thread, or create one if it doesn't exist yet.
 * Idempotent under concurrent calls thanks to the unique index — if two
 * callers race we'll see a 23505 conflict on the second insert and fall
 * back to a re-select.
 */
export async function getOrCreateThreadForItem(opts: {
  userId: string;
  itemId: string;
  supabase?: Supa;
}): Promise<AgentThreadRow> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();

  const existing = await supabase
    .from("agent_threads")
    .select("*")
    .eq("user_id", opts.userId)
    .eq("item_id", opts.itemId)
    .maybeSingle();
  if (existing.data) return existing.data as AgentThreadRow;

  const titleRes = await supabase
    .from("s2d_items")
    .select("ticket_number, title")
    .eq("user_id", opts.userId)
    .eq("id", opts.itemId)
    .maybeSingle();

  const ticket = titleRes.data?.ticket_number;
  const itemTitle = titleRes.data?.title ?? "Untitled item";
  const title = ticket != null ? `MASH-${ticket}, ${itemTitle}` : itemTitle;

  const insert = await supabase
    .from("agent_threads")
    .insert({
      user_id: opts.userId,
      item_id: opts.itemId,
      title,
    })
    .select("*")
    .maybeSingle();

  if (insert.data) return insert.data as AgentThreadRow;

  // Either a concurrent insert won the race (unique index) or some
  // other write error fired. Re-select; if still missing, surface.
  const reselect = await supabase
    .from("agent_threads")
    .select("*")
    .eq("user_id", opts.userId)
    .eq("item_id", opts.itemId)
    .maybeSingle();
  if (reselect.data) return reselect.data as AgentThreadRow;
  throw insert.error ?? new Error("Couldn't create thread for item.");
}

export async function loadThread(opts: {
  userId: string;
  threadId: string;
  /** Cap on messages returned — newest N. Defaults to 100. */
  limit?: number;
  /** When true, includes messages that were absorbed into the
   * thread's rolling summary. Defaults to false so the loop and
   * UI never replay redundant context. */
  includeSuperseded?: boolean;
  supabase?: Supa;
}): Promise<{ thread: AgentThreadRow | null; messages: AgentMessageRow[] }> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  let query = supabase
    .from("agent_messages")
    .select("*")
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    // A1: created_at is the primary order; seq is the deterministic
    // tiebreaker so same-millisecond inserts never replay out of order.
    .order("created_at", { ascending: true })
    .order("seq", { ascending: true })
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
    // P2.b: never replay / show truncated (regenerated or edited-away)
    // turns. They remain in the table for auditability.
    .is("deleted_at", null);
  if (!opts.includeSuperseded) {
    query = query.is("superseded_by_summary_at", null);
  }
  const [t, m] = await Promise.all([
    supabase
      .from("agent_threads")
      .select("*")
      .eq("user_id", opts.userId)
      .eq("id", opts.threadId)
      .maybeSingle(),
    query,
  ]);
  return {
    thread: (t.data as AgentThreadRow | null) ?? null,
    messages: (m.data as AgentMessageRow[] | null) ?? [],
  };
}

interface AppendMessageInput {
  userId: string;
  threadId: string;
  role: AgentRole;
  content?: string | null;
  toolCalls?: unknown | null;
  toolResults?: unknown | null;
  cursorContext?: unknown | null;
  /** P1: optional per-message annotations (A8 error/retryable, A3
   * cancelled, A9 truncated, A6 budget_exhausted). NULL for healthy
   * messages. */
  metadata?: Record<string, unknown> | null;
  /** B1 (P3): attachment descriptors on a user row. NULL/empty otherwise. */
  attachments?: AttachmentDescriptor[] | null;
  /** B2 (P3): pinned @-mention references on a user row. NULL/empty
   * otherwise. Persisted canonical (already validated against s2d_items). */
  references?: AgentReference[] | null;
  supabase?: Supa;
}

/**
 * Append a single turn to a thread. Also bumps `last_message_at` on
 * the thread so the recent-threads list is cheap (single column).
 */
export async function appendMessage(
  opts: AppendMessageInput
): Promise<AgentMessageRow> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  const now = new Date().toISOString();
  const ins = await supabase
    .from("agent_messages")
    .insert({
      user_id: opts.userId,
      thread_id: opts.threadId,
      role: opts.role,
      content: opts.content ?? null,
      tool_calls: opts.toolCalls ?? null,
      tool_results: opts.toolResults ?? null,
      cursor_context: opts.cursorContext ?? null,
      metadata: opts.metadata ?? null,
      attachments:
        opts.attachments && opts.attachments.length > 0
          ? opts.attachments
          : null,
      pinned_references:
        opts.references && opts.references.length > 0 ? opts.references : null,
    })
    .select("*")
    .single();
  if (ins.error || !ins.data) throw ins.error ?? new Error("insert failed");

  await supabase
    .from("agent_threads")
    .update({ last_message_at: now })
    .eq("user_id", opts.userId)
    .eq("id", opts.threadId);

  return ins.data as AgentMessageRow;
}

/**
 * Insert a `role='system'` note into the thread bound to an item, if a
 * thread exists. Used for lifecycle events on the item (re-pathway,
 * merge, spawn) where the conversation should record what happened
 * without the user having to ask. Silently no-ops if no thread exists
 * yet — the next time the user opens Ask Mashi on this item, the
 * thread starts fresh.
 *
 * Per Phase 4 contract: lifecycle changes append system messages to the
 * *same* thread, they never branch.
 */
export async function insertItemThreadSystemNote(opts: {
  userId: string;
  itemId: string;
  text: string;
  supabase?: Supa;
}): Promise<void> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  const thread = await supabase
    .from("agent_threads")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("item_id", opts.itemId)
    .maybeSingle();
  if (!thread.data) return;
  await appendMessage({
    userId: opts.userId,
    threadId: thread.data.id as string,
    role: "system",
    content: opts.text,
    supabase,
  });
}

/**
 * P2.b — Regenerate (D2) / Edit-and-resend (D3) support.
 *
 * Both re-run a turn from an earlier user message. The shared shape is:
 * pick an anchor user message, discard (soft-delete) every live row after
 * it, then re-run the loop without appending a fresh user message (the
 * anchor is already the last live row). This loads the live (non-deleted,
 * non-system-summary-absorbed irrelevant) rows so the caller can find the
 * anchor and inspect what would be discarded.
 */
export async function loadLiveMessagesForRerun(opts: {
  userId: string;
  threadId: string;
  supabase?: Supa;
}): Promise<AgentMessageRow[]> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  const res = await supabase
    .from("agent_messages")
    .select("*")
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("seq", { ascending: true });
  return (res.data as AgentMessageRow[] | null) ?? [];
}

/**
 * Soft-delete every live message in a thread whose `seq` is greater than
 * `afterSeq`. Used by Regenerate (discard the trailing assistant + tool
 * rows) and Edit-and-resend (discard everything after the edited user
 * turn). Append-only + monotonic seq means seq > anchor captures exactly
 * the rows inserted after the anchor. Rows are kept for auditability.
 */
export async function truncateThreadAfterSeq(opts: {
  userId: string;
  threadId: string;
  afterSeq: number;
  supabase?: Supa;
}): Promise<void> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  await supabase
    .from("agent_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .is("deleted_at", null)
    .gt("seq", opts.afterSeq);
}

/**
 * Edit a prior user message's content in place (D3). Scoped by user_id +
 * thread_id so a forged messageId from another thread can't be written.
 * Returns true if a row was updated.
 */
export async function updateUserMessageContent(opts: {
  userId: string;
  threadId: string;
  messageId: string;
  content: string;
  cursorContext?: unknown;
  supabase?: Supa;
}): Promise<boolean> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  const patch: Record<string, unknown> = { content: opts.content };
  if (opts.cursorContext !== undefined) {
    patch.cursor_context = opts.cursorContext;
  }
  const res = await supabase
    .from("agent_messages")
    .update(patch)
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .eq("id", opts.messageId)
    .eq("role", "user")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  return !!res.data;
}

/**
 * A1 turn lock — TTL matching the route maxDuration (300s). A turn that
 * holds the lock longer than this is presumed crashed and a new turn may
 * reclaim the thread.
 */
export const TURN_LOCK_TTL_SECONDS = 300;

/**
 * Claim the single in-flight turn slot for a thread. Returns a fresh
 * turn id on success, or null if another turn already holds the lock and
 * it hasn't gone stale.
 *
 * The claim is a single conditional UPDATE: it only matches a row whose
 * lock is free (active_turn_id IS NULL) OR stale (claimed longer ago than
 * the TTL). Postgres row-locks the UPDATE, so two concurrent claims
 * serialize — the loser re-evaluates the WHERE against the winner's
 * just-written non-null, non-stale lock and updates zero rows. Exactly
 * one claim wins; the other gets null and the route 409s.
 */
export async function claimThreadTurn(opts: {
  userId: string;
  threadId: string;
  ttlSeconds?: number;
  supabase?: Supa;
}): Promise<string | null> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  const turnId = randomUUID();
  const ttl = opts.ttlSeconds ?? TURN_LOCK_TTL_SECONDS;
  const staleCutoff = new Date(Date.now() - ttl * 1000).toISOString();
  const res = await supabase
    .from("agent_threads")
    .update({
      active_turn_id: turnId,
      active_turn_started_at: new Date().toISOString(),
    })
    .eq("id", opts.threadId)
    .eq("user_id", opts.userId)
    .or(`active_turn_id.is.null,active_turn_started_at.lt.${staleCutoff}`)
    .select("id")
    .maybeSingle();
  return res.data ? turnId : null;
}

/**
 * Release a turn lock. Only clears the lock if we still own it (the
 * active_turn_id still equals our token), so a turn that already lost
 * the lock to a TTL-reclaim doesn't clobber its successor.
 */
export async function releaseThreadTurn(opts: {
  userId: string;
  threadId: string;
  turnId: string;
  supabase?: Supa;
}): Promise<void> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  await supabase
    .from("agent_threads")
    .update({ active_turn_id: null, active_turn_started_at: null })
    .eq("id", opts.threadId)
    .eq("user_id", opts.userId)
    .eq("active_turn_id", opts.turnId);
}
