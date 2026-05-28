import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  question: z.string().min(10).max(280),
  options: z
    .array(z.string().min(1).max(120))
    .min(2)
    .max(5)
    .optional(),
});

type Args = z.infer<typeof args>;

/**
 * Ask the user a focused follow-up question when the next step is
 * ambiguous and a tool call won't disambiguate it. The model picks this
 * like any other tool; the UI renders the question plus optional option
 * chips so the user can click an answer instead of typing.
 *
 * Use when:
 *   - The user's intent is unclear and more than one reasonable target
 *     or action exists (e.g. "snooze the brand spend thing" matches
 *     multiple items).
 *   - A write tool would otherwise need to guess at one of: the target
 *     entity id, the user's intent, or the success criterion.
 *
 * Do NOT use to find out something you could look up. Read first
 * (resolve_reference, search_board, search_messages, get_message_thread)
 * and only ask if the read result is itself ambiguous.
 *
 * The handler is intentionally a no-op — the question + options ride
 * back to the UI as a tool_use delta. The loop short-circuits after
 * this tool runs; the user's reply lands as the next user turn.
 */
export const ask_followup_question: ToolDefinition<
  Args,
  { ok: true; question: string; options?: string[] }
> = {
  name: "ask_followup_question",
  description:
    "Ask the user one focused follow-up question when intent is ambiguous and reading more won't resolve it. Args: question (10-280 chars), optional options[] of 2-5 short choices the user can click. Use after resolve_reference / search_* returns multiple low-confidence candidates, or when you cannot name the target entity, the user's intent, and the success criterion. Do NOT use to discover facts that a read tool can fetch. Example: { question: 'Which one did you mean?', options: ['MASH-1408 (Q4 brand spend)', 'MASH-1503 (brand budget review)'] }. Returns the question + options unchanged; the loop pauses and the user's reply becomes the next user turn.",
  ring: "read",
  args,
  handler: async (input) => {
    return { ok: true, question: input.question, options: input.options };
  },
};
