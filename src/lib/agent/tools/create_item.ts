import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { recordAction } from "@/lib/agent/undo";

const args = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  pathway: z
    .enum([
      "quick_reply",
      "drafted_response",
      "meeting_backed",
      "heads_down",
      "decision_gate",
      "delegated",
      "watching",
    ])
    .default("heads_down"),
  priority: z.enum(["urgent", "high", "medium", "low"]).default("medium"),
  status: z.enum(["backlog", "todo", "in_queue"]).default("todo"),
  company_id: z.string().uuid().optional(),
  source_type: z
    .enum([
      "linear",
      "gmail",
      "slack",
      "fireflies",
      "granola",
      "calendar",
      "manual",
    ])
    .default("manual"),
  source_thread_id: z.string().optional(),
  planned_for: z.string().nullable().optional(),
});

type Args = z.infer<typeof args>;

/**
 * Create a brand-new S2D item. The undo deletes the inserted row.
 *
 * Note: ticket_number is auto-populated by the per-user sequence
 * trigger from migration 014; we don't set it here.
 */
export const create_item: ToolDefinition<Args, unknown> = {
  name: "create_item",
  description:
    "Create a new S2D item (title required). Defaults: pathway=heads_down, priority=medium, status=todo, source_type=manual. Ring 2, undoable for 30s.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const row: Record<string, unknown> = {
      user_id: ctx.userId,
      title: input.title,
      pathway: input.pathway,
      priority: input.priority,
      status: input.status,
      source_type: input.source_type,
    };
    if (input.description) row.description = input.description;
    if (input.company_id) row.company_id = input.company_id;
    if (input.source_thread_id) row.source_thread_id = input.source_thread_id;
    if (input.planned_for !== undefined) row.planned_for = input.planned_for;

    const ins = await ctx.supabase
      .from("s2d_items")
      .insert(row)
      .select("*")
      .single();
    if (ins.error || !ins.data) {
      throw ins.error ?? new Error("create_item insert failed");
    }

    const created = ins.data as Record<string, unknown>;
    const ref =
      created.ticket_number != null
        ? `MASH-${created.ticket_number}`
        : input.title;

    const { actionId, expiresAt } = await recordAction({
      userId: ctx.userId,
      threadId: ctx.threadId ?? null,
      toolName: "create_item",
      ring: "write_mashi",
      args: input,
      result: created,
      ok: true,
      summary: `Created ${ref}, ${input.title}`,
      undoPayload: {
        kind: "delete_row",
        table: "s2d_items",
        id: created.id as string,
      },
      supabase: ctx.supabase,
    });

    return {
      item: created,
      _agent_action_id: actionId,
      _undo_expires_at: expiresAt,
      _undo_summary: `Created ${ref}, ${input.title}`,
    };
  },
};
