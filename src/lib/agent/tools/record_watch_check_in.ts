import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { recordAction } from "@/lib/agent/undo";

const args = z.object({
  item_id: z.string().uuid(),
  /** true = "still watching"; false = "stop watching". */
  continue: z.boolean(),
  note: z.string().max(2000).optional(),
});

type Args = z.infer<typeof args>;

/**
 * Insert a watch_check_ins row. When `continue=false`, also closes the
 * watching item with resolved_via='abandoned'. The undo deletes the
 * check-in row (and, for stop-watching, restores the prior s2d_items
 * state via a multi op).
 */
export const record_watch_check_in: ToolDefinition<Args, unknown> = {
  name: "record_watch_check_in",
  description:
    "Log a check-in on a watching item. `continue=true` keeps it watching; `continue=false` closes the item as abandoned. Optional free-form note. Ring 2, undoable for 30s.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const itemRes = await ctx.supabase
      .from("s2d_items")
      .select("*")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    if (itemRes.error) throw itemRes.error;
    if (!itemRes.data) throw new Error(`No item with id=${input.item_id}`);
    const prior = itemRes.data as Record<string, unknown>;
    const ref =
      prior.ticket_number != null ? `MASH-${prior.ticket_number}` : "item";

    const checkIn = await ctx.supabase
      .from("watch_check_ins")
      .insert({
        user_id: ctx.userId,
        s2d_item_id: input.item_id,
        note: input.note ?? null,
        continued: input.continue,
      })
      .select("id")
      .single();
    if (checkIn.error || !checkIn.data) {
      throw checkIn.error ?? new Error("watch_check_ins insert failed");
    }
    const checkInId = checkIn.data.id as string;

    let stopUpdate: Record<string, unknown> | null = null;
    if (!input.continue) {
      stopUpdate = {
        status: "done",
        done_at: new Date().toISOString(),
        resolved_via: "abandoned",
      };
      const upd = await ctx.supabase
        .from("s2d_items")
        .update(stopUpdate)
        .eq("user_id", ctx.userId)
        .eq("id", input.item_id);
      if (upd.error) throw upd.error;
    }

    const summary = input.continue
      ? `Logged check-in on ${ref}`
      : `Stopped watching ${ref}`;

    const undoPayload = stopUpdate
      ? ({
          kind: "multi" as const,
          ops: [
            {
              kind: "delete_row" as const,
              table: "watch_check_ins" as const,
              id: checkInId,
            },
            {
              kind: "patch_s2d_item" as const,
              id: input.item_id,
              prior: {
                status: prior.status,
                done_at: prior.done_at ?? null,
                resolved_via: prior.resolved_via ?? null,
              },
            },
          ],
        })
      : ({
          kind: "delete_row" as const,
          table: "watch_check_ins" as const,
          id: checkInId,
        });

    const { actionId, expiresAt } = await recordAction({
      userId: ctx.userId,
      threadId: ctx.threadId ?? null,
      toolName: "record_watch_check_in",
      ring: "write_mashi",
      args: input,
      result: { check_in_id: checkInId },
      ok: true,
      summary,
      undoPayload,
      supabase: ctx.supabase,
    });

    return {
      check_in_id: checkInId,
      _agent_action_id: actionId,
      _undo_expires_at: expiresAt,
      _undo_summary: summary,
    };
  },
};
