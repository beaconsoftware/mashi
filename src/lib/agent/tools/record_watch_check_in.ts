import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  item_id: z.string().uuid(),
  continued: z.boolean(),
  note: z.string().max(2000).optional(),
});

type Args = z.infer<typeof args>;

/**
 * Append a watch check-in row. continued=true keeps the item in_queue;
 * continued=false records the terminal stop-watching exit (the s2d
 * item also gets marked done/abandoned by the caller, not by us — this
 * tool just writes the trail). Undo deletes the row.
 */
export const record_watch_check_in: ToolDefinition<
  Args,
  {
    ok: boolean;
    check_in?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "record_watch_check_in",
  description:
    "Append a check-in entry to a watching-pathway item's trail. continued=true means 'still watching, no change'; continued=false records the terminal stop-watching event (the item should then be closed via complete_item separately).\n\nUse when: the user updates a watching item ('still nothing from them; check again in a week'; 'stop watching this, they replied'). Example: { item_id: '…uuid…', continued: true, note: 'No response yet, will re-check Monday' }.\n\nDo NOT use to set the watch target or condition (use set_watch_target). Do NOT use to complete the item itself; call complete_item.\n\nReturns: { ok, check_in, _undo } on success; { ok: false, error } when the item is missing. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const item = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    if (item.error) throw item.error;
    if (!item.data) return { ok: false, error: "Item not found." };

    const { data, error } = await ctx.supabase
      .from("watch_check_ins")
      .insert({
        user_id: ctx.userId,
        s2d_item_id: input.item_id,
        note: input.note ?? null,
        continued: input.continued,
      })
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("insert failed");

    const ticket = item.data.ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : "item";
    const label = input.continued ? "watch check-in" : "stop-watching";

    return {
      ok: true,
      check_in: data,
      _undo: {
        summary: `Recorded ${label} on ${ref}`,
        op: {
          kind: "delete_watch_check_in",
          id: (data as { id: string }).id,
        },
      },
    };
  },
};
