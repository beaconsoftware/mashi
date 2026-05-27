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
    "Returns the latest cursor context (route, focused item, sprint state, etc.) the user has, if available. Returns null when called from MCP/PAT contexts — only the in-app agent has a live cursor.",
  ring: "read",
  args,
  handler: async () => {
    return { cursor: null };
  },
};
