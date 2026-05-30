/**
 * B2 (P3) — @-mention references, shared pure module.
 *
 * Sibling of `attachments.ts`: no DB / SDK / browser-client imports, so it
 * runs on both the client (composer typeahead) and the server (route intake
 * + replay) and is unit-tested in isolation (`__tests__/references.test.ts`).
 *
 * Flow overview:
 *   1. The composer's `@`-typeahead searches the user's cached board items
 *      and, on pick, pins an `AgentReference` chip (id + label, never a
 *      free-text guess).
 *   2. The composer sends `AgentReference[]` alongside the message text.
 *   3. The route shape-sanitizes them; the loop re-validates each id against
 *      the user's own `s2d_items` (canonical title + ticket, dropping forged
 *      / foreign / stale ids) and persists the canonical set on the user
 *      `agent_messages` row.
 *   4. On every turn `messagesToReplay` prepends a short "pinned references"
 *      note to that user message so the model treats them as already
 *      resolved and skips the `resolve_reference` round-trip.
 *
 * Scope: today the only reference kind is `item` (an S2D board item). That
 * is the entity `resolve_reference` resolves, so it is the one with a
 * disambiguation round-trip to skip. The `kind` discriminant leaves room for
 * future kinds without a schema change.
 */

/** Cap on pinned references per message — generous for the common case,
 * bounded so a forged body can't inflate the prompt. */
export const MAX_REFERENCES = 8;

export type ReferenceKind = "item";

/**
 * A pinned reference that travels client → route → message row. It is a
 * pointer (kind + id) plus a denormalized display label; the loop rebuilds
 * the canonical label/ticket from the DB so the persisted copy never trusts
 * client-supplied prose. The same shape is stored verbatim in the
 * `agent_messages.pinned_references` JSONB column.
 */
export interface AgentReference {
  kind: ReferenceKind;
  /** s2d_items.id (uuid). Scoped to the user by the server re-validation. */
  id: string;
  /** Display title. Canonicalized from the DB server-side. */
  label: string;
  /** MASH-N when the item has one. Null/absent for legacy rows. */
  ticketNumber?: number | null;
}

/** Human label for a reference, e.g. `MASH-1408 "Approve Q4 brand spend"`. */
export function referenceLabel(ref: AgentReference): string {
  const ticket =
    typeof ref.ticketNumber === "number" ? `MASH-${ref.ticketNumber} ` : "";
  return `${ticket}"${ref.label}"`.trim();
}

/**
 * Parse / sanitize a raw references array (from a request body or a DB
 * JSONB cell) into well-shaped descriptors. Drops anything malformed and
 * caps the count rather than throwing, so one bad entry never wedges a
 * turn. This is shape-only validation; ownership of the `id` is enforced
 * separately server-side (the loop re-reads s2d_items scoped by user).
 */
export function sanitizeReferences(raw: unknown): AgentReference[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentReference[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (r.kind !== "item") continue;
    const id = typeof r.id === "string" ? r.id : "";
    if (!id || id.length > 128) continue;
    if (seen.has(id)) continue;
    const label =
      typeof r.label === "string" && r.label.trim().length > 0
        ? r.label.trim().slice(0, 256)
        : "item";
    const ticketNumber =
      typeof r.ticketNumber === "number" && Number.isFinite(r.ticketNumber)
        ? r.ticketNumber
        : null;
    seen.add(id);
    out.push({ kind: "item", id, label, ticketNumber });
    if (out.length >= MAX_REFERENCES) break;
  }
  return out;
}

/**
 * Build the short note prepended to a user message that carries pinned
 * references. It names each item and instructs the model to treat them as
 * already resolved, so it references them directly (by MASH-N) instead of
 * calling `resolve_reference`. Returns "" when there are none.
 */
export function referencesToPromptText(refs: AgentReference[]): string {
  if (refs.length === 0) return "";
  const lines = refs.map((r) => `- ${referenceLabel(r)} (item id ${r.id})`);
  return [
    "[Pinned references the user attached to this message. They are already resolved, refer to them directly by MASH-N and do NOT call resolve_reference for them:",
    ...lines,
    "]",
  ].join("\n");
}
