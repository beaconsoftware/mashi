import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";
import {
  buildMemoryAppend,
  MASHI_MD_MAX_CHARS,
  normalizeFact,
} from "@/lib/agent/memory";

const args = z.object({
  fact: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "The single durable fact to remember, phrased as a standalone line (e.g. 'Prefers bullet-point summaries over prose', 'The brand thing means MAP-435'). One fact per call."
    ),
});

type Args = z.infer<typeof args>;

/**
 * F1 (P6.a) — agent-proposed MASHI.md memory write.
 *
 * MASHI.md is the user's free-text memory the loop re-reads fresh every turn
 * (loop.ts injects it as an ephemeral user message). Until now only the human
 * settings editor wrote it; this tool lets the agent OFFER to remember a
 * durable fact it learned mid-conversation.
 *
 * It is ring-2 (`write_mashi`) so the append is audited and undoable for 30s,
 * AND it carries `requiresApproval: true` so it routes through the approval
 * gate as a LIGHT confirm card (approval-meta classifies it `reversible`):
 * the user sees the exact line that will be appended and accepts / edits /
 * cancels before anything is written. There is no automatic, un-confirmed
 * memory write — that's deliberately out of scope.
 *
 * Append semantics + the 8000-char cap live in the pure `memory.ts` module so
 * they're unit-tested (`pnpm test:memory`). When the append would breach the
 * cap the tool returns `ok: false` with a reason, so the model can offer to
 * consolidate rather than silently dropping the memory.
 */
export const propose_memory: ToolDefinition<
  Args,
  {
    ok: boolean;
    appended?: string;
    mashi_md_length?: number;
    near_limit?: boolean;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "propose_memory",
  description:
    "Offer to remember a durable fact about the user in their MASHI.md memory (re-read on every future turn). Use when you learn something stable and reusable: a lasting preference ('always wants bullets'), a personal mapping ('the brand thing means MAP-435'), a recurring person/team, or a standing instruction. The user confirms the exact line before it's saved (a light approval card), and the append is undoable for 30 seconds.\n\nDo NOT use for one-off, task-specific, or already-stated-in-MASHI.md facts, or to store secrets. One fact per call, phrased as a standalone line. Example: { fact: 'Prefers concise bullet summaries over prose' }.\n\nReturns: { ok, appended, mashi_md_length, near_limit } on success; { ok: false, error } when the fact is empty or would exceed the 8000-char memory cap (offer to consolidate). Reversible for 30 seconds.",
  ring: "write_mashi",
  // Routes through the approval gate as a light confirm (see ring3-approval).
  requiresApproval: true,
  args,
  handler: async (input, ctx) => {
    // Read the current memory, owner-scoped (multi-tenancy: service-role read
    // MUST filter by user_id).
    const { data: profile, error: readErr } = await ctx.supabase
      .from("user_profile")
      .select("id, mashi_md")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (readErr) throw readErr;

    const current = ((profile as { mashi_md?: string } | null)?.mashi_md ?? "")
      .toString();
    const result = buildMemoryAppend(current, input.fact, MASHI_MD_MAX_CHARS);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const profileId = (profile as { id?: string } | null)?.id;
    if (profileId) {
      const { error } = await ctx.supabase
        .from("user_profile")
        .update({ mashi_md: result.next })
        .eq("user_id", ctx.userId)
        .eq("id", profileId);
      if (error) throw error;
    } else {
      // Defensive: the signup trigger creates user_profile, but if it's
      // somehow absent, insert with the owner id explicitly (service-role
      // INSERTs must set user_id — the auth.uid() default is NULL here).
      const { error } = await ctx.supabase
        .from("user_profile")
        .insert({ user_id: ctx.userId, mashi_md: result.next });
      if (error) throw error;
    }

    const clean = normalizeFact(input.fact);
    const summary =
      clean.length > 60 ? `Remembered: ${clean.slice(0, 57)}...` : `Remembered: ${clean}`;

    return {
      ok: true,
      appended: clean,
      mashi_md_length: result.length,
      near_limit: result.nearLimit,
      _undo: {
        summary,
        op: { kind: "restore_mashi_md", prior: current },
      },
    };
  },
};
