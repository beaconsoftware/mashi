import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import { runTriageOnUnit } from "@/lib/triage/orchestrator";
import { parallelMap } from "@/lib/utils/parallel";
import { recordSyncFailure, formatSyncError } from "@/lib/oauth/reauth";
import type { ExistingS2DContext } from "@/lib/triage/types";

const GRAPHQL_URL = "https://api.fireflies.ai/graphql";
const INITIAL_LOOKBACK_DAYS = 90;
const PAGE_SIZE = 50;
const TOTAL_CAP = 200;

/**
 * First sync pulls 90 days; subsequent syncs pull only meetings since
 * last_synced_at minus a 1-day buffer.
 */
function firefliesFromDate(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) {
    return new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 86_400_000).toISOString();
  }
  const ageMs = Date.now() - new Date(lastSyncedAt).getTime();
  // Stale (>30 days) → full re-pull
  if (ageMs > 30 * 86_400_000) {
    return new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 86_400_000).toISOString();
  }
  return new Date(new Date(lastSyncedAt).getTime() - 86_400_000).toISOString();
}

interface FirefliesAttendee {
  email?: string;
  displayName?: string;
  name?: string;
}

interface FirefliesTranscript {
  id: string;
  title?: string;
  date?: number;
  duration?: number;
  dateString?: string;
  transcript_url?: string;
  host_email?: string;
  organizer_email?: string;
  meeting_attendees?: FirefliesAttendee[];
  fireflies_users?: string[];
  summary?: {
    keywords?: string[];
    action_items?: string;
    outline?: string;
    overview?: string;
    short_summary?: string;
    gist?: string;
    bullet_gist?: string;
  };
}

interface MeetingForTriage {
  title: string;
  date: string;
  duration_minutes: number | null;
  attendees: Array<{ name: string | null; email: string | null }>;
  overview: string | null;
  action_items_raw: string | null;
  keywords: string[];
}

/**
 * Fireflies sync — v1 (per-meeting Sonnet triage with cross-source close detection)
 *
 * Per meeting the agent sees:
 *   - meeting summary + action_items text + attendees
 *   - OPEN S2D items already tied to this meeting
 *   - OPEN S2D items in the same company across all sources (for close detection
 *     when the meeting resolves an item that originated in Gmail/Slack/Linear)
 *
 * Auto-close is appropriate only when the meeting explicitly resolves
 * something (the agent picks confidence="auto" vs "approval").
 */
export async function syncFirefliesConnection(connectionId: string): Promise<{
  fetched: number;
  stored: number;
  triaged: number;
  created: number;
  updated: number;
  closed: number;
}> {
  const supabase = createSupabaseServiceClient();

  const { data: conn, error } = await supabase
    .from("connected_accounts")
    .select("id, user_id, company_id, account_email, last_synced_at")
    .eq("id", connectionId)
    .single();
  if (error) throw error;

  await supabase
    .from("connected_accounts")
    .update({ last_sync_status: "syncing", last_sync_error: null })
    .eq("id", connectionId);

  try {
    const token = await getActiveAccessToken(connectionId);
    const fromDate = firefliesFromDate(conn.last_synced_at);
    const transcripts = await fetchTranscripts(token, fromDate);

    // Upsert meetings
    const meetingRows = transcripts.map((t) => ({
      external_id: t.id,
      source: "fireflies" as const,
      user_id: conn.user_id,
      company_id: conn.company_id,
      connected_account_id: conn.id,
      title: t.title ?? "(untitled meeting)",
      date: t.date ? new Date(t.date).toISOString() : null,
      duration_minutes: t.duration ? Math.round(t.duration) : null,
      attendees: (t.meeting_attendees ?? []).map((a) => ({
        email: a.email ?? null,
        name: a.displayName ?? a.name ?? null,
      })),
      summary:
        t.summary?.overview ?? t.summary?.short_summary ?? t.summary?.gist ?? null,
      raw_data: t as unknown as Record<string, unknown>,
    }));

    let stored = 0;
    if (meetingRows.length > 0) {
      const { error: upErr } = await supabase
        .from("meetings")
        .upsert(meetingRows, { onConflict: "user_id,external_id" });
      if (upErr) throw upErr;
      stored = meetingRows.length;
    }

    // Triage only meetings not yet processed
    const externalIds = meetingRows.map((m) => m.external_id);
    let triagedCount = 0;
    let created = 0;
    let updated = 0;
    let closed = 0;

    if (externalIds.length > 0) {
      const { data: meetingRefs } = await supabase
        .from("meetings")
        .select("id, external_id, action_items_extracted")
        .in("external_id", externalIds);
      const refMap = new Map(
        (meetingRefs ?? []).map((r) => [
          r.external_id,
          { id: r.id, extracted: r.action_items_extracted },
        ])
      );

      const newOnes = transcripts.filter((t) => {
        const meta = refMap.get(t.id);
        return meta && !meta.extracted;
      });

      const triageResults = await parallelMap(newOnes, 8, async (t) => {
        try {
          const triageInput: MeetingForTriage = {
            title: t.title ?? "(untitled meeting)",
            date: t.date ? new Date(t.date).toISOString() : "",
            duration_minutes: t.duration ? Math.round(t.duration) : null,
            attendees: (t.meeting_attendees ?? []).map((a) => ({
              name: a.displayName ?? a.name ?? null,
              email: a.email ?? null,
            })),
            overview:
              t.summary?.overview ?? t.summary?.short_summary ?? t.summary?.gist ?? null,
            action_items_raw: t.summary?.action_items ?? null,
            keywords: t.summary?.keywords ?? [],
          };

          const existing_items = await loadCloseDetectionContext(
            supabase,
            t.id,
            conn.company_id
          );

          const r = await runTriageOnUnit({
            userId: conn.user_id,
            connectedAccountId: conn.id,
            unit: {
              source_type: "fireflies",
              source_thread_id: t.id,
              source_label: `Fireflies · ${t.title ?? "(untitled)"} · ${
                t.dateString ?? ""
              }`,
              // Direct link to the transcript page on Fireflies. Constructable
              // from external_id alone but populating at create time means
              // the chip never has to derive it.
              source_url: `https://app.fireflies.ai/view/${encodeURIComponent(t.id)}`,
              company_id: conn.company_id,
              content: triageInput,
              existing_items,
            },
          });

          await supabase
            .from("meetings")
            .update({ action_items_extracted: true })
            .eq("external_id", t.id);

          return r;
        } catch (err) {
          console.warn(`[fireflies-sync] triage failed for ${t.id}:`, err);
          return null;
        }
      });

      triagedCount = triageResults.filter((r) => r != null).length;
      created = triageResults.reduce((s, r) => s + (r?.created ?? 0), 0);
      updated = triageResults.reduce((s, r) => s + (r?.updated ?? 0), 0);
      closed = triageResults.reduce((s, r) => s + (r?.closed ?? 0), 0);
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
      fetched: transcripts.length,
      stored,
      triaged: triagedCount,
      created,
      updated,
      closed,
    };
  } catch (err) {
    const msg = formatSyncError(err, "Fireflies");
    console.error("[sync] Fireflies failed", { connectionId, err, msg });
    await recordSyncFailure(connectionId, msg);
    throw err;
  }
}

