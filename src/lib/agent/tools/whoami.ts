import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({}).optional().default({});

type Args = z.infer<typeof args>;

export const whoami: ToolDefinition<Args, unknown> = {
  name: "whoami",
  description:
    "Return the current user's profile (name, email, communication style), connected providers with sync status, and basic counts (companies, open S2D items). Useful as a first call to orient before doing anything else.\n\nUse when: starting a fresh conversation and the cursor context is thin, or the user asks 'what are my connections?', 'do I have Gmail synced?'. Example: {}.\n\nDo NOT use to fetch a different user's profile — this tool is always self-scoped. Use who_is to look up other people across the user's sources.\n\nReturns: { user_id, profile, connections[], counts }. Fields are null / empty when not populated; the call does not error on partial data.",
  ring: "read",
  args,
  handler: async (_input, ctx) => {
    const [profile, connections, companyCount, openCount] = await Promise.all([
      ctx.supabase
        .from("user_profile")
        .select("name, email, communication_style, onboarded_at")
        .eq("user_id", ctx.userId)
        .maybeSingle(),
      ctx.supabase
        .from("connected_accounts")
        .select(
          "provider, account_email, account_label, last_synced_at, last_sync_status, last_sync_error"
        )
        .eq("user_id", ctx.userId),
      ctx.supabase
        .from("companies")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ctx.userId),
      ctx.supabase
        .from("s2d_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .neq("status", "done"),
    ]);

    return {
      user_id: ctx.userId,
      profile: profile.data ?? null,
      connections: (connections.data ?? []).map((c) => ({
        provider: c.provider,
        label: c.account_label ?? c.account_email,
        last_synced_at: c.last_synced_at,
        status: c.last_sync_status,
        error: c.last_sync_error,
      })),
      counts: {
        companies: companyCount.count ?? 0,
        open_s2d_items: openCount.count ?? 0,
      },
    };
  },
};
