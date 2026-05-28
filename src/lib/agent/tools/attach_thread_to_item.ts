import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  item_id: z.string().uuid(),
});

type Args = z.infer<typeof args>;

/**
 * Promote an orphan thread (Spotlight chat) to an item-bound thread.
 * Sets `agent_threads.item_id` and rewrites the title to use the
 * item's ticket id + title. Errors cleanly if the item already has a
 * different thread — the partial unique index guarantees one thread
 * per item, so the agent surfaces the conflict so the user can be
 * pointed to the existing thread.
 *
 * The tool reads its own thread id from the ToolContext (set by the
 * loop when a turn is running inside a thread). For thread-less call
 * sites (none today) this fails fast.
 */
export const attach_thread_to_item: ToolDefinition<
  Args,
  {
    ok: boolean;
    thread?: unknown;
    error?: string;
    existing_thread_id?: string;
  }
> = {
  name: "attach_thread_to_item",
  description:
    "Bind the current Spotlight (orphan) thread to an S2D item: sets agent_threads.item_id and rewrites the title to 'MASH-N, …'. Enforced one-thread-per-item by a partial unique index.\n\nUse when: the user picked a candidate from resolve_reference (or ask_followup_question) and the conversation is anchored to that item from here on. Example: { item_id: '…uuid…' }.\n\nDo NOT use to merge two existing item-bound threads — there is no such operation, and the unique index will reject the attach. Do NOT call before resolving the reference; ground the id first.\n\nReturns: { ok, thread } on success; { ok: false, error, existing_thread_id? } when the item already has a different thread. Intentionally NOT reversible.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    if (!ctx.threadId) {
      return {
        ok: false,
        error: "No active thread to attach. Open this from the Spotlight surface.",
      };
    }

    const item = await ctx.supabase
      .from("s2d_items")
      .select("id, ticket_number, title")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    if (item.error) throw item.error;
    if (!item.data) return { ok: false, error: "Item not found." };

    const existing = await ctx.supabase
      .from("agent_threads")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("item_id", input.item_id)
      .maybeSingle();
    if (existing.data && existing.data.id !== ctx.threadId) {
      return {
        ok: false,
        error:
          "This item already has a different thread. Open that conversation instead.",
        existing_thread_id: existing.data.id as string,
      };
    }

    const ticket = (item.data as { ticket_number: number | null }).ticket_number;
    const itemTitle = (item.data as { title: string }).title;
    const title = ticket != null ? `MASH-${ticket}, ${itemTitle}` : itemTitle;

    const upd = await ctx.supabase
      .from("agent_threads")
      .update({ item_id: input.item_id, title })
      .eq("user_id", ctx.userId)
      .eq("id", ctx.threadId)
      .select("*")
      .maybeSingle();
    if (upd.error) {
      // 23505 = unique violation. Treat the same as the existing-thread
      // case above so the agent can recover cleanly.
      const code = (upd.error as { code?: string }).code;
      if (code === "23505") {
        return {
          ok: false,
          error:
            "This item already has a different thread. Open that conversation instead.",
        };
      }
      throw upd.error;
    }

    // Intentionally NOT undoable. Binding an orphan thread is a tiny,
    // user-confirmed action; an undo strip on top of the user just
    // having clicked a candidate would be noisy.
    return { ok: true, thread: upd.data };
  },
};
