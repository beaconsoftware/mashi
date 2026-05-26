import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({}).optional().default({});

type Args = z.infer<typeof args>;

export const list_companies: ToolDefinition<Args, unknown> = {
  name: "list_companies",
  description: "List the user's companies (portcos / accounts) ordered by name.",
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
