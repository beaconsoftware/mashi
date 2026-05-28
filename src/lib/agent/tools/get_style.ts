import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { StyleProfile } from "@/types/style";

const args = z.object({}).optional().default({});

type Args = z.infer<typeof args>;

interface Result {
  profile: StyleProfile | null;
  meta: {
    profile_age_days: number | null;
    notes: string[];
  };
}

/**
 * Returns the user's cached StyleProfile.
 *
 * The cached profile IS the source of truth — it was extracted from a
 * curated batch of the user's actual sent messages via /settings/style
 * and contains the summary, voice traits, recurring phrases, greeting/
 * sign-off, and up to N few-shot examples. That's everything an agent
 * needs to draft in the user's voice.
 *
 * Earlier revisions of this tool also pulled 12 fresh recent self-sent
 * messages plus 8 recipient-specific samples on every call. That was
 * removed: the live samples were token bloat (~3-5k tokens per call),
 * added noise (boilerplate, one-liners, auto-replies that the
 * extractor had already filtered out), and undermined the point of
 * caching a curated profile. If voice has drifted, re-extract via
 * /settings/style; don't paper over it with live samples.
 */
export const get_style: ToolDefinition<Args, Result> = {
  name: "get_style",
  description:
    "Return the cached StyleProfile (summary, voice traits, greeting / sign-off, recurring phrases, few-shot examples) the user extracted at /settings/style. The cached profile is the single source of truth; this tool does not pull live samples.\n\nUse when: drafting an email or Slack message the user will sign, so the output matches their voice. Example: {}.\n\nDo NOT use as a pre-write boilerplate check on every turn — only call before drafting external messages. Call before draft_email / send_email / send_slack_message; skip for internal board edits.\n\nReturns: { profile, meta }. profile is null when extraction hasn't been run; meta.notes flags stale / missing profiles so the agent can prompt the user to re-extract.",
  ring: "read",
  args,
  handler: async (_input, ctx) => {
    const notes: string[] = [];

    const profileRow = await ctx.supabase
      .from("user_profile")
      .select("communication_style")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const profile =
      (profileRow.data?.communication_style as StyleProfile | null) ?? null;
    if (!profile) {
      notes.push(
        "No style profile saved yet. Have the user run extraction at /settings/style — without it, drafts will fall back to a generic direct-executive voice."
      );
    }

    const ageDays = profile?.extracted_at
      ? Math.floor(
          (Date.now() - new Date(profile.extracted_at).getTime()) / 86_400_000
        )
      : null;
    if (ageDays != null && ageDays > 30) {
      notes.push(
        `Profile is ${ageDays} days old. If recent drafts feel off, suggest re-extracting from /settings/style.`
      );
    }

    return {
      profile,
      meta: {
        profile_age_days: ageDays,
        notes,
      },
    };
  },
};
