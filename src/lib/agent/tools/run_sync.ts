import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { syncLinearConnection } from "@/lib/sync/linear-sync";
import { syncGmailConnection } from "@/lib/sync/gmail-sync";
import { syncGCalConnection } from "@/lib/sync/gcal-sync";
import { syncSlackConnection } from "@/lib/sync/slack-sync";
import { syncFirefliesConnection } from "@/lib/sync/fireflies-sync";

type Provider = "linear" | "gmail" | "gcal" | "slack" | "fireflies";

const args = z.object({
  provider: z.enum(["linear", "gmail", "gcal", "slack", "fireflies"]).optional(),
  connection_id: z.string().uuid().optional(),
});

type Args = z.infer<typeof args>;

export const run_sync: ToolDefinition<Args, unknown> = {
  name: "run_sync",
  description:
    "Trigger a fresh sync of the user's connected providers (linear, gmail, gcal, slack, fireflies). With no args, syncs every connection. With provider or connection_id, scopes to that subset. Always user-scoped.\n\nUse when: the user says 'I just sent that email, can you check?' or 'is my Linear up to date?' — anything that suggests upstream data has changed since the last sync. Example: { provider: 'gmail' }.\n\nDo NOT use as a default at turn start (sync runs nightly + on demand from /settings/connections). Do NOT use to fetch synced data — read tools (search_*, get_*) hit the DB directly.\n\nReturns: { ok, summary, results }. results[] has per-connection ok + detail; ok=false on any failure.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("connected_accounts")
      .select("id, provider, account_label")
      .eq("user_id", ctx.userId);

    if (input.connection_id) q = q.eq("id", input.connection_id);
    else if (input.provider) q = q.eq("provider", input.provider);

    const { data: conns, error } = await q;
    if (error) throw new Error(`load connections: ${error.message}`);
    if (!conns || conns.length === 0) {
      return { ok: false, message: "no matching connections", results: [] };
    }

    const results: Array<{
      connection_id: string;
      provider: string;
      label: string | null;
      ok: boolean;
      detail: unknown;
    }> = [];

    for (const c of conns) {
      try {
        let detail: unknown;
        switch (c.provider as Provider) {
          case "linear":
            detail = await syncLinearConnection(c.id);
            break;
          case "gmail":
            detail = await syncGmailConnection(c.id);
            break;
          case "gcal":
            detail = await syncGCalConnection(c.id);
            break;
          case "slack":
            detail = await syncSlackConnection(c.id);
            break;
          case "fireflies":
            detail = await syncFirefliesConnection(c.id);
            break;
          default:
            throw new Error(`unsupported provider: ${c.provider}`);
        }
        results.push({
          connection_id: c.id,
          provider: c.provider,
          label: c.account_label,
          ok: true,
          detail,
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : JSON.stringify(err);
        results.push({
          connection_id: c.id,
          provider: c.provider,
          label: c.account_label,
          ok: false,
          detail: { error: message },
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return {
      ok: okCount === results.length,
      summary: `${okCount}/${results.length} connections synced`,
      results,
    };
  },
};
