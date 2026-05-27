import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { patchS2DItem, itemRef } from "@/lib/agent/tools/_s2d_write_helper";

const args = z.object({
  id: z.string().uuid(),
  pathway: z.enum([
    "quick_reply",
    "drafted_response",
    "meeting_backed",
    "heads_down",
    "decision_gate",
    "delegated",
    "watching",
  ]),
});

type Args = z.infer<typeof args>;

/**
 * Re-pathway an item. The sprint pre-warm scheduler is client-side
 * (Zustand store + /api/sprint/prewarm POST). The client-side react-query
 * invalidation on s2d_items will pick up the new pathway; when the slot
 * is currently active, useSprintRehydrate's repathway effect notices the
 * mismatch and calls schedulePrewarmDebounced({ reason: 'repathway' }).
 * So we just patch the field server-side.
 */
export const set_pathway: ToolDefinition<Args, unknown> = {
  name: "set_pathway",
  description:
    "Change an item's pathway (quick_reply / drafted_response / meeting_backed / heads_down / decision_gate / delegated / watching). Ring 2, undoable for 30s.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const priorRes = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, title")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    const ref = itemRef(priorRes.data ?? {});

    return patchS2DItem({
      ctx,
      toolName: "set_pathway",
      itemId: input.id,
      summary: `Set ${ref} pathway to ${input.pathway}`,
      patch: { pathway: input.pathway },
    });
  },
};
