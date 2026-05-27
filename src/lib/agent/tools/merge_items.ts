import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";
import { appendMessage } from "@/lib/agent/threads";

const args = z.object({
  primary_id: z.string().uuid(),
  duplicate_ids: z.array(z.string().uuid()).min(1).max(10),
});

type Args = z.infer<typeof args>;

/**
 * Merge one or more duplicate items into a primary. Each duplicate is
 * soft-deleted (status=done, resolved_via=merged). The primary keeps
 * its title and description; if the merge should also rewrite the
 * primary's prose, the caller chains update_item separately.
 *
 * Undo restores the duplicates to their prior status and clears
 * resolved_via.
 */
export const merge_items: ToolDefinition<
  Args,
  {
    ok: boolean;
    primary?: unknown;
    duplicates?: unknown[];
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "merge_items",
  description:
    "Merge duplicate items into a primary. Duplicates are soft-deleted (status=done, resolved_via=merged). Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    if (input.duplicate_ids.includes(input.primary_id)) {
      return { ok: false, error: "primary_id cannot also be a duplicate." };
    }

    const primary = await ctx.supabase
      .from("s2d_items")
      .select("id, ticket_number, title, description")
      .eq("user_id", ctx.userId)
      .eq("id", input.primary_id)
      .maybeSingle();
    if (primary.error) throw primary.error;
    if (!primary.data) return { ok: false, error: "Primary item not found." };

    const dupes = await ctx.supabase
      .from("s2d_items")
      .select("id, status")
      .eq("user_id", ctx.userId)
      .in("id", input.duplicate_ids);
    if (dupes.error) throw dupes.error;
    const found = (dupes.data ?? []) as Array<{ id: string; status: string }>;
    if (found.length !== input.duplicate_ids.length) {
      return { ok: false, error: "Some duplicate ids were not found." };
    }
    const priorStatuses: Record<string, string> = {};
    for (const row of found) priorStatuses[row.id] = row.status;

    const { data: updated, error } = await ctx.supabase
      .from("s2d_items")
      .update({
        status: "done",
        resolved_via: "merged",
        done_at: new Date().toISOString(),
      })
      .eq("user_id", ctx.userId)
      .in("id", input.duplicate_ids)
      .select("*");
    if (error) throw error;

    const ticket = primary.data.ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : "item";

    // Phase 4 lifecycle continuity: if the duplicates had threads,
    // absorb their messages into the primary's thread under a system
    // separator, then orphan their thread rows. Best-effort — a
    // partial absorb still leaves the merge itself committed.
    try {
      const primaryThread = await ctx.supabase
        .from("agent_threads")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("item_id", input.primary_id)
        .maybeSingle();
      const dupThreads = await ctx.supabase
        .from("agent_threads")
        .select("id, item_id")
        .eq("user_id", ctx.userId)
        .in("item_id", input.duplicate_ids);
      const dupThreadRows = (dupThreads.data ?? []) as Array<{
        id: string;
        item_id: string;
      }>;
      if (dupThreadRows.length > 0 && primaryThread.data) {
        const primaryThreadId = primaryThread.data.id as string;
        for (const dt of dupThreadRows) {
          await appendMessage({
            userId: ctx.userId,
            threadId: primaryThreadId,
            role: "system",
            content: `Absorbed thread from duplicate item ${dt.item_id} on ${new Date().toISOString().slice(0, 10)}.`,
            supabase: ctx.supabase,
          });
          // Move the duplicate's messages onto the primary thread,
          // preserving original timestamps so chronology survives.
          await ctx.supabase
            .from("agent_messages")
            .update({ thread_id: primaryThreadId })
            .eq("user_id", ctx.userId)
            .eq("thread_id", dt.id);
        }
        // Orphan the absorbed thread rows (item_id -> null) so the
        // unique-per-item constraint doesn't block a future thread on
        // a re-opened duplicate. Title gets a marker so the user can
        // recognize the row in list_recent_threads.
        await ctx.supabase
          .from("agent_threads")
          .update({ item_id: null, title: `[merged into ${ref}]` })
          .eq("user_id", ctx.userId)
          .in(
            "id",
            dupThreadRows.map((r) => r.id)
          );
      }
    } catch {
      // best-effort
    }

    return {
      ok: true,
      primary: primary.data,
      duplicates: updated ?? [],
      _undo: {
        summary: `Merged ${input.duplicate_ids.length} item${
          input.duplicate_ids.length === 1 ? "" : "s"
        } into ${ref}`,
        op: {
          kind: "restore_merge",
          primary_id: input.primary_id,
          prior_primary_title: primary.data.title,
          prior_primary_description: primary.data.description,
          duplicate_ids: input.duplicate_ids,
          prior_duplicate_statuses: priorStatuses,
        },
      },
    };
  },
};
