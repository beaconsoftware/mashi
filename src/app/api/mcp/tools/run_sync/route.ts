import { mcpTool } from "@/lib/mcp/handler";
import { syncLinearConnection } from "@/lib/sync/linear-sync";
import { syncGmailConnection } from "@/lib/sync/gmail-sync";
import { syncGCalConnection } from "@/lib/sync/gcal-sync";
import { syncSlackConnection } from "@/lib/sync/slack-sync";
import { syncFirefliesConnection } from "@/lib/sync/fireflies-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Provider = "linear" | "gmail" | "gcal" | "slack" | "fireflies";

interface Args {
  /**
   * Restrict to a single provider. If omitted, all of the caller's
   * connections are synced.
   */
  provider?: Provider;
  /**
   * Restrict to a single connection id. Takes precedence over `provider`.
   */
  connection_id?: string;
}

/**
 * Trigger a fresh sync for one or more of the caller's connections.
 *
 * This is the Bearer-authed equivalent of /api/sync/[provider]/[connectionId]
 * (which is session-authed). Useful for re-running a sync after a fix without
 * going through the dashboard UI — e.g. via the DXT or from a script.
 *
 * Always user-scoped: the connections list comes from a filter on
 * ctx.userId, so a caller can never sync someone else's connection by
 * guessing a connection_id.
 */
export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  // Load the connections the caller is allowed to sync.
  let q = ctx.supabase
    .from("connected_accounts")
    .select("id, provider, account_label")
    .eq("user_id", ctx.userId);

  if (args.connection_id) q = q.eq("id", args.connection_id);
  else if (args.provider) q = q.eq("provider", args.provider);

  const { data: conns, error } = await q;
  if (error) throw new Error(`load connections: ${error.message}`);
  if (!conns || conns.length === 0) {
    return { ok: false, message: "no matching connections", results: [] };
  }

  // Run each sync sequentially. Concurrent syncs can hammer one provider's
  // rate limits and a single-threaded run is fast enough for typical 2-9
  // connections per user.
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
      // formatSyncError already ran inside the per-provider catch — but
      // the error re-thrown here can still be non-Error. Surface as much
      // as possible to the caller.
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
});
