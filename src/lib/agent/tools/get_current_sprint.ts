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
    "Active sprint session if one is in progress (started_at set, completed_at null). Returns null otherwise. Includes planned_items snapshot taken at sprint start.",
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
