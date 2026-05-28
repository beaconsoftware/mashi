import { findSameWorkOpenItem } from "@/lib/triage/orchestrator";
import type { PreToolUseHook } from "@/lib/agent/hooks/types";

/**
 * Quality Phase 4 — dedup gate for agent-initiated creates.
 *
 * Pre-tool hook on create_item and spawn_follow_up. Calls the same
 * Sonnet-backed dedup gatekeeper the triage pipeline uses
 * (findSameWorkOpenItem) and:
 *
 *   - closed match → deny with explanation. The user already resolved
 *     this work; recreating it would just bring it back as a Review
 *     card with needs_review=true.
 *   - open match  → transform the call into an update_item against the
 *     existing row. Sets has_unseen_updates so the board flags the
 *     merge.
 *   - no match    → allow.
 *
 * The dedup call adds ~1-3s of latency on creates. Mashi's agent
 * surface uses creates sparingly (most user-initiated creates are
 * intentional), so the cost is acceptable for the consolidation win.
 *
 * Errors fall through to allow — a failed dedup shouldn't block a
 * legitimate create.
 */

interface CreateItemArgs {
  title: string;
  description?: string;
  pathway?: string;
  priority?: string;
  company_id?: string;
  source_thread_id?: string;
}

interface SpawnFollowUpArgs {
  title: string;
  pathway: string;
  parent_id: string;
}

export const dedupCreateHook: PreToolUseHook = {
  name: "dedup-create",
  matches: (toolName) =>
    toolName === "create_item" || toolName === "spawn_follow_up",
  async run(opts) {
    const { toolName, input, ctx } = opts;
    try {
      const args = input as CreateItemArgs & SpawnFollowUpArgs;
      // spawn_follow_up doesn't carry a top-level company_id (the
      // parent's company is inherited at handler time). For the dedup
      // pass we just don't restrict by company on those — the LLM
      // gatekeeper still does the work.
      const companyId =
        toolName === "create_item" ? args.company_id ?? null : null;
      const match = await findSameWorkOpenItem({
        title: args.title,
        description: args.description ?? "",
        pathway: args.pathway ?? "heads_down",
        priority: args.priority ?? "medium",
        companyId,
        excludeSourceThreadId: args.source_thread_id ?? "",
        userId: ctx.userId,
      });
      if (!match) return { decision: "allow" };
      if (match.was_closed) {
        return {
          decision: "deny",
          message: `Skipped: same work as recently-closed item ${match.id} "${match.title}". ${match.rationale} If the user still wants this, ask them to confirm before re-creating.`.trim(),
        };
      }
      // Open match — surface a non-error synthetic result with the
      // matched id so the model can decide whether to call update_item
      // on the existing row itself (the agent's update_item handler
      // owns the patch validation; we don't try to author a patch from
      // the hook here because the dedup fields the triage path uses
      // aren't in the public update_item schema).
      const synth = {
        ok: false,
        deduped: true,
        matched_item_id: match.id,
        matched_item_title: match.title,
        rationale: match.rationale,
        next_step:
          "An open item already represents this work. If you need to enrich it, call update_item on matched_item_id; otherwise tell the user.",
      };
      return {
        decision: "respond",
        content: JSON.stringify(synth),
        isError: false,
      };
    } catch {
      // Dedup is advisory; if Sonnet hiccups we let the create through.
      return { decision: "allow" };
    }
  },
};
