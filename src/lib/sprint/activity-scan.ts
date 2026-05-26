import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnrichSourceKind } from "@/hooks/use-enriched-context";

/**
 * Server-side activity scanner for the WatchCanvas + DelegateCanvas.
 *
 * Given an s2d_item id, scans the user-owned mirrors of messages
 * (gmail+slack combined), calendar events, and linear issues for any
 * rows touched/created since the supplied `sinceISO` cutoff and matching
 * either the item's linked source(s) or its delegate/keyword vector.
 *
 * The output is intentionally lossy: it's a UI signal list, not a full
 * audit log. Each signal carries the same shape as enriched_context
 * pulled_sources so the canvas can render them identically to other
 * source rows.
 *
 * Scoping note: every read goes through the SERVICE client passed in by
 * the route, which is RLS-bypassing — every query MUST scope by the
 * `userId` argument explicitly. The per-table `user_id` columns make
 * this safe; we never read cross-tenant.
 */

export interface ActivitySignal {
  kind: EnrichSourceKind;
  ref: string;
  label: string;
  at: string;
  snippet?: string;
}

interface ScanOpts {
  sb: SupabaseClient;
  userId: string;
  itemId: string;
  sinceISO: string;
  /**
   * Optional explicit delegate keyword (name, email, slack handle). When
   * provided, message scans also match rows containing this token in
   * subject / preview / sender, not just rows linked to the item.
   */
  delegateMatch?: string | null;
  /** Cap on signals returned across all source kinds. */
  limit?: number;
}

export async function scanActivitySinceLast({
  sb,
  userId,
  itemId,
  sinceISO,
  delegateMatch,
  limit = 12,
}: ScanOpts): Promise<ActivitySignal[]> {
  // Pull the item so we know which upstream thread / linear issue / event
  // ids the signals should anchor on.
  const { data: item } = await sb
    .from("s2d_items")
    .select(
      "id, title, source_type, source_thread_id, source_id, linked_sources"
    )
    .eq("user_id", userId)
    .eq("id", itemId)
    .single();
  if (!item) return [];

  type LinkedRef = {
    source_type?: string | null;
    source_thread_id?: string | null;
  };
  const linkedRefs: Array<{ kind: string; ref: string }> = [];
  if (item.source_thread_id) {
    linkedRefs.push({
      kind: item.source_type ?? "manual",
      ref: item.source_thread_id,
    });
  }
  if (Array.isArray(item.linked_sources)) {
    for (const ls of item.linked_sources as LinkedRef[]) {
      if (ls.source_thread_id) {
        linkedRefs.push({
          kind: ls.source_type ?? "manual",
          ref: ls.source_thread_id,
        });
      }
    }
  }

  const signals: ActivitySignal[] = [];

  // ── Messages (gmail + slack live in `messages` with a `source` col) ─
  const linkedThreadIds = linkedRefs
    .filter((r) => r.kind === "gmail" || r.kind === "slack")
    .map((r) => r.ref);
  if (linkedThreadIds.length > 0 || delegateMatch) {
    let q = sb
      .from("messages")
      .select(
        "id, source, thread_id, subject, sender_name, sender_email, preview, received_at"
      )
      .eq("user_id", userId)
      .gte("received_at", sinceISO)
      .order("received_at", { ascending: false })
      .limit(limit);
    if (linkedThreadIds.length > 0) {
      q = q.in("thread_id", linkedThreadIds);
    } else if (delegateMatch) {
      q = q.or(
        `sender_name.ilike.%${delegateMatch}%,sender_email.ilike.%${delegateMatch}%,subject.ilike.%${delegateMatch}%`
      );
    }
    const { data } = await q;
    for (const m of data ?? []) {
      const kind: EnrichSourceKind = m.source === "slack" ? "slack" : "gmail";
      signals.push({
        kind,
        ref: `${kind}:${m.thread_id ?? m.id}`,
        label:
          m.subject ?? m.sender_name ?? m.sender_email ?? `${kind} message`,
        at: m.received_at,
        snippet: (m.preview ?? "").slice(0, 200) || undefined,
      });
    }
  }

  // ── Linear issue activity ──────────────────────────────────────────
  const linearRefs = linkedRefs
    .filter((r) => r.kind === "linear")
    .map((r) => r.ref);
  if (linearRefs.length > 0) {
    const { data } = await sb
      .from("linear_issues")
      .select("id, external_id, title, status, updated_at, assignee_name")
      .eq("user_id", userId)
      .gte("updated_at", sinceISO)
      .in("external_id", linearRefs)
      .order("updated_at", { ascending: false })
      .limit(limit);
    for (const issue of data ?? []) {
      signals.push({
        kind: "linear",
        ref: `linear:${issue.external_id ?? issue.id}`,
        label: issue.title ?? "Linear issue",
        at: issue.updated_at,
        snippet: issue.status
          ? `Status: ${issue.status}${issue.assignee_name ? ` · ${issue.assignee_name}` : ""}`
          : undefined,
      });
    }
  }

  // ── Calendar events (delegate keyword in title) ────────────────────
  if (delegateMatch) {
    const { data } = await sb
      .from("calendar_events")
      .select("id, title, start_at, attendees")
      .eq("user_id", userId)
      .gte("start_at", sinceISO)
      .ilike("title", `%${delegateMatch}%`)
      .order("start_at", { ascending: false })
      .limit(limit);
    for (const ev of data ?? []) {
      const attendeeCount = Array.isArray(ev.attendees)
        ? ev.attendees.length
        : 0;
      signals.push({
        kind: "fireflies",
        ref: `cal:${ev.id}`,
        label: ev.title ?? "Calendar event",
        at: ev.start_at,
        snippet: attendeeCount ? `${attendeeCount} attendees` : undefined,
      });
    }
  }

  // Sort by recency, cap.
  signals.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return signals.slice(0, limit);
}
