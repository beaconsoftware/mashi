import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import { runTriageOnUnit, loadExistingForUnit } from "@/lib/triage/orchestrator";
import { parallelMap } from "@/lib/utils/parallel";
import { reconcileLinearStatuses } from "@/lib/triage/reconcile";
import { recordSyncFailure, formatSyncError } from "@/lib/oauth/reauth";
import { emitCloudHeartbeats } from "@/lib/activity/cloud-feeder";
import type { HeartbeatEvent } from "@/lib/activity/types";

const GRAPHQL_URL = "https://api.linear.app/graphql";

interface LinearIssueRaw {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number; // 0 none, 1 urgent, 2 high, 3 medium, 4 low
  state: { name: string; type: string };
  assignee: { id: string; email: string; name: string } | null;
  subscribers?: { nodes: Array<{ id: string; email: string }> };
  labels: { nodes: Array<{ name: string }> };
  dueDate: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  comments?: { nodes: Array<{ body: string; user: { name: string; email: string }; createdAt: string }> };
}

interface ViewerInfo {
  id: string;
  email: string;
  name: string;
}

type Relationship = "assignee" | "subscriber" | "unassigned_in_portco" | "other";

interface IssueForTriage {
  identifier: string;
  title: string;
  description: string | null;
  status: string;
  priority_name: "urgent" | "high" | "medium" | "low" | "none";
  assignee: string | null;
  due_date: string | null;
  labels: string[];
  user_relationship: Relationship;
  recent_comments: Array<{ from: string; received: string; text: string }>;
  url: string;
}

/**
 * Linear sync — v1 (context-aware Sonnet triage per issue)
 *
 * Pulls all non-completed issues. For each, builds a context object including
 * comments + user relationship and lets the triage agent decide:
 *   - Issues assigned to user → almost always become S2D items
 *   - Issues where user is subscriber/reviewer → only if there's an action
 *     for the user (decision, response, push someone)
 *   - Unassigned issues in user's portco → may surface if they need triage
 *     (delegate, decide who owns, escalate)
 *   - Already-closed-in-Linear → close matching S2D item
 */
