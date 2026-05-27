import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

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
