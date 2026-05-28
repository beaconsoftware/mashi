import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  item_id: z.string().uuid(),
  steps: z
    .array(z.string().min(1).max(280))
    .min(1)
    .max(10)
    .describe("1-10 step strings. Each step is a single concrete action."),
  replace: z
    .boolean()
    .default(true)
    .describe(
      "true (default): replace the current plan. false: append the new steps after the existing ones."
    ),
});

type Args = z.infer<typeof args>;

interface PlanStep {
  id: string;
  text: string;
  checked: boolean;
  created_at: string;
}

/**
 * Write the user's Focus card plan for an item. Replaces by default;
 * pass replace:false to append. Captures the prior plan as undo_payload
 * so the 30s undo strip restores it on click.
 */
export const set_plan: ToolDefinition<
  Args,
  {
    ok: boolean;
    plan?: PlanStep[];
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_plan",
  description:
    "Set the Focus card plan for an S2D item: an ordered checklist of 1-10 concrete steps, each ≤280 chars. Replaces the existing plan by default; pass replace:false to append after the current steps.\n\nUse when: the user asks for a plan ('break this down', 'what are the steps?') or volunteers one. Example: { item_id: '…uuid…', steps: ['Draft revised proposal', 'Loop in legal', 'Send by Friday'] }.\n\nDo NOT use for a single-line statement (use set_success_statement). Do NOT use to log a decision (use log_decision). Steps are checkable — they're for sequencing, not for narrative.\n\nReturns: { ok, plan, _undo } on success; { ok: false, error } when the item is missing. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, plan")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const priorPlan = Array.isArray(before.data.plan)
      ? (before.data.plan as PlanStep[])
      : [];
    const now = new Date().toISOString();
    const newSteps: PlanStep[] = input.steps.map((text) => ({
      id: randomUUID(),
      text,
      checked: false,
      created_at: now,
    }));
    const nextPlan: PlanStep[] = input.replace
      ? newSteps
      : [...priorPlan, ...newSteps];

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ plan: nextPlan })
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .select("plan")
      .maybeSingle();
    if (error) throw error;

    const ticket = before.data.ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : "item";
    const verb = input.replace ? "Set" : "Added to";
    const stepWord = input.steps.length === 1 ? "step" : "steps";

    return {
      ok: true,
      plan: (data?.plan as PlanStep[]) ?? nextPlan,
      _undo: {
        summary: `${verb} plan on ${ref} (${input.steps.length} ${stepWord})`,
        op: {
          kind: "update_item_fields",
          id: input.item_id,
          prior: { plan: priorPlan },
        },
      },
    };
  },
};
