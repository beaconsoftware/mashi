import { mcpTool } from "@/lib/mcp/handler";
import { collectWritingSamples, type RichSample } from "@/lib/style/sample-collector";
import type { StyleProfile } from "@/types/style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * get_style — everything an external Claude/agent needs to write in
 * the user's voice.
 *
 * Returns three things:
 *   1. `profile`            — the cached StyleProfile (summary, traits,
 *                             greeting/signoff, recurring_phrases,
 *                             few_shot_examples). Re-extract via the UI
 *                             at /settings/style; this tool never
 *                             triggers a re-extract (separation of
 *                             concerns, and re-extract is a heavy LLM
 *                             call).
 *   2. `recent_samples`     — a fresh batch of self-sent messages
 *                             (Gmail in:sent + Slack DMs) so the caller
 *                             can ground in CURRENT voice even if the
 *                             cached profile is weeks old.
 *   3. `samples_for_recipient` — when `recipient_email` (or a
 *                             `company_id` whose `email_domain` can
 *                             stand in for a recipient hint) is given,
 *                             samples specifically of how the user
 *                             writes to that person / org. Higher signal
 *                             than the generic recent batch for
 *                             "draft a reply to X" flows.
 *
 * All three are returned together because the calling agent usually
 * wants both context layers in one call.
 */
interface Args {
  /** Specific recipient email — narrows Gmail `q` to `to:<email>` and
   *  resolves them in Slack via users.lookupByEmail. */
  recipient_email?: string;
  /** Company UUID — its `email_domain` is used as a recipient hint
   *  (Gmail `to:@domain` style). */
  company_id?: string;
  /** Restrict to one channel only. Default: both. */
  channel?: "gmail" | "slack";
  /** Size of `recent_samples`. Default 12, max 50. */
  limit?: number;
}

interface Result {
  profile: StyleProfile | null;
  recent_samples: RichSample[];
  /** Present only when a recipient filter was provided. */
  samples_for_recipient?: RichSample[];
  /** Useful for the caller to decide whether to suggest a re-extract. */
  meta: {
    profile_age_days: number | null;
    recent_count: number;
    recipient_count: number | null;
    per_account: Array<{ provider: string; account_label: string; count: number }>;
    notes: string[];
  };
}

export const POST = mcpTool<Args, Result>(async (args, ctx) => {
  const limit = Math.min(Math.max(args.limit ?? 12, 1), 50);
  const notes: string[] = [];

  // 1. Cached profile
  const profileRow = await ctx.supabase
    .from("user_profile")
    .select("communication_style")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const profile = (profileRow.data?.communication_style as StyleProfile | null) ?? null;
  if (!profile) {
    notes.push(
      "No style profile saved yet. Run extraction from /settings/style — until then, ground in recent_samples only."
    );
  }

  // 2. Resolve company_id → recipient hint (an email like @domain) if given
  let recipientHint = args.recipient_email ?? null;
  if (!recipientHint && args.company_id) {
    const co = await ctx.supabase
      .from("companies")
      .select("email_domain")
      .eq("user_id", ctx.userId)
      .eq("id", args.company_id)
      .maybeSingle();
    if (co.data?.email_domain) {
      // Gmail accepts `to:@domain.com` as a domain match
      recipientHint = `@${co.data.email_domain.replace(/^@/, "")}`;
    } else {
      notes.push(`company_id ${args.company_id} has no email_domain — falling back to generic samples.`);
    }
  }

  // 3. Live-fetch recent samples (always) + recipient-specific samples (if hint).
  //    Run in parallel — they call distinct Gmail queries.
  const [recent, recipient] = await Promise.all([
    collectWritingSamples({
      userId: ctx.userId,
      target: limit,
      channel: args.channel,
    }).catch((err) => {
      notes.push(`recent_samples collection failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }),
    recipientHint
      ? collectWritingSamples({
          userId: ctx.userId,
          target: 8,
          channel: args.channel,
          recipientEmail: recipientHint,
        }).catch((err) => {
          notes.push(`samples_for_recipient collection failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const recentSamples = recent?.rich_samples ?? [];
  const recipientSamples = recipient?.rich_samples ?? null;

  // 4. Provenance
  const ageDays = profile?.extracted_at
    ? Math.floor((Date.now() - new Date(profile.extracted_at).getTime()) / 86_400_000)
    : null;
  if (ageDays != null && ageDays > 30) {
    notes.push(`Profile is ${ageDays} days old — voice may have drifted. Consider re-extracting.`);
  }

  return {
    profile,
    recent_samples: recentSamples,
    samples_for_recipient: recipientSamples ?? undefined,
    meta: {
      profile_age_days: ageDays,
      recent_count: recentSamples.length,
      recipient_count: recipientSamples ? recipientSamples.length : null,
      per_account: recent?.perAccount ?? [],
      notes,
    },
  };
});
