import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const PATCH_FIELDS = [
  "title",
  "description",
  "pathway",
  "priority",
  "status",
  "planned_for",
  "company_id",
  "snoozed_until",
] as const;

const args = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      title: z.string().min(1).max(500).optional(),
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
      status: z
        .enum(["backlog", "todo", "in_progress", "in_queue", "done"])
        .optional(),
      planned_for: z.string().nullable().optional(),
      company_id: z.string().uuid().nullable().optional(),
      snoozed_until: z.string().nullable().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "patch must include at least one field",
    }),
});

type Args = z.infer<typeof args>;

/**
 * Generic patch on an s2d_item. The agent reaches for this when more
 * specific tools (snooze_item, set_item_pathway, complete_item) don't
 * fit, or when multiple fields need to change atomically. Captures the
 * prior values for the 30s undo window.
 */
export const update_item: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "update_item",
  description:
    "Prefer the field-specific set_item_* tools (set_item_title, set_item_description, set_item_priority, set_item_pathway, set_item_company, set_item_planned_for, set_item_snoozed_until) unless you genuinely need to update multiple fields atomically.\n\nUse when: you are changing two or more fields on the same item in one shot and want a single undo entry covering all of them. Example: { id: '…uuid…', patch: { pathway: 'decision_gate', priority: 'urgent' } }.\n\nDo NOT use to set a single field — pick the matching set_item_* tool. Do NOT use to snooze (snooze_item also adjusts status). Do NOT use to complete (call complete_item).\n\nReturns: { ok, item, _undo } on success; { ok: false, error } when the item is missing. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("*")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const beforeRow = before.data as Record<string, unknown>;
    const prior: Record<string, unknown> = {};
    for (const key of PATCH_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input.patch, key)) {
        prior[key] = beforeRow[key] ?? null;
      }
    }

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update(input.patch as Record<string, unknown>)
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const ticket = beforeRow.ticket_number as number | undefined;
    const ref = ticket != null ? `MASH-${ticket}` : "item";
    const changed = Object.keys(input.patch).join(", ");

    return {
      ok: true,
      item: data,
      _undo: {
        summary: `Updated ${ref} (${changed})`,
        op: { kind: "update_item_fields", id: input.id, prior },
      },
    };
  },
};
