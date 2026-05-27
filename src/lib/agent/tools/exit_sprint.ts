import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { recordAction } from "@/lib/agent/undo";

const args = z.object({}).optional().default({});
type Args = z.infer<typeof args>;

/**
 * Close the active sprint_sessions row by stamping completed_at. The
 * client-side sprint store reads this state on next mount and clears
 * its in-memory blocks. Undo reopens the session.
 */
export const exit_sprint: ToolDefinition<Args, unknown> = {
  name: "exit_sprint",
  description:
    "End the active sprint (stamps completed_at on the active sprint_sessions row). Ring 2, undoable for 30s.",
  ring: "write_mashi",
  args,
  handler: async (_input, ctx) => {
    const active = await ctx.supabase
      .from("sprint_sessions")
      .select("id, completed_at")
      .eq("user_id", ctx.userId)
      .is("completed_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active.error) throw active.error;
    if (!active.data) {
      return { ended: false, reason: "no active sprint" };
    }

    const completedAt = new Date().toISOString();
    const upd = await ctx.supabase
      .from("sprint_sessions")
      .update({ completed_at: completedAt })
      .eq("user_id", ctx.userId)
      .eq("id", active.data.id);
    if (upd.error) throw upd.error;

    const summary = "Ended sprint";
    const { actionId, expiresAt } = await recordAction({
      userId: ctx.userId,
      threadId: ctx.threadId ?? null,
      toolName: "exit_sprint",
      ring: "write_mashi",
      args: {},
      result: { session_id: active.data.id, completed_at: completedAt },
      ok: true,
      summary,
      undoPayload: {
        kind: "patch_sprint_session",
        id: active.data.id as string,
        prior: { completed_at: null },
      },
      supabase: ctx.supabase,
    });

    return {
      ended: true,
      session_id: active.data.id,
      _agent_action_id: actionId,
      _undo_expires_at: expiresAt,
      _undo_summary: summary,
    };
  },
};
