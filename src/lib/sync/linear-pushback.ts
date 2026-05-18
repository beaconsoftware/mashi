import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import type { S2DStatus } from "@/types";

const GRAPHQL_URL = "https://api.linear.app/graphql";

/**
 * Push a Mashi-side status change back to Linear.
 *
 * Mashi → Linear state mapping:
 *   backlog     → Linear state type "backlog"
 *   todo        → Linear state type "unstarted"
 *   in_progress → Linear state type "started"
 *   in_queue    → (no Linear equivalent) — skip, optionally add a comment
 *   done        → Linear state type "completed"
 *
 * Each Linear workspace has its own configurable states per type. We query
 * the workspace's states list, cache it on the connected_account row, and
 * use the first matching state for the target type.
 */
export async function pushS2DStatusToLinear(opts: {
  s2dItemId: string;
  newStatus: S2DStatus;
  /**
   * Caller's user_id (from session auth). Required — every query
   * scopes by it so we can never push status to another tenant's
   * Linear workspace via a stray ID collision.
   */
  userId: string;
}): Promise<{ ok: boolean; message: string }> {
  const supabase = createSupabaseServiceClient();

  // Load the item; bail unless it's Linear-sourced
  const { data: item, error: itemErr } = await supabase
    .from("s2d_items")
    .select("id, source_type, source_thread_id")
    .eq("id", opts.s2dItemId)
    .eq("user_id", opts.userId)
    .single();
  if (itemErr || !item) {
    return { ok: false, message: "s2d item not found" };
  }
  if (item.source_type !== "linear" || !item.source_thread_id) {
    return { ok: false, message: "not a linear item" };
  }

  // Find the Linear connection by joining through linear_issues.
  // user_id scopes the lookup so two users importing the same Linear
  // issue (different workspaces, same external_id collision) never
  // cross-route.
  const { data: issueRow } = await supabase
    .from("linear_issues")
    .select("connected_account_id")
    .eq("user_id", opts.userId)
    .eq("external_id", item.source_thread_id)
    .maybeSingle();

  if (!issueRow?.connected_account_id) {
    return { ok: false, message: "no Linear connection for this item" };
  }

  // Map Mashi status → Linear state type
  const targetType = mashiToLinearStateType(opts.newStatus);
  if (!targetType) {
    // in_queue has no Linear equivalent — silently skip
    return { ok: true, message: "no-op (in_queue not mirrored to Linear)" };
  }

  const token = await getActiveAccessToken(issueRow.connected_account_id);
  const stateId = await getOrFetchStateId(
    issueRow.connected_account_id,
    token,
    targetType
  );
  if (!stateId) {
    return { ok: false, message: `no Linear state of type "${targetType}"` };
  }

  // Push the update
  const mutation = `
    mutation UpdateIssueState($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
        issue { id state { name type } }
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
      variables: { id: item.source_thread_id, stateId },
    }),
  });
  if (!res.ok) {
    return { ok: false, message: `Linear API ${res.status}` };
  }
  const j = (await res.json()) as {
    data?: { issueUpdate?: { success: boolean } };
    errors?: Array<{ message: string }>;
  };
  if (j.errors?.length) {
    return { ok: false, message: j.errors.map((e) => e.message).join("; ") };
  }
  if (!j.data?.issueUpdate?.success) {
    return { ok: false, message: "Linear reported failure" };
  }
  return { ok: true, message: `synced to Linear (${targetType})` };
}

function mashiToLinearStateType(s: S2DStatus): string | null {
  switch (s) {
    case "backlog": return "backlog";
    case "todo": return "unstarted";
    case "in_progress": return "started";
    case "done": return "completed";
    case "in_queue": return null; // no Linear equivalent
    default: return null;
  }
}

interface CachedState {
  id: string;
  name: string;
  type: string;
  /** Linear's `position` field — lower = earlier in workflow */
  position?: number;
}

/**
 * Look up a Linear state ID for a given type, caching the workspace's full
 * state list on `connected_accounts.raw_provider_data.states` so we only
 * call Linear's states query once per connection.
 */
async function getOrFetchStateId(
  connectionId: string,
  token: string,
  targetType: string
): Promise<string | null> {
  const supabase = createSupabaseServiceClient();
  const { data: conn } = await supabase
    .from("connected_accounts")
    .select("raw_provider_data")
    .eq("id", connectionId)
    .single();

  const cached = conn?.raw_provider_data?.states as CachedState[] | undefined;
  if (cached && Array.isArray(cached) && cached.length > 0) {
    return pickStateForType(cached, targetType);
  }

  // Fetch all workflow states for this workspace
  const query = `
    query AllStates {
      workflowStates(first: 250) {
        nodes { id name type position }
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
  if (!res.ok) return null;
  const j = (await res.json()) as {
    data?: { workflowStates?: { nodes?: CachedState[] } };
  };
  const states = j.data?.workflowStates?.nodes ?? [];
  if (states.length === 0) return null;

  // Cache for future calls
  await supabase
    .from("connected_accounts")
    .update({
      raw_provider_data: {
        ...(conn?.raw_provider_data ?? {}),
        states,
      },
    })
    .eq("id", connectionId);

  return pickStateForType(states, targetType);
}

function pickStateForType(states: CachedState[], targetType: string): string | null {
  const matching = states.filter((s) => s.type === targetType);
  if (matching.length === 0) return null;
  // Pick the one with the lowest position (most "default" for that type)
  matching.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return matching[0].id;
}
