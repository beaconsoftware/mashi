import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";
import { insertItemThreadSystemNote } from "@/lib/agent/threads";

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
 * Change an item's pathway. If the item is in an active sprint slot,
 * the client-side sprint store will detect the pathway change on its
 * next poll and re-warm the canvas — the server-side prewarm scheduler
 * lives in client code, so we leave that handoff to the UI.
 *
 * Also records the change as a system note on the item's thread so the
 * agent can reference it later. No new thread is spawned; the lifecycle
 * change rides along on the existing conversation about the item.
 */
export const set_item_pathway: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_item_pathway",
  description:
    "Set the pathway on a single S2D item (one of: quick_reply, drafted_response, meeting_backed, heads_down, decision_gate, delegated, watching). Also drops a system note on the item's thread when the pathway actually changes.\n\nUse when: the user explicitly asks to re-pathway, or you've inferred the wrong pathway was assigned at triage time. Example: { id: '…uuid…', pathway: 'decision_gate' }.\n\nDo NOT use to update multiple fields at once. Use update_item for atomic multi-field edits.\n\nReturns: { ok, item, _undo } on success; { ok: false, error } when the item is not found. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, pathway")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ pathway: input.pathway })
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const ticket = before.data.ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : "item";

    if (before.data.pathway !== input.pathway) {
      try {
        await insertItemThreadSystemNote({
          userId: ctx.userId,
          itemId: input.id,
          text: `Pathway changed from ${before.data.pathway} to ${input.pathway} on ${new Date().toISOString().slice(0, 10)}.`,
          supabase: ctx.supabase,
        });
      } catch {
        // best-effort — the pathway change has already landed
      }
    }

    return {
      ok: true,
      item: data,
      _undo: {
        summary: `Re-pathwayed ${ref} to ${input.pathway}`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: { pathway: before.data.pathway },
        },
      },
    };
  },
};