/**
 * Existing items context for a Fireflies meeting:
 *   - this meeting's own prior triage items
 *   - PLUS open items across all sources in the same company (capped at 30)
 *     so the agent can detect "this meeting closes an item from a Gmail thread"
 */
async function loadCloseDetectionContext(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  meetingExternalId: string,
  companyId: string | null
): Promise<ExistingS2DContext[]> {
  const { data: own } = await supabase
    .from("s2d_items")
    .select("id, title, status, pathway, priority, created_at")
    .eq("source_type", "fireflies")
    .eq("source_thread_id", meetingExternalId)
    .neq("status", "done");

  let companyItems: ExistingS2DContext[] = [];
  if (companyId) {
    const { data } = await supabase
      .from("s2d_items")
      .select("id, title, status, pathway, priority, created_at")
      .eq("company_id", companyId)
      .neq("status", "done")
      .order("created_at", { ascending: false })
      .limit(30);
    companyItems = data ?? [];
  }

  const map = new Map<string, ExistingS2DContext>();
  for (const it of [...(own ?? []), ...companyItems]) map.set(it.id, it);
  return Array.from(map.values()).slice(0, 30);
}

async function fetchTranscripts(
  token: string,
  fromDateIso: string
): Promise<FirefliesTranscript[]> {
  const out: FirefliesTranscript[] = [];
  let skip = 0;
  while (out.length < TOTAL_CAP) {
    const query = `
      query Transcripts($limit: Int, $skip: Int, $fromDate: DateTime) {
        transcripts(limit: $limit, skip: $skip, fromDate: $fromDate) {
          id
          title
          date
          duration
          dateString
          transcript_url
          host_email
          organizer_email
          meeting_attendees { displayName email name }
          fireflies_users
          summary {
            keywords
            action_items
            outline
            overview
            short_summary
            gist
            bullet_gist
          }
        }
      }
    `;
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { limit: PAGE_SIZE, skip, fromDate: fromDateIso },
      }),
    });
    if (!res.ok) {
      throw new Error(`Fireflies API failed: ${res.status} ${await res.text()}`);
    }
    const j = (await res.json()) as {
      data?: { transcripts?: FirefliesTranscript[] };
      errors?: Array<{ message: string }>;
    };
    if (j.errors?.length) {
      throw new Error(
        `Fireflies GraphQL: ${j.errors.map((e) => e.message).join(", ")}`
      );
    }
    const page = j.data?.transcripts ?? [];
    if (page.length === 0) break;
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return out.slice(0, TOTAL_CAP);
}