export async function syncLinearConnection(connectionId: string): Promise<{
  fetched: number;
  upserted: number;
  triaged: number;
  created: number;
  updated: number;
  closed: number;
}> {
  const supabase = createSupabaseServiceClient();

  const { data: conn, error: connErr } = await supabase
    .from("connected_accounts")
    .select("id, user_id, company_id, account_label")
    .eq("id", connectionId)
    .single();
  if (connErr) throw connErr;

  await supabase
    .from("connected_accounts")
    .update({ last_sync_status: "syncing", last_sync_error: null })
    .eq("id", connectionId);

  try {
    const token = await getActiveAccessToken(connectionId);
    const viewer = await fetchViewer(token);

    const issues: LinearIssueRaw[] = [];
    let cursor: string | null = null;
    do {
      const page = await fetchIssuesPage(token, cursor);
      issues.push(...page.issues);
      cursor = page.endCursor;
    } while (cursor);

    // Upsert all to linear_issues for record
    const issueRows = issues.map((it) => ({
      external_id: it.id,
      linear_org_id: null,
      user_id: conn.user_id,
      connected_account_id: conn.id,
      company_id: conn.company_id,
      title: it.title,
      description: it.description,
      status: it.state.name,
      priority: it.priority,
      assignee_name: it.assignee?.name ?? null,
      assignee_email: it.assignee?.email ?? null,
      labels: it.labels.nodes.map((l) => l.name),
      due_date: it.dueDate,
      url: it.url,
      last_synced_at: new Date().toISOString(),
      raw_data: it as unknown as Record<string, unknown>,
    }));

    if (issueRows.length > 0) {
      const { error: upErr } = await supabase
        .from("linear_issues")
        .upsert(issueRows, { onConflict: "user_id,external_id" });
      if (upErr) throw upErr;
    }

    // Filter issues worth triaging:
    // - Assigned to user (always)
    // - User is subscriber (often)
    // - Unassigned + priority >= high (sometimes)
    // - Drop tickets in pure 'backlog' state unless assigned to user, to keep
    //   the triage call set bounded.
    const candidates = issues.filter((it) => {
      const rel = userRelationship(it, viewer);
      if (rel === "assignee") return true;
      if (rel === "subscriber") return it.state.type !== "backlog"; // active subs only
      if (rel === "unassigned_in_portco") {
        return it.state.type !== "backlog" && it.priority > 0 && it.priority < 3;
      }
      return false;
    });

    const triageResults = await parallelMap(candidates, 8, async (it) => {
      try {
        const existing_items = await loadExistingForUnit("linear", it.id);
        const triageInput: IssueForTriage = {
          identifier: it.identifier,
          title: it.title,
          description: (it.description ?? "").slice(0, 1500),
          status: it.state.name,
          priority_name: linearPriorityName(it.priority),
          assignee: it.assignee?.name ?? null,
          due_date: it.dueDate,
          labels: it.labels.nodes.map((l) => l.name),
          user_relationship: userRelationship(it, viewer),
          recent_comments: (it.comments?.nodes ?? []).slice(-5).map((c) => ({
            from: c.user.name,
            received: c.createdAt,
            text: c.body.slice(0, 600),
          })),
          url: it.url,
        };

        return await runTriageOnUnit({
          userId: conn.user_id,
          connectedAccountId: conn.id,
          unit: {
            source_type: "linear",
            source_thread_id: it.id,
            source_label: `Linear · ${it.identifier} · ${conn.account_label}`,
            source_url: it.url, // full https://linear.app/.../issue/MAP-N — the source_thread_id is just the UUID
            company_id: conn.company_id,
            content: triageInput,
            existing_items,
          },
        });
      } catch (err) {
        console.warn(`[linear-sync] triage for ${it.identifier} failed:`, err);
        return null;
      }
    });

    const created = triageResults.reduce((s, r) => s + (r?.created ?? 0), 0);
    const updated = triageResults.reduce((s, r) => s + (r?.updated ?? 0), 0);
    const closed = triageResults.reduce((s, r) => s + (r?.closed ?? 0), 0);

    // Cloud feeder — emit activity heartbeats BEFORE reconcile runs so
    // the matcher gets to see open S2D items in their current state
    // (reconcile auto-closes after this point). The cloud-feeder
    // checks `activity_settings.enabled` itself; if the user hasn't
    // opted in, this is a no-op.
    try {
      await emitLinearActivityHeartbeats({
        userId: conn.user_id,
        connectionToken: token,
        fetchedIssues: issues,
        viewerEmail: viewer.email.toLowerCase(),
      });
    } catch (err) {
      console.warn("[linear-sync] activity heartbeat emit failed:", err);
    }

    // Auto-close S2D items whose Linear issue is now completed/cancelled
    let autoClosed = 0;
    try {
      const r = await reconcileLinearStatuses(conn.user_id);
      autoClosed = r.closed;
    } catch (err) {
      console.warn("[linear-sync] reconcile failed:", err);
    }

    await supabase
      .from("connected_accounts")
      .update({
        last_sync_status: "success",
        last_sync_error: null,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    return {
      fetched: issues.length,
      upserted: issueRows.length,
      triaged: candidates.length,
      created,
      updated,
      closed: closed + autoClosed,
    };
  } catch (err) {
    const msg = formatSyncError(err, "Linear");
    console.error("[sync] Linear failed", { connectionId, err, msg });
    await recordSyncFailure(connectionId, msg);
    throw err;
  }
}

async function fetchViewer(token: string): Promise<ViewerInfo> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query { viewer { id email name } }`,
    }),
  });
  if (!res.ok) throw new Error(`Linear viewer fetch failed: ${res.status}`);
  const j = (await res.json()) as { data: { viewer: ViewerInfo } };
  return j.data.viewer;
}

async function fetchIssuesPage(
  token: string,
  after: string | null
): Promise<{ issues: LinearIssueRaw[]; endCursor: string | null }> {
  const query = `
    query Issues($after: String) {
      issues(
        first: 50
        after: $after
        filter: { state: { type: { in: ["backlog", "unstarted", "started"] } } }
      ) {
        nodes {
          id
          identifier
          title
          description
          priority
          state { name type }
          assignee { id email name }
          subscribers { nodes { id email } }
          labels { nodes { name } }
          dueDate
          url
          createdAt
          updatedAt
          comments(first: 10) {
            nodes { body createdAt user { name email } }
          }
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  `;
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { after } }),
  });
  if (!res.ok) throw new Error(`Linear issues fetch failed: ${res.status}`);
  const j = (await res.json()) as {
    data: {
      issues: {
        nodes: LinearIssueRaw[];
        pageInfo: { endCursor: string | null; hasNextPage: boolean };
      };
    };
    errors?: unknown;
  };
  if (j.errors) throw new Error(`Linear GraphQL error: ${JSON.stringify(j.errors)}`);
  return {
    issues: j.data.issues.nodes,
    endCursor: j.data.issues.pageInfo.hasNextPage
      ? j.data.issues.pageInfo.endCursor
      : null,
  };
}

function userRelationship(it: LinearIssueRaw, viewer: ViewerInfo): Relationship {
  if (it.assignee?.email === viewer.email) return "assignee";
  const subs = it.subscribers?.nodes ?? [];
  if (subs.some((s) => s.email === viewer.email)) return "subscriber";
  if (!it.assignee) return "unassigned_in_portco";
  return "other";
}

function linearPriorityName(p: number): IssueForTriage["priority_name"] {
  switch (p) {
    case 1: return "urgent";
    case 2: return "high";
    case 3: return "medium";
    case 4: return "low";
    default: return "none";
  }
}

/**
 * Build + dispatch heartbeat events for the activity watcher.
 *
 * Two signals:
 *   - `focus` for each fetched issue that's assigned to the user and in
 *     a started state. Matcher turns these into `in_progress` proposals
 *     for S2D items still in todo/backlog/in_queue.
 *   - `close` for any open S2D linear-sourced item whose issue did NOT
 *     come back in the active-issues fetch — those may have moved to
 *     completed/cancelled (the fetch filters them out). We query Linear
 *     for the current state of just that subset, and emit `close` for
 *     ones that are now completed/cancelled. Matcher turns these into
 *     `done` proposals for S2D items currently in_progress.
 *
 * The cloud-feeder is opt-in-gated, so this is a no-op for users who
 * haven't enabled the watcher.
 */
async function emitLinearActivityHeartbeats(opts: {
  userId: string;
  connectionToken: string;
  fetchedIssues: LinearIssueRaw[];
  viewerEmail: string;
}): Promise<void> {
  const { userId, connectionToken, fetchedIssues, viewerEmail } = opts;
  const events: HeartbeatEvent[] = [];

  // 1. Focus events: started + assigned-to-me. The Linear identifier
  // we use throughout the codebase is the UUID (`it.id`) — that's
  // what gets stored in s2d_items.source_thread_id by the triage
  // pipeline. We also pass the URL so the matcher can fall back to a
  // canonical URL match if source_id doesn't hit.
  const fetchedIds = new Set<string>();
  for (const it of fetchedIssues) {
    fetchedIds.add(it.id);
    if (it.state.type !== "started") continue;
    if (it.assignee?.email?.toLowerCase() !== viewerEmail) continue;
    events.push({
      surface: "linear",
      identifier: it.id,
      title: it.title,
      url: it.url,
      signal_kind: "focus",
      started_at: it.updatedAt ?? new Date().toISOString(),
    });
  }

  // 2. Close events: find open S2D linear items whose external_id
  // wasn't in the active fetch. The Linear GraphQL filter excludes
  // completed/cancelled states, so missing-from-fetch is the cheap
  // pre-filter. We then ask Linear directly for the current state
  // of just that subset.
  const supabase = createSupabaseServiceClient();
  const { data: openItems } = await supabase
    .from("s2d_items")
    .select("source_thread_id, title")
    .eq("user_id", userId)
    .eq("source_type", "linear")
    .neq("status", "done");

  const candidateExternalIds = (openItems ?? [])
    .map((r) => r.source_thread_id)
    .filter((s): s is string => !!s && !fetchedIds.has(s));

  if (candidateExternalIds.length > 0) {
    const titleByExternalId = new Map<string, string>();
    for (const r of openItems ?? []) {
      if (r.source_thread_id) {
        titleByExternalId.set(r.source_thread_id, r.title);
      }
    }
    const states = await fetchLinearIssueStatesForFeeder(
      connectionToken,
      candidateExternalIds
    );
    for (const [externalId, state] of states.entries()) {
      if (state.type !== "completed" && state.type !== "cancelled") continue;
      events.push({
        surface: "linear",
        identifier: externalId,
        title: titleByExternalId.get(externalId),
        url: state.url ?? undefined,
        signal_kind: "close",
        started_at: state.updatedAt ?? new Date().toISOString(),
      });
    }
  }

  if (events.length === 0) return;
  await emitCloudHeartbeats({ userId, events });
}

/**
 * Minimal helper to fetch issue state by id. Mirrors the query in
 * `src/lib/triage/reconcile.ts` but kept local to avoid leaking
 * reconcile internals into the activity feeder path. Linear caps at
 * ~250 nodes per page; we chunk.
 */
async function fetchLinearIssueStatesForFeeder(
  token: string,
  ids: string[]
): Promise<
  Map<string, { name: string; type: string; updatedAt?: string; url?: string }>
> {
  const result = new Map<
    string,
    { name: string; type: string; updatedAt?: string; url?: string }
  >();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const query = `
      query IssuesByIdForFeeder($ids: [ID!]!) {
        issues(filter: { id: { in: $ids } }, first: ${slice.length}) {
          nodes { id updatedAt url state { name type } }
        }
      }
    `;
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { ids: slice } }),
    });
    if (!res.ok) continue;
    const j = (await res.json()) as {
      data?: {
        issues?: {
          nodes?: Array<{
            id: string;
            updatedAt?: string;
            url?: string;
            state: { name: string; type: string };
          }>;
        };
      };
    };
    for (const n of j.data?.issues?.nodes ?? []) {
      result.set(n.id, {
        name: n.state.name,
        type: n.state.type,
        updatedAt: n.updatedAt,
        url: n.url,
      });
    }
  }
  return result;
}
