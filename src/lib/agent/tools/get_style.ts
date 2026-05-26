import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { collectWritingSamples, type RichSample } from "@/lib/style/sample-collector";
import type { StyleProfile } from "@/types/style";

const args = z.object({
  recipient_email: z.string().optional(),
  company_id: z.string().uuid().optional(),
  channel: z.enum(["gmail", "slack"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

type Args = z.infer<typeof args>;

interface Result {
  profile: StyleProfile | null;
  recent_samples: RichSample[];
  samples_for_recipient?: RichSample[];
  meta: {
    profile_age_days: number | null;
    recent_count: number;
    recipient_count: number | null;
    per_account: Array<{ provider: string; account_label: string; count: number }>;
    notes: string[];
  };
}

export const get_style: ToolDefinition<Args, Result> = {
  name: "get_style",
  description:
    "Voice profile + live writing samples. Returns the cached StyleProfile (from /settings/style), a fresh batch of recent self-sent messages, and recipient-specific samples when a recipient_email or company_id is provided.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(input.limit ?? 12, 1), 50);
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
        "No style profile saved yet. Run extraction from /settings/style — until then, ground in recent_samples only."
      );
    }

    let recipientHint = input.recipient_email ?? null;
    if (!recipientHint && input.company_id) {
      const co = await ctx.supabase
        .from("companies")
        .select("email_domain")
        .eq("user_id", ctx.userId)
        .eq("id", input.company_id)
        .maybeSingle();
      if (co.data?.email_domain) {
        recipientHint = `@${co.data.email_domain.replace(/^@/, "")}`;
      } else {
        notes.push(
          `company_id ${input.company_id} has no email_domain — falling back to generic samples.`
        );
      }
    }

    const [recent, recipient] = await Promise.all([
      collectWritingSamples({
        userId: ctx.userId,
        target: limit,
        channel: input.channel,
      }).catch((err) => {
        notes.push(
          `recent_samples collection failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        return null;
      }),
      recipientHint
        ? collectWritingSamples({
            userId: ctx.userId,
            target: 8,
            channel: input.channel,
            recipientEmail: recipientHint,
          }).catch((err) => {
            notes.push(
              `samples_for_recipient collection failed: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
            return null;
          })
        : Promise.resolve(null),
    ]);

    const recentSamples = recent?.rich_samples ?? [];
    const recipientSamples = recipient?.rich_samples ?? null;

    const ageDays = profile?.extracted_at
      ? Math.floor(
          (Date.now() - new Date(profile.extracted_at).getTime()) / 86_400_000
        )
      : null;
    if (ageDays != null && ageDays > 30) {
      notes.push(
        `Profile is ${ageDays} days old — voice may have drifted. Consider re-extracting.`
      );
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
  },
};
