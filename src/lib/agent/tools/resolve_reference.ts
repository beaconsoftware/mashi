import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { resolveReference, type ResolveCandidate } from "@/lib/agent/resolve";

const args = z.object({
  text: z.string().min(1).max(500),
  max: z.number().int().min(1).max(20).optional(),
});

type Args = z.infer<typeof args>;

/**
 * Find S2D items matching a free-text reference. Used by the agent
 * when the user mentions an item without a ticket id ("the brand
 * spend thing"). Returns ranked candidates with confidence scores
 * (0-1). 0.99 = ticket-number hit; 0.7-0.95 = solid match; <0.5 =
 * best-guess noise.
 *
 * The agent's system prompt instructs it to:
 *   - auto-proceed if a single candidate has confidence >= 0.8
 *   - render the candidate list and ask if multiple candidates exist
 *   - ask the user to be more specific if zero candidates come back
 */
export const resolve_reference: ToolDefinition<
  Args,
  { candidates: ResolveCandidate[]; count: number }
> = {
  name: "resolve_reference",
  description:
    "Find S2D items matching a free-text reference (e.g. 'the brand spend thing'). Returns ranked candidates with confidence scores. Use this whenever the user mentions an item without a ticket id. Ticket numbers like MASH-1408 or '#1408' bypass ranking and return the exact match.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    // Pull recently-viewed ids out of the conversation's last cursor
    // snapshot if the loop stashed one. The simple path: just call the
    // resolver with no bias and let token overlap rank. Cursor bias is
    // applied by the loop separately (see attach_thread_to_item).
    const candidates = await resolveReference({
      text: input.text,
      userId: ctx.userId,
      supabase: ctx.supabase,
      max: input.max,
    });
    return { candidates, count: candidates.length };
  },
};
