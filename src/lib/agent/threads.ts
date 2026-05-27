import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

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
  created_at: string;
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
  supabase?: Supa;
}): Promise<{ thread: AgentThreadRow | null; messages: AgentMessageRow[] }> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  const [t, m] = await Promise.all([
    supabase
      .from("agent_threads")
      .select("*")
      .eq("user_id", opts.userId)
      .eq("id", opts.threadId)
      .maybeSingle(),
    supabase
      .from("agent_messages")
      .select("*")
      .eq("user_id", opts.userId)
      .eq("thread_id", opts.threadId)
      .order("created_at", { ascending: true })
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500)),
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
