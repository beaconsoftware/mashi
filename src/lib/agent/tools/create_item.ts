import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  pathway: z
    .enum([
      "quick_reply",
      "drafted_response",
      "meeting_backed",
      "heads_down",
      "decision_gate",
      "delegated",
      "watching",
    ])
    .optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  status: z
    .enum(["backlog", "todo", "in_progress", "in_queue", "done"])
    .optional(),
  company_id: z.string().uuid().optional(),
  source_type: z
    .enum([
      "linear",
      "gmail",
      "slack",
      "fireflies",
      "granola",
      "calendar",
      "manual",
    ])
    .optional(),
  source_thread_id: z.string().optional(),
});

type Args = z.infer<typeof args>;

/**
 * Create a new s2d item. Undo deletes the row outright; safe within
 * the 30s window because the user just saw it land.
 */
export const create_item: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "create_item",
  description:
    "Create a new S2D board item. Defaults: pathway=heads_down, priority=medium, status=todo, source_type=manual. needs_review is always false (the user is creating it, no triage gate needed).\n\nUse when: the user explicitly asks for a new item ('add a todo to follow up with Maya', 'create a decision-gate item for the budget question'). Example: { title: 'Follow up with Maya re: brand spend', pathway: 'quick_reply', priority: 'high' }.\n\nDo NOT use to spawn a child item off an existing one — call spawn_follow_up. Do NOT use to log a one-off decision (use log_decision). Before creating, sanity-check with resolve_reference + search_board that the item doesn't already exist; the dedup hook (Phase 4) will catch some duplicates but not all.\n\nReturns: { ok, item, _undo }. Undo deletes the row. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const insert = {
      user_id: ctx.userId,
      title: input.title,
      description: input.description ?? null,
      pathway: input.pathway ?? "heads_down",
      priority: input.priority ?? "medium",
      status: input.status ?? "todo",
      company_id: input.company_id ?? null,
      source_type: input.source_type ?? "manual",
      source_thread_id: input.source_thread_id ?? null,
      needs_review: false,
    };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .insert(insert)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("create_item failed");

    const ticket = (data as { ticket_number?: number }).ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : input.title;

    return {
      ok: true,
      item: data,
      _undo: {
        summary: `Created ${ref}`,
        op: { kind: "delete_item", id: (data as { id: string }).id },
      },
    };
  },
};
