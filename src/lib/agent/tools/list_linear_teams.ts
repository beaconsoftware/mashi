import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const args = z.object({});

type Args = z.infer<typeof args>;

const GRAPHQL_URL = "https://api.linear.app/graphql";

interface TeamSummary {
  id: string;
  key: string;
  name: string;
}

/**
 * Read-only list of teams in the user's Linear workspace. Required
 * before create_linear_issue — the agent must pick a team_id from this
 * list rather than guessing.
 */
export const list_linear_teams: ToolDefinition<
  Args,
  { teams: TeamSummary[]; error?: string }
> = {
  name: "list_linear_teams",
  description:
    "List Linear teams the user has access to in their connected Linear workspace. Each row carries id, key, and name.\n\nUse when: you are about to call create_linear_issue and need a valid team_id — Linear rejects creates with a guessed id. Example: {}.\n\nDo NOT use to list Linear issues (call search_linear). Do NOT skip this and guess a team_id; the create will fail.\n\nReturns: { teams } on success; { teams: [], error } when there is no Linear connection or the Linear API rejects the call.",
  ring: "read",
  args,
  handler: async (_input, ctx) => {
    const { data: conn } = await ctx.supabase
      .from("connected_accounts")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("provider", "linear")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!conn) return { teams: [], error: "No Linear account connected." };
    const token = await getActiveAccessToken(conn.id);

    const query = `
      query AllTeams {
        teams(first: 100) {
          nodes { id key name }
        }
      }
    `;
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      return { teams: [], error: `Linear API ${res.status}` };
    }
    const j = (await res.json()) as {
      data?: { teams?: { nodes?: TeamSummary[] } };
      errors?: Array<{ message: string }>;
    };
    if (j.errors?.length) {
      return { teams: [], error: j.errors.map((e) => e.message).join("; ") };
    }
    return { teams: j.data?.teams?.nodes ?? [] };
  },
};
