import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { recordAction } from "@/lib/agent/undo";

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
 * Spawn a follow-up item descending from an existing one. Used for
 * Yes-but decisions, post-reply watch follow-ups, etc. Sets
 * spawned_from_item_id and spawn_reason on the new row so the spawn
 * chain is queryable.
 *
 * If `queue_hours` is provided, the spawn lands in_queue with a
 * snoozed_until timestamp; otherwise it goes to status='todo'.
 */
export const spawn_follow_up: ToolDefinition<Args, unknown> = {
  name: "spawn_follow_up",
  description:
    "Create a follow-up item descending from parent_id with the given pathway, title, and spawn reason. Optionally queue it for `queue_hours` from now. Ring 2, undoable for 30s.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const parent = await ctx.supabase
      .from("s2d_items")
      .select("company_id, ticket_number")
      .eq("user_id", ctx.userId)
      .eq("id", input.parent_id)
      .maybeSingle();
    if (parent.error) throw parent.error;
    if (!parent.data) throw new Error(`No parent item with id=${input.parent_id}`);

    const row: Record<string, unknown> = {
      user_id: ctx.userId,
      title: input.title,
      pathway: input.pathway,
      priority: "medium",
      status: "todo",
      source_type: "manual",
      spawned_from_item_id: input.parent_id,
      spawn_reason: input.reason,
      company_id: parent.data.company_id ?? null,
    };

    if (input.queue_hours != null) {
      const until = new Date(
        Date.now() + input.queue_hours * 60 * 60 * 1000
      ).toISOString();
      row.status = "in_queue";
      row.queue_reason = input.reason;
      row.queue_until = until;
      row.snoozed_until = until;
    }

    const ins = await ctx.supabase
      .from("s2d_items")
      .insert(row)
      .select("*")
      .single();
    if (ins.error || !ins.data) throw ins.error ?? new Error("spawn insert failed");
    const created = ins.data as Record<string, unknown>;

    const parentRef =
      parent.data.ticket_number != null
        ? `MASH-${parent.data.ticket_number}`
        : "parent";
    const childRef =
      created.ticket_number != null ? `MASH-${created.ticket_number}` : input.title;

    const { actionId, expiresAt } = await recordAction({
      userId: ctx.userId,
      threadId: ctx.threadId ?? null,
      toolName: "spawn_follow_up",
      ring: "write_mashi",
      args: input,
      result: created,
      ok: true,
      summary: `Spawned ${childRef} from ${parentRef}`,
      undoPayload: {
        kind: "delete_row",
        table: "s2d_items",
        id: created.id as string,
      },
      supabase: ctx.supabase,
    });

    return {
      item: created,
      _agent_action_id: actionId,
      _undo_expires_at: expiresAt,
      _undo_summary: `Spawned ${childRef} from ${parentRef}`,
    };
  },
};
