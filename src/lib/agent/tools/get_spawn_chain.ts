import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  item_id: z.string().uuid(),
  /** Cap the walk in either direction so a runaway chain can't explode. */
  max_depth: z.number().int().min(1).max(20).optional(),
});

type Args = z.infer<typeof args>;

interface ChainNode {
  id: string;
  ticket_number: number | null;
  title: string;
  pathway: string;
  status: string;
  spawned_from_item_id: string | null;
  created_at: string;
}

/**
 * Walks the spawn chain for an item: every ancestor via
 * `spawned_from_item_id`, plus every descendant.
 *
 * Why this lives as a tool: re-pathway / spawn-follow-up flows can
 * produce multi-step chains (e.g. a decision spawns a watch item that
 * later spawns a follow-up reply). When the agent reads one item in
 * isolation it loses that lineage; this tool restores it cheaply.
 *
 * Iterative (no recursive CTE) so it works against the existing schema
 * without needing a new view. The depth caps keep it bounded.
 */
export const get_spawn_chain: ToolDefinition<Args, unknown> = {
  name: "get_spawn_chain",
  description:
    "Walks the spawn chain (ancestors via spawned_from_item_id + descendants) for a given item. Caps traversal depth at max_depth (default 10, max 20).",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const maxDepth = Math.min(Math.max(input.max_depth ?? 10, 1), 20);

    async function load(id: string): Promise<ChainNode | null> {
      const { data } = await ctx.supabase
        .from("s2d_items")
        .select(
          "id, ticket_number, title, pathway, status, spawned_from_item_id, created_at"
        )
        .eq("user_id", ctx.userId)
        .eq("id", id)
        .maybeSingle();
      return (data as ChainNode | null) ?? null;
    }

    const root = await load(input.item_id);
    if (!root) return { root: null, ancestors: [], descendants: [] };

    // Walk up.
    const ancestors: ChainNode[] = [];
    let cursor: string | null = root.spawned_from_item_id;
    let steps = 0;
    while (cursor && steps < maxDepth) {
      const node: ChainNode | null = await load(cursor);
      if (!node) break;
      ancestors.push(node);
      cursor = node.spawned_from_item_id;
      steps += 1;
    }

    // Walk down via children query (one round-trip per level).
    const descendants: ChainNode[] = [];
    let frontier: string[] = [root.id];
    let depth = 0;
    while (frontier.length > 0 && depth < maxDepth) {
      const { data } = await ctx.supabase
        .from("s2d_items")
        .select(
          "id, ticket_number, title, pathway, status, spawned_from_item_id, created_at"
        )
        .eq("user_id", ctx.userId)
        .in("spawned_from_item_id", frontier);
      const children = (data as ChainNode[] | null) ?? [];
      if (children.length === 0) break;
      descendants.push(...children);
      frontier = children.map((c) => c.id);
      depth += 1;
    }

    return { root, ancestors, descendants };
  },
};
