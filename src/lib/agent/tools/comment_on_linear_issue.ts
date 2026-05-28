import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const args = z.object({
  id: z
    .string()
    .min(1)
    .describe("Linear issue UUID (linear_issues.external_id)."),
  body: z.string().min(1).max(20_000),
});

type Args = z.infer<typeof args>;

const GRAPHQL_URL = "https://api.linear.app/graphql";

/**
 * Ring-3 comment_on_linear_issue — commentCreate mutation. Requires
 * approval.
 */
export const comment_on_linear_issue: ToolDefinition<
  Args,
  { ok: boolean; comment_id?: string; error?: string }
> = {
  name: "comment_on_linear_issue",
  description:
    "Post a comment on a Linear issue via commentCreate. Pause-and-approve: the call surfaces the approval card; the comment posts only after the user clicks Approve. id is the Linear UUID (external_id), not the human identifier.\n\nUse when: the user explicitly asks to drop a note on a Linear issue ('add a comment that we're blocked on legal'). Example: { id: '…uuid…', body: 'Blocked on legal sign-off; expected by Friday.' }.\n\nDo NOT use to update issue fields (call update_linear_issue). Do NOT use to read comments (no read tool covers individual comments yet — use get_linear_issue for the issue body).\n\nReturns: { ok, comment_id } on success; { ok: false, error } when no Linear connection exists, the id is unknown, or the mutation fails.",
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
      mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id }
        }
      }
    `;
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: { input: { issueId: input.id, body: input.body } },
      }),
    });
    if (!res.ok) return { ok: false, error: `Linear API ${res.status}` };
    const j = (await res.json()) as {
      data?: {
        commentCreate?: { success: boolean; comment?: { id: string } };
      };
      errors?: Array<{ message: string }>;
    };
    if (j.errors?.length) {
      return { ok: false, error: j.errors.map((e) => e.message).join("; ") };
    }
    if (!j.data?.commentCreate?.success) {
      return { ok: false, error: "Linear reported failure." };
    }
    return { ok: true, comment_id: j.data.commentCreate.comment?.id };
  },
};
