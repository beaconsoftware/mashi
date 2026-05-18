/**
 * Derive a best-effort deep link to the original source of an S2D item.
 *
 * Some providers give us enough info from source_thread_id alone to build
 * a working URL (Gmail thread id → mail.google.com, Slack channel id →
 * slack.com/app_redirect). Others need more (Linear needs the workspace
 * slug, Calendar needs the calendar id + base64 encoded event id) so we
 * fall back to a best-effort link or null and let the UI surface the
 * label-only chip.
 *
 * Returns:
 *   { url } when we can build a working deep link
 *   { url: null } when we can't — caller renders an unlinked chip
 */

export interface SourceRef {
  source_type: string | null | undefined;
  source_thread_id?: string | null;
  source_label?: string | null;
  /** Explicit URL stored on the row. Always wins if present. */
  source_url?: string | null;
}

export function deriveSourceUrl(ref: SourceRef): string | null {
  if (ref.source_url) return ref.source_url;
  const id = ref.source_thread_id;
  if (!id) return null;
  switch (ref.source_type) {
    case "gmail":
      // Gmail thread id maps directly to the all-mail thread URL. Works
      // for both inbox and archived threads; opens in whichever Google
      // account the browser currently has signed in.
      return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;
    case "slack": {
      // source_thread_id is "<channel_id>:<YYYY-MM-DD>". The day suffix
      // doesn't deep-link to a specific message — but slack.com/app_redirect
      // does open the channel in the user's logged-in workspace, which is
      // 90% of the value.
      const [channelId] = id.split(":");
      if (!channelId) return null;
      return `https://slack.com/app_redirect?channel=${encodeURIComponent(channelId)}`;
    }
    case "fireflies":
      return `https://app.fireflies.ai/view/${encodeURIComponent(id)}`;
    case "gcal":
    case "calendar":
      // Calendar event URLs need a base64-encoded "<eventId> <calendarId>"
      // pair. Without the calendar id we can't build it. Caller can still
      // render the chip; clicking it does nothing.
      return null;
    case "linear":
      // source_thread_id is the issue UUID; we don't have the workspace
      // slug here. The s2d_item should have source_url populated at sync
      // time going forward; for older rows the chip renders unlinked.
      return null;
    default:
      return null;
  }
}

/**
 * Combine the primary source + all linked_sources into a deduped, ordered
 * list ready for rendering. Primary source first, then linked sources in
 * insertion order. Duplicates (same source_type + source_thread_id) are
 * collapsed so we don't show the same chip twice.
 */
export function allSources(item: {
  source_type?: string | null;
  source_thread_id?: string | null;
  source_label?: string | null;
  source_url?: string | null;
  linked_sources?: Array<{
    source_type?: string | null;
    source_thread_id?: string | null;
    source_label?: string | null;
  }>;
}): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  const key = (r: SourceRef) => `${r.source_type ?? ""}::${r.source_thread_id ?? ""}`;

  if (item.source_type && item.source_thread_id) {
    const r: SourceRef = {
      source_type: item.source_type,
      source_thread_id: item.source_thread_id,
      source_label: item.source_label,
      source_url: item.source_url,
    };
    out.push(r);
    seen.add(key(r));
  }
  for (const ls of item.linked_sources ?? []) {
    const r: SourceRef = {
      source_type: ls.source_type,
      source_thread_id: ls.source_thread_id,
      source_label: ls.source_label,
    };
    const k = key(r);
    if (seen.has(k)) continue;
    out.push(r);
    seen.add(k);
  }
  return out;
}
