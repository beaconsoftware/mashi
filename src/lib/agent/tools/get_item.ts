import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z
  .object({
    id: z.string().uuid().optional(),
    ticket_number: z.number().int().optional(),
  })
  .refine((v) => v.id != null || typeof v.ticket_number === "number", {
    message: "Provide either `id` or `ticket_number`.",
  });

type Args = z.infer<typeof args>;

export const get_item: ToolDefinition<Args, unknown> = {
  name: "get_item",
  description:
    "Fetch one S2D item by uuid or ticket number (the integer in MASH-N). Includes the joined company_name when one is set.\n\nUse when: the user names a specific item by ticket id or you already have a uuid from resolve_reference / search_board. Example: { ticket_number: 1408 }.\n\nDo NOT use to search by free text — call resolve_reference (for a single best match) or search_board (for a list) instead.\n\nReturns: { item } on success; { item: null } when no row matches. Errors are thrown.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("s2d_items")
      .select("*")
      .eq("user_id", ctx.userId)
      .limit(1);
    if (input.id) q = q.eq("id", input.id);
    else if (typeof input.ticket_number === "number")
      q = q.eq("ticket_number", input.ticket_number);

    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    if (!data) return { item: null };

    let companyName: string | null = null;
    if (data.company_id) {
      const { data: c } = await ctx.supabase
        .from("companies")
        .select("name")
        .eq("user_id", ctx.userId)
        .eq("id", data.company_id)
        .maybeSingle();
      companyName = c?.name ?? null;
    }

    return { item: { ...data, company_name: companyName } };
  },
};
