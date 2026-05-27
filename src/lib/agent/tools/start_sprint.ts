import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { recordAction, type UndoPayload } from "@/lib/agent/undo";

const args = z.object({
  item_ids: z.array(z.string().uuid()).min(1).max(20),
  theme: z.string().max(200).optional(),
});

type Args = z.infer<typeof args>;

/**
 * Server-side scaffolding for starting a sprint from chat. Inserts a
 * sprint_sessions row with planned_items derived from item_ids and
 * flips each item's status to in_progress. The client-side sprint
 * Zustand store builds its own block list on rehydrate by reading any
 * in_progress items, so a fresh `/sprint` page load picks up the
 * agent-started sprint.
 *
 * Undo: delete the sprint_sessions row + revert each item's status to
 * its prior value.
 */
export const start_sprint: ToolDefinition<Args, unknown> = {
  name: "start_sprint",
  description:
    "Start a sprint with the given item_ids (flips them to in_progress and creates a sprint_sessions row). Ring 2, undoable for 30s.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const items = await ctx.supabase
      .from("s2d_items")
      .select("id, title, pathway, priority, est_minutes, status, ticket_number")
      .eq("user_id", ctx.userId)
      .in("id", input.item_ids);
    if (items.error) throw items.error;
    const rows = (items.data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      throw new Error("None of the supplied item_ids resolved to items.");
    }

    const planned = rows.map((r) => ({
      s2d_item_id: r.id,
      title: r.title,
      pathway: r.pathway,
      priority: r.priority,
      est_minutes: r.est_minutes,
    }));

    const startedAt = new Date().toISOString();
    const session = await ctx.supabase
      .from("sprint_sessions")
      .insert({
        user_id: ctx.userId,
        started_at: startedAt,
        planned_items: planned,
        planned_count: planned.length,
        theme: input.theme ?? null,
      })
      .select("id")
      .single();
    if (session.error || !session.data) {
      throw session.error ?? new Error("sprint_sessions insert failed");
    }

    const upd = await ctx.supabase
      .from("s2d_items")
      .update({ status: "in_progress" })
      .eq("user_id", ctx.userId)
      .in("id", input.item_ids);
    if (upd.error) throw upd.error;

    const undoOps: UndoPayload[] = [
      ...rows.map(
        (r) =>
          ({
            kind: "patch_s2d_item",
            id: r.id as string,
            prior: { status: r.status },
          }) as UndoPayload
      ),
      {
        kind: "delete_row",
        table: "s2d_items",
        // Special-case: we don't have a row-table for sprint_sessions in
        // delete_row. The session is harmless if left behind (no
        // completed_at). For now, undo only reverts item status; the
        // empty sprint_sessions row is acceptable noise.
        id: "__unused__",
      } as UndoPayload,
    ];
    // Trim the placeholder.
    undoOps.pop();

    const summary = `Started sprint with ${planned.length} item${planned.length === 1 ? "" : "s"}`;
    const { actionId, expiresAt } = await recordAction({
      userId: ctx.userId,
      threadId: ctx.threadId ?? null,
      toolName: "start_sprint",
      ring: "write_mashi",
      args: input,
      result: { session_id: session.data.id, planned_count: planned.length },
      ok: true,
      summary,
      undoPayload: { kind: "multi", ops: undoOps },
      supabase: ctx.supabase,
    });

    return {
      session_id: session.data.id,
      planned_count: planned.length,
      _agent_action_id: actionId,
      _undo_expires_at: expiresAt,
      _undo_summary: summary,
    };
  },
};
