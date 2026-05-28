import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({}).optional().default({});

type Args = z.infer<typeof args>;

/**
 * Returns the cursor context the in-app agent loop already injects as a
 * system message. Exposed as a callable tool so the model can re-read
 * it mid-conversation if it needs to refresh ("what was I just looking
 * at again?"), and so MCP / DXT callers can introspect what the
 * in-app agent would see.
 *
 * The MCP origin has no live cursor, so the response is `null` — the
 * in-app loop fills in the snapshot at turn start via a different
 * path (see `runAgentTurn` in `loop.ts`). Callers should treat null as
 * "no live cursor available" rather than an error.
 */
export const get_cursor_context: ToolDefinition<Args, unknown> = {
  name: "get_cursor_context",
  description:
    "Return the latest cursor context (route, focused item, multi-select, active sprint, recently viewed) the in-app agent already has from the user's session. MCP / PAT callers always get null (no live cursor outside the browser).\n\nUse when: you've already received the cursor preamble but want to re-introspect it mid-turn (rare), or you're running via MCP and want to confirm you have no cursor. Example: {}.\n\nDo NOT use as the first call on every in-app turn — the loop already injects this into the system prompt. Don't bloat tokens with redundant retrieval.\n\nReturns: { cursor }. cursor is null for MCP / PAT origins.",
  ring: "read",
  args,
  handler: async () => {
    return { cursor: null };
  },
};
