import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid().nullable(),
});

type Args = z.infer<typeof args>;

/**
 * Attach or detach a company on a single S2D item. Strict single-field
 * setter carved out of update_item. Pass null to unset the company.
 */
export const set_item_company: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_item_company",
  description:
    "Attach an S2D item to a company (portfolio company / account), or detach by passing null. company_id is a UUID from list_companies.\n\nUse when: the user assigns an item to a portco ('this is MPP, not Snailworks'), or removes a mis-applied company. Example: { id: '…uuid…', company_id: '…uuid…' }.\n\nDo NOT pass a company name or ticker — only the UUID. Call list_companies first if you need the id. Do NOT use to update multiple fields at once; use update_item.\n\nReturns: { ok, item, _undo } on success; { ok: false, error } when the item is missing or the company id doesn't belong to this user. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, company_id")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    if (input.company_id != null) {
      const owned = await ctx.supabase
        .from("companies")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("id", input.company_id)
        .maybeSingle();
      if (!owned.data) {
        return {
          ok: false,
          error: "company_id not found for this user.",
        };
      }
    }

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ company_id: input.company_id })
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
          input.company_id == null
            ? `Detached company from ${ref}`
            : `Attached company to ${ref}`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: { company_id: before.data.company_id ?? null },
        },
      },
    };
  },
};
