import type {
  EnrichPulledSource,
  EnrichSourceKind,
} from "@/hooks/use-enriched-context";
import type { SourceContext } from "@/lib/s2d/claude-prompt";

/**
 * Unified source row surfaced in the slot's merged list. Same shape as
 * an `EnrichPulledSource` plus an `origin` discriminator so the UI can
 * subtly differentiate pulled (agent-surfaced) from cached (linked at
 * triage time) without splitting them into two sections.
 */
export interface MergedSource {
  kind: EnrichSourceKind;
  ref: string;
  label: string;
  snippet: string;
  when: string | null;
  pinned: boolean;
  origin: "pulled" | "cached";
}

/**
 * Cached signals come back from /api/s2d/[id]/context. We project each
 * SourceContext into the same shape as an EnrichPulledSource so the
 * merged list is one homogeneous array.
 *
 * The ref synthesis (source_type:source_thread_id) lets us dedupe
 * against pulled sources that already surfaced the same thread.
 */
export function projectCachedSignal(s: SourceContext): MergedSource | null {
  const kind = mapCachedKindToEnrichKind(s.source_type);
  if (!kind) return null;
  return {
    kind,
    ref: `${s.source_type}:${s.source_thread_id}`,
    label: s.source_label ?? deriveLabel(s),
    snippet: s.snippet ?? deriveSnippet(s),
    when: deriveWhen(s),
    pinned: false,
    origin: "cached",
  };
}

function mapCachedKindToEnrichKind(t: string): EnrichSourceKind | null {
  switch (t) {
    case "gmail":
    case "slack":
    case "linear":
    case "fireflies":
      return t;
    // `calendar` and `other` don't map cleanly onto the EnrichSourceKind
    // union today; drop them rather than coerce. They show up in the
    // detail sheet's full Source-context view instead.
    default:
      return null;
  }
}

function deriveLabel(s: SourceContext): string {
  const d = s.details;
  if (d.kind === "gmail" && d.messages.length > 0) {
    const last = d.messages[d.messages.length - 1];
    return last?.subject ?? `Gmail · ${d.messages.length}`;
  }
  if (d.kind === "slack" && d.messages.length > 0) {
    const last = d.messages[d.messages.length - 1];
    return last?.channel ? `#${last.channel}` : `Slack · ${d.messages.length}`;
  }
  if (d.kind === "linear" && d.issue) {
    return d.issue.title ?? "Linear issue";
  }
  if (d.kind === "fireflies" && d.meeting) {
    return d.meeting.title ?? "Fireflies meeting";
  }
  return s.source_type;
}

function deriveSnippet(s: SourceContext): string {
  const d = s.details;
  if (d.kind === "gmail" && d.messages.length > 0) {
    return (d.messages[d.messages.length - 1]?.body ?? "").slice(0, 200);
  }
  if (d.kind === "slack" && d.messages.length > 0) {
    return (d.messages[d.messages.length - 1]?.body ?? "").slice(0, 200);
  }
  if (d.kind === "linear" && d.issue?.description) {
    return d.issue.description.slice(0, 200);
  }
  if (d.kind === "fireflies" && d.meeting?.summary) {
    return d.meeting.summary.slice(0, 200);
  }
  return "";
}

function deriveWhen(s: SourceContext): string | null {
  const d = s.details;
  if (d.kind === "gmail" && d.messages.length > 0) {
    return d.messages[d.messages.length - 1]?.at ?? null;
  }
  if (d.kind === "slack" && d.messages.length > 0) {
    return d.messages[d.messages.length - 1]?.at ?? null;
  }
  if (d.kind === "fireflies" && d.meeting?.date) {
    return d.meeting.date;
  }
  return null;
}

/**
 * Merge pulled (from enriched_context) + cached (from item context) into
 * one ordered list.
 *
 * Sort rules:
 *   1. Pinned first (regardless of origin).
 *   2. Then by `when` desc (newest first; null sorts last).
 *   3. When timestamps tie (or both null), pulled before cached — the
 *      pulled set reflects the agent's most-recent judgement of "what
 *      matters for this item".
 *   4. Dedup on `kind:ref` — pulled wins (it has the pinned flag the UI
 *      needs to render the pin button correctly).
 */
export function mergeSources(
  pulled: EnrichPulledSource[],
  cached: SourceContext[]
): MergedSource[] {
  const projected: MergedSource[] = pulled.map((p) => ({ ...p, origin: "pulled" }));
  const seen = new Set(projected.map((p) => `${p.kind}:${p.ref}`));
  for (const c of cached) {
    const mapped = projectCachedSignal(c);
    if (!mapped) continue;
    if (seen.has(`${mapped.kind}:${mapped.ref}`)) continue;
    seen.add(`${mapped.kind}:${mapped.ref}`);
    projected.push(mapped);
  }

  return projected.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const at = a.when ? new Date(a.when).getTime() : -Infinity;
    const bt = b.when ? new Date(b.when).getTime() : -Infinity;
    if (at !== bt) return bt - at;
    if (a.origin !== b.origin) return a.origin === "pulled" ? -1 : 1;
    return 0;
  });
}
