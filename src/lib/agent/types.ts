import type { z } from "zod";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ApprovalContext } from "@/lib/agent/approval-meta";

/**
 * Foundations for the Mashi Agent — Phase 1.
 *
 * Every agent-callable capability is a `ToolDefinition`. The same shape
 * is consumed by:
 *   - `mcpTool` (existing) — bearer-token auth, external MCP server.
 *   - `sessionTool` (new) — Supabase session cookie auth, in-app agent.
 *   - the in-app agent loop (Phase 2) — calls `def.handler` directly
 *     after the model picks a tool from `TOOL_REGISTRY`.
 *
 * Three things keep the wrappers honest:
 *   1. `args` is a zod schema, so every caller validates before the
 *      handler runs. The handler can rely on the parsed shape.
 *   2. `ring` declares whether the call reads, writes Mashi state, or
 *      writes external systems. The loop uses it to decide whether to
 *      stream a result, push an undo strip, or pause for approval.
 *   3. `ctx.origin` tells the handler whether it's running as PAT,
 *      session cookie, or a server-side automation — useful for
 *      audit + telemetry without re-plumbing on every site.
 */

export type ToolRing = "read" | "write_mashi" | "write_world";

export interface ToolContext {
  /** Always present — every code path resolves a user before handing
   * off to a tool. */
  userId: string;
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  /** Provenance for audit + telemetry. */
  origin: "mcp" | "session" | "background";
  /** The thread the call is happening inside, if any. Used by ring 2/3
   * write tools (Phase 3+) to write an audit row tied to a
   * conversation. Empty for Phase 1 reads. */
  threadId?: string;
  /** A3/A5: the in-flight turn's abort signal, when the call originates
   * from a streaming route. The ring-3 approval hook threads it into its
   * poll so an abandoned approval (closed tab, Stop) stops polling within
   * one interval instead of burning the full 270s window. */
  signal?: AbortSignal;
}

export interface ToolDefinition<TArgs, TResult> {
  name: string;
  description: string;
  ring: ToolRing;
  args: z.ZodType<TArgs>;
  handler: (input: TArgs, ctx: ToolContext) => Promise<TResult>;
  /**
   * E2: optional before-snapshot for the approval card. Ring-3 update tools
   * implement this to read the resource's current values (cheaply, from the
   * local mirror) so the approval card can diff them against the proposed
   * `patch`. Runs in the ring-3 approval hook BEFORE the row is created, so
   * keep it light and best-effort — return `null` if nothing useful can be
   * read, and never throw (the hook swallows failures rather than blocking
   * the approval). Owner-scoping is the caller's responsibility: filter by
   * `ctx.userId` exactly as the handler does.
   */
  approvalContext?: (
    input: TArgs,
    ctx: ToolContext
  ) => Promise<ApprovalContext | null>;
}

/** Helper for any-typed registry entries. The registry has to be
 * heterogeneous (every tool has a different args/result shape), so
 * consumers cast back to a concrete `ToolDefinition<A, R>` at use
 * sites — or just rely on the zod schema for runtime safety. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>;

/**
 * Cursor context — what the user is looking at when they type a turn.
 *
 * The loop injects a serialized snapshot of this as a system message
 * on every turn so the agent can answer "what about this one?" without
 * the user spelling out a ticket id.
 */
export interface CursorContext {
  /** Pathname the user is on. e.g. "/cockpit", "/s2d", "/sprint". */
  route: string;
  /** The single item the user is focused on right now (detail sheet,
   * sprint slot, board card hover). */
  focusedItemId?: string;
  /** Multi-select on the board, when present. */
  selectedItemIds?: string[];
  /** Active sprint state when the planner is engaged. */
  activeSprint?: {
    /** Persisted sprint session id. May not yet exist client-side; we
     * still convey what slot is in focus. */
    sprintId?: string;
    focusedSlotItemId?: string;
    queueItemIds: string[];
  };
  /** Which side surface is open, if any. */
  openSheet?: "detail" | "refine" | "spotlight" | null;
  /** Recent S2D item ids the user has touched — biases the reference
   * resolver in Phase 4. Last 5. */
  recentlyViewedItemIds?: string[];
  /** ISO timestamp captured at turn start. */
  now: string;
}
