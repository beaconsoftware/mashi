import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WILDCARD_SCOPE,
  isAlwaysAllowEligible,
  scopeForCall,
  type PolicyMode,
  type ToolPolicy,
} from "@/lib/agent/policy";

/**
 * P4.b (Epic E1) — server reads/writes for `agent_tool_policies`.
 *
 * Kept apart from the pure `policy.ts` so the decision logic stays
 * importable into the client card without dragging Supabase along. Every
 * query is `user_id`-scoped; the table is owner-only RLS but these run under
 * both session and service clients, so we filter explicitly per the
 * multi-tenancy doctrine.
 */

type Supa = SupabaseClient;

export async function loadToolPolicies(
  userId: string,
  supabase: Supa
): Promise<ToolPolicy[]> {
  const { data, error } = await supabase
    .from("agent_tool_policies")
    .select("id, tool_name, scope, mode")
    .eq("user_id", userId);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    tool_name: r.tool_name as string,
    scope: r.scope as string,
    mode: r.mode as PolicyMode,
  }));
}

/**
 * Upsert one policy on (user, tool, scope). Refuses an `always_allow` on an
 * ineligible irreversible-send tool (defence in depth alongside the runtime
 * downgrade) so the row never even lands. Returns the row id on success.
 */
export async function setToolPolicy(input: {
  userId: string;
  toolName: string;
  scope?: string;
  mode: PolicyMode;
  supabase: Supa;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const scope = input.scope || WILDCARD_SCOPE;
  if (input.mode === "always_allow" && !isAlwaysAllowEligible(input.toolName)) {
    return {
      ok: false,
      error:
        "This action can't be set to always-allow, it sends something that can't be recalled.",
    };
  }
  const { data, error } = await input.supabase
    .from("agent_tool_policies")
    .upsert(
      {
        user_id: input.userId,
        tool_name: input.toolName,
        scope,
        mode: input.mode,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,tool_name,scope" }
    )
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Couldn't save policy." };
  }
  return { ok: true, id: data.id as string };
}

/**
 * Inline "always allow this" affordance (E1): the user approved a call AND
 * asked to remember it. We read the pending approval's tool + args
 * server-side, derive its narrow scope, and write an `always_allow` policy
 * for that scope. Best-effort — a failure here must not fail the approval
 * itself, and an ineligible (irreversible-send) tool is silently refused by
 * `setToolPolicy`.
 */
export async function rememberApprovalAsPolicy(input: {
  userId: string;
  threadId: string;
  callId: string;
  supabase: Supa;
}): Promise<void> {
  const { data } = await input.supabase
    .from("agent_approvals")
    .select("tool_name, args")
    .eq("user_id", input.userId)
    .eq("thread_id", input.threadId)
    .eq("call_id", input.callId)
    .maybeSingle();
  if (!data?.tool_name) return;
  await setToolPolicy({
    userId: input.userId,
    toolName: data.tool_name as string,
    scope: scopeForCall(data.tool_name as string, data.args),
    mode: "always_allow",
    supabase: input.supabase,
  });
}

export async function deleteToolPolicy(input: {
  userId: string;
  id: string;
  supabase: Supa;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await input.supabase
    .from("agent_tool_policies")
    .delete()
    .eq("user_id", input.userId)
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
