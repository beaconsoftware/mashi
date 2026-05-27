import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
  })
  .optional()
  .default({});

type Args = z.infer<typeof args>;

/**
 * The AI-triaged review queue (items with `needs_review=true`). Mirrors
 * the Review column on the S2D board. Sorted newest-first so the agent
 * answers "what needs my attention?" with the most recent triage hits.
 */
export const list_needs_review: ToolDefinition<Args, unknown> = {
  name: "list_needs_review",
  description:
    "Items flagged by triage as needing user review (the Review column on the S2D board). Sorted newest-first. Default limit 30, max 100.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .select(
        "id, ticket_number, title, pathway, priority, source_type, source_label, source_url, ai_suggestion, created_at"
      )
      .eq("user_id", ctx.userId)
      .eq("needs_review", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return { items: data ?? [], count: data?.length ?? 0 };
  },
};
