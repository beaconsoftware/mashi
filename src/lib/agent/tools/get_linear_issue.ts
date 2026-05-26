import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z
  .object({
    id: z.string().uuid().optional(),
    external_id: z.string().optional(),
    url: z.string().url().optional(),
  })
  .refine(
    (v) => v.id != null || v.external_id != null || v.url != null,
    { message: "Provide `id`, `external_id`, or `url`." }
  );

type Args = z.infer<typeof args>;

export const get_linear_issue: ToolDefinition<Args, unknown> = {
  name: "get_linear_issue",
  description:
    "Fetch a single Linear issue by db id, Linear UUID (external_id), or Linear URL.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("linear_issues")
      .select("*")
      .eq("user_id", ctx.userId)
      .limit(1);
    if (input.id) q = q.eq("id", input.id);
    else if (input.external_id) q = q.eq("external_id", input.external_id);
    else if (input.url) q = q.eq("url", input.url);

    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return { issue: data ?? null };
  },
};
