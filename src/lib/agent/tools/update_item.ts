import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { patchS2DItem, itemRef } from "@/lib/agent/tools/_s2d_write_helper";

const patchSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    pathway: z
      .enum([
        "quick_reply",
        "drafted_response",
        "meeting_backed",
        "heads_down",
        "decision_gate",
        "delegated",
        "watching",
      ])
      .optional(),
    priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
    status: z.enum(["backlog", "todo", "in_progress", "in_queue", "done"]).optional(),
    planned_for: z.string().nullable().optional(),
    company_id: z.string().uuid().nullable().optional(),
    snoozed_until: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "patch must be non-empty" });

const args = z.object({
  id: z.string().uuid(),
  patch: patchSchema,
});

type Args = z.infer<typeof args>;

/**
 * Generic ring-2 patch over the most common s2d_items fields. The undo
 * payload captures the full prior row state, so reverting restores
 * every field the patch could have touched.
 */
export const update_item: ToolDefinition<Args, unknown> = {
  name: "update_item",
  description:
    "Patch fields on an existing S2D item (title, description, pathway, priority, status, planned_for, company_id, snoozed_until). Ring 2, undoable for 30s.",
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
    const fieldList = Object.keys(input.patch).join(", ");
    return patchS2DItem({
      ctx,
      toolName: "update_item",
      itemId: input.id,
      summary: `Updated ${ref} (${fieldList})`,
      patch: input.patch as Record<string, unknown>,
    });
  },
};
