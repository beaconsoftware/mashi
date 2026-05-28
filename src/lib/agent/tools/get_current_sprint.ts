import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({}).optional().default({});

type Args = z.infer<typeof args>;

/**
 * Returns the active (in-progress) sprint session if one exists. The
 * sprint blocks (slots / queue / bench) are client-side state in
 * Zustand persisted to localStorage — they don't live in a server
 * table — so this tool returns the persisted sprint_session row plus
 * the embedded `planned_items` array as the canonical server-side view
 * of what the user picked.
 *
 * Returns null when no active session exists. Phase 3 may extend this
 * with a server-side block ledger if the agent needs slot-by-slot
 * granularity beyond planned_items.
 */
export const get_current_sprint: ToolDefinition<Args, unknown> = {
  name: "get_current_sprint",
  description:
    "Return the user's active sprint session (started_at set, completed_at null) including the planned_items snapshot, theme, notes, and time totals. Returns null when no sprint is running.\n\nUse when: the user asks 'how's my sprint going?', 'what's left in this sprint?', or you need to ground a sprint-related action. Example: {}.\n\nDo NOT use to start/pause/exit a sprint — sprint lifecycle lives in the client-side store, not in tools. Do NOT use to fetch today's broader context; use get_today for that.\n\nReturns: { sprint } where sprint is the row (id, started_at, planned_items, theme, notes, totals) or null when none is active.",
  ring: "read",
  args,
  handler: async (_input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("sprint_sessions")
      .select(
        "id, started_at, completed_at, planned_items, results, total_planned_min, total_actual_min, theme, notes"
      )
      .eq("user_id", ctx.userId)
      .is("completed_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return { sprint: data ?? null };
  },
};
