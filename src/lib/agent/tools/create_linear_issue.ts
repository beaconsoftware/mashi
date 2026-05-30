import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  title: z.string().min(1).max(1024),
  description: z.string().max(20_000).optional(),
  team_id: z
    .string()
    .min(1)
    .describe(
      "Linear team UUID. Call list_linear_teams first to pick the right id; never invent."
    ),
  project_id: z.string().optional(),
  priority: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe("Linear priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low."),
});

type Args = z.infer<typeof args>;

const GRAPHQL_URL = "https://api.linear.app/graphql";

/**
 * Ring-3 create_linear_issue — creates an issue via Linear's
 * issueCreate mutation. Requires user approval.
 */
export const create_linear_issue: ToolDefinition<
  Args,
  {
    ok: boolean;
    issue_id?: string;
    identifier?: string;
    url?: string;
    error?: string;
    /** E4: peeled off before the model sees it; powers the post-create
     * recall strip (archive the issue within the undo window). */
    _undo?: { op: ReverseOp; summary: string };
  }
> = {
  name: "create_linear_issue",
  description:
    "Create a new Linear issue via issueCreate. Pause-and-approve: the call surfaces the approval card; the create fires only after the user clicks Approve. priority is 0=none, 1=urgent, 2=high, 3=medium, 4=low.\n\nUse when: the user explicitly wants to track work in Linear ('file this as a Linear issue in the Eng team'). Call list_linear_teams first — never guess team_id; Linear rejects unknown ids. Example: { title: 'Fix billing migration', team_id: '…uuid…', priority: 2 }.\n\nDo NOT use to update an existing issue (call update_linear_issue). Do NOT use to comment (call comment_on_linear_issue). Do NOT use to fetch (call get_linear_issue / search_linear).\n\nReturns: { ok, issue_id, identifier, url } on success; { ok: false, error } when no Linear connection exists, team_id is invalid, or Linear's API rejects the mutation.",
  ring: "write_world",
  args,
  handler: async (input, ctx) => {
    const { data: conn } = await ctx.supabase
      .from("connected_accounts")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("provider", "linear")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!conn) return { ok: false, error: "No Linear account connected." };
    const token = await getActiveAccessToken(conn.id);

    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url }
        }
      }
    `;
    const variables = {
      input: {
        teamId: input.team_id,
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.project_id ? { projectId: input.project_id } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      },
    };
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: mutation, variables }),
    });
    if (!res.ok) {
      return { ok: false, error: `Linear API ${res.status}` };
    }
    const j = (await res.json()) as {
      data?: {
        issueCreate?: {
          success: boolean;
          issue?: { id: string; identifier: string; url: string };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (j.errors?.length) {
      return { ok: false, error: j.errors.map((e) => e.message).join("; ") };
    }
    if (!j.data?.issueCreate?.success) {
      return { ok: false, error: "Linear reported failure." };
    }
    const issue = j.data.issueCreate.issue;
    return {
      ok: true,
      issue_id: issue?.id,
      identifier: issue?.identifier,
      url: issue?.url,
      ...(issue?.id
        ? {
            _undo: {
              op: { kind: "archive_linear_issue", issue_id: issue.id },
              summary: `Created ${issue.identifier ?? "issue"} in Linear.`,
            },
          }
        : {}),
    };
  },
};
