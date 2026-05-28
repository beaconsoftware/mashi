import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({}).optional().default({});

type Args = z.infer<typeof args>;

export const list_companies: ToolDefinition<Args, unknown> = {
  name: "list_companies",
  description:
    "List the user's companies (portfolio companies / accounts) ordered by name. Each row carries id, name, color_hex, status, and email_domain.\n\nUse when: you need a company UUID to attach to an item (set_item_company, create_item), or the user asks 'which portcos do I have?'. Example: {}.\n\nDo NOT use to fetch items belonging to a company — pass company_id into search_board instead.\n\nReturns: { companies }. Empty list when the user has no companies yet.",
  ring: "read",
  args,
  handler: async (_input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("companies")
      .select("id, name, color_hex, status, email_domain")
      .eq("user_id", ctx.userId)
      .order("name");
    if (error) throw error;
    return { companies: data ?? [] };
  },
};
