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
    "Fetch a single S2D item by uuid or ticket_number (the integer part of MASH-N). Returns the item plus its company_name when set.",
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
