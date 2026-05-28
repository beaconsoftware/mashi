import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  id: z.string().uuid(),
  until: z.string().nullable(),
});

type Args = z.infer<typeof args>;

/**
 * Set or clear the snoozed_until timestamp on an item, WITHOUT
 * touching status. Strict single-field setter carved out of
 * update_item. For the full "snooze workflow" (status=in_queue +
 * snoozed_until), use snooze_item instead.
 */
export const set_item_snoozed_until: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_item_snoozed_until",
  description:
    "Set or clear the snoozed_until field on a single S2D item WITHOUT changing status. Pass an ISO datetime (e.g. '2026-06-01T09:00:00Z') or null to clear.\n\nUse when: the item is already in_queue and the user wants to push the resurface date out without re-snoozing the workflow, or to clear a previously-set wake time. Example: { id: '…uuid…', until: '2026-06-15T09:00:00Z' }.\n\nDo NOT use to snooze a todo / in_progress item — call snooze_item, which also moves status to in_queue. Do NOT use to update multiple fields at once; use update_item.\n\nReturns: { ok, item, _undo } on success; { ok: false, error } when the datetime is malformed or the item is missing. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    let iso: string | null = null;
    if (input.until != null) {
      const parsed = new Date(input.until);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, error: "Invalid `until` datetime." };
      }
      iso = parsed.toISOString();
    }

    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, snoozed_until")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ snoozed_until: iso })
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const ticket = before.data.ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : "item";

    return {
      ok: true,
      item: data,
      _undo: {
        summary:
          iso == null
            ? `Cleared snoozed_until on ${ref}`
            : `Set ${ref} snoozed_until ${iso.slice(0, 10)}`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: { snoozed_until: before.data.snoozed_until ?? null },
        },
      },
    };
  },
};
