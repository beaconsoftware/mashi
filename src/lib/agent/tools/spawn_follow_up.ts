import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";
import { appendMessage, getOrCreateThreadForItem } from "@/lib/agent/threads";

const args = z.object({
  parent_id: z.string().uuid(),
  pathway: z.enum([
    "quick_reply",
    "drafted_response",
    "meeting_backed",
    "heads_down",
    "decision_gate",
    "delegated",
    "watching",
  ]),
  title: z.string().min(1).max(500),
  queue_hours: z.number().int().min(0).max(720).optional(),
  reason: z.string().min(1).max(200),
});

type Args = z.infer<typeof args>;

/**
 * Spawn a follow-up item linked to a parent. queue_hours optionally
 * snoozes the new item for N hours so it surfaces later. The new item
 * carries spawned_from_item_id + spawn_reason for provenance.
 *
 * Phase 6 will extend this to inherit the parent's thread summary as
 * the child's first system message; for now we just create the row.
 */
export const spawn_follow_up: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "spawn_follow_up",
  description:
    "Spawn a follow-up item linked to a parent. Optionally snoozes the new item for N hours via queue_hours. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const parent = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, company_id")
      .eq("user_id", ctx.userId)
      .eq("id", input.parent_id)
      .maybeSingle();
    if (parent.error) throw parent.error;
    if (!parent.data) return { ok: false, error: "Parent item not found." };

    const parentThread = await ctx.supabase
      .from("agent_threads")
      .select("summary, title")
      .eq("user_id", ctx.userId)
      .eq("item_id", input.parent_id)
      .maybeSingle();

    const insert: Record<string, unknown> = {
      user_id: ctx.userId,
      title: input.title,
      pathway: input.pathway,
      priority: "medium",
      status: input.queue_hours != null ? "in_queue" : "todo",
      source_type: "manual",
      needs_review: false,
      spawned_from_item_id: input.parent_id,
      spawn_reason: input.reason,
      company_id: parent.data.company_id ?? null,
    };
    if (input.queue_hours != null) {
      insert.snoozed_until = new Date(
        Date.now() + input.queue_hours * 60 * 60 * 1000
      ).toISOString();
    }

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .insert(insert)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("insert failed");

    const ticket = (data as { ticket_number?: number }).ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : "follow-up";
    const parentRef =
      parent.data.ticket_number != null
        ? `MASH-${parent.data.ticket_number}`
        : "parent";

    // Phase 4 lifecycle continuity: eagerly create the child's thread
    // and seed it with a system message that inherits the parent's
    // summary (or title, when no summary exists yet). Best-effort —
    // failure here doesn't roll back the spawn.
    try {
      const childItemId = (data as { id: string }).id;
      const childThread = await getOrCreateThreadForItem({
        userId: ctx.userId,
        itemId: childItemId,
        supabase: ctx.supabase,
      });
      const parentSummary =
        (parentThread.data as { summary: string | null } | null)?.summary ??
        null;
      const seed = parentSummary
        ? `This item was spawned from ${parentRef}. Reason: ${input.reason}. Prior context: ${parentSummary}`
        : `This item was spawned from ${parentRef}. Reason: ${input.reason}.`;
      await appendMessage({
        userId: ctx.userId,
        threadId: childThread.id,
        role: "system",
        content: seed,
        supabase: ctx.supabase,
      });
    } catch {
      // best-effort
    }

    return {
      ok: true,
      item: data,
      _undo: {
        summary: `Spawned ${ref} from ${parentRef}`,
        op: { kind: "delete_item", id: (data as { id: string }).id },
      },
    };
  },
};
