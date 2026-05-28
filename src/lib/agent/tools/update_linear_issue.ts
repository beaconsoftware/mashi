import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const patch = z
  .object({
    title: z.string().min(1).max(1024).optional(),
    description: z.string().max(20_000).optional(),
    state_id: z
      .string()
      .optional()
      .describe("Linear workflow state UUID. Use the state's id, not its name."),
    assignee_id: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    project_id: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "patch must include at least one field",
  });

const args = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      "Linear issue UUID. Use linear_issues.external_id, not the human identifier."
    ),
  patch,
});

type Args = z.infer<typeof args>;

const GRAPHQL_URL = "https://api.linear.app/graphql";

/**
 * Ring-3 update_linear_issue — issueUpdate mutation. Requires approval.
 */
export const update_linear_issue: ToolDefinition<
  Args,
  { ok: boolean; identifier?: string; error?: string }
> = {
  name: "update_linear_issue",
  description:
    "PATCH a Linear issue via issueUpdate (title, description, state_id, assignee_id, priority, project_id). Pause-and-approve: the call surfaces the approval card; the change fires only after the user clicks Approve. id is the Linear UUID (external_id), NOT the human identifier like 'ENG-123'.\n\nUse when: the user explicitly asks to move / reassign / re-prioritize a Linear issue. Example: { id: '…uuid…', patch: { state_id: '…uuid…', priority: 1 } }.\n\nDo NOT use to comment (call comment_on_linear_issue). Do NOT use to create (call create_linear_issue). Do NOT pass the human identifier as id — Linear's API requires the UUID. Use get_linear_issue / search_linear to ground the id and any reference UUIDs.\n\nReturns: { ok, identifier } on success; { ok: false, error } when no Linear connection exists, the id is unknown, or the mutation fails.",
  ring: "write_world",
  args,
  handler: async (input, ctx) => {
    const { data: row } = await ctx.supabase
      .from("linear_issues")
      .select("connected_account_id")
      .eq("user_id", ctx.userId)
      .eq("external_id", input.id)
      .maybeSingle();
    let connectionId = row?.connected_account_id ?? null;
    if (!connectionId) {
      const { data: conn } = await ctx.supabase
        .from("connected_accounts")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("provider", "linear")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      connectionId = conn?.id ?? null;
    }
    if (!connectionId) {
      return { ok: false, error: "No Linear account connected." };
    }
    const token = await getActiveAccessToken(connectionId);

    const mutation = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier }
        }
      }
    `;
    const apiInput: Record<string, unknown> = {};
    if (input.patch.title) apiInput.title = input.patch.title;
    if (input.patch.description !== undefined)
      apiInput.description = input.patch.description;
    if (input.patch.state_id) apiInput.stateId = input.patch.state_id;
    if (input.patch.assignee_id) apiInput.assigneeId = input.patch.assignee_id;
    if (input.patch.priority !== undefined)
      apiInput.priority = input.patch.priority;
    if (input.patch.project_id) apiInput.projectId = input.patch.project_id;

    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: { id: input.id, input: apiInput },
      }),
    });
    if (!res.ok) return { ok: false, error: `Linear API ${res.status}` };
    const j = (await res.json()) as {
      data?: {
        issueUpdate?: {
          success: boolean;
          issue?: { id: string; identifier: string };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (j.errors?.length) {
      return { ok: false, error: j.errors.map((e) => e.message).join("; ") };
    }
    if (!j.data?.issueUpdate?.success) {
      return { ok: false, error: "Linear reported failure." };
    }
    return { ok: true, identifier: j.data.issueUpdate.issue?.identifier };
  },
};
