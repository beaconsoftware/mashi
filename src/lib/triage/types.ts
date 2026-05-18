import type { Pathway, Priority, SourceType } from "@/types";

/**
 * Triage v1 contract.
 *
 * Per source unit (Gmail thread, Slack day-slice, Fireflies meeting, Linear
 * issue, Calendar event), a Sonnet-tier triage call returns a set of
 * operations to apply against the user's S2D board.
 *
 * The agent always sees:
 *   - The unit content (thread, slice, transcript, etc.)
 *   - All currently OPEN S2D items associated with this unit (by source_thread_id)
 *   - The user's Beacon-ownership framing in the system prompt
 *
 * It returns a TriageResult with zero or more operations. Code applies them
 * against the database under an audit trail (triage_runs).
 */

export interface TriageCreateOp {
  op: "create";
  title: string;
  description?: string;
  priority: Priority;
  pathway: Pathway;
  /**
   * Column on the S2D board the new item lands in. Optional — defaults to
   * "todo". Agent uses "backlog" for legitimate-but-not-this-week work and
   * "in_queue" when the item is already waiting on something external.
   */
  status?: "backlog" | "todo" | "in_queue";
  est_minutes?: number;
  /** "Why this is on your board even though it wasn't addressed to you." */
  ownership_note?: string;
  /** When closing reflects an external deadline. ISO date. */
  due_hint?: string;
  /** If `pathway = delegated`, who's actually doing it. */
  delegated_to?: string;
  /** When status="in_queue", short label shown on the card. */
  queue_reason?: string;
  /**
   * 1-2 sentence explanation of WHY this priority + pathway, surfaced
   * on the review-deck card so the user can swipe-approve confidently
   * without context-switching back to the source.
   */
  justification?: string;
}

export interface TriageUpdateOp {
  op: "update";
  s2d_item_id: string;
  patch: Partial<{
    title: string;
    description: string;
    priority: Priority;
    pathway: Pathway;
    status: "backlog" | "todo" | "in_progress" | "in_queue";
    queue_reason: string;
    est_minutes: number;
  }>;
  reason: string;
}

export interface TriageCloseOp {
  op: "close";
  s2d_item_id: string;
  outcome: string;
  /** "auto" — close immediately. "approval" — render an Approval Card for user. */
  confidence: "auto" | "approval";
}

export type TriageOp = TriageCreateOp | TriageUpdateOp | TriageCloseOp;

export interface TriageResult {
  /** Operations to apply. Empty array = noop. */
  operations: TriageOp[];
  /** One-line explanation of the agent's reasoning, surfaced in audit log. */
  rationale: string;
}

/**
 * The shape of an existing S2D item we pass into the triage prompt.
 * Trimmed to keep tokens down.
 */
export interface ExistingS2DContext {
  id: string;
  title: string;
  status: string;
  pathway: string;
  priority: string;
  created_at: string;
  /**
   * How many source touches this item has accumulated (length of
   * linked_sources). Surfaced to the triage agent as a recurrence
   * signal — "this work has shown up N times across sources" — so
   * the priority decision can lean on cross-source repetition.
   */
  linked_sources_count?: number;
}

export interface TriageUnit {
  source_type: SourceType;
  source_thread_id: string;
  /** Used in the source_label for any new S2D items created. */
  source_label: string;
  /** Company this unit belongs to. May be null if we can't tell. */
  company_id: string | null;
  /** The actual content the agent reasons over. Source-specific shape. */
  content: unknown;
  /** Open S2D items already attached to this unit. */
  existing_items: ExistingS2DContext[];
}
