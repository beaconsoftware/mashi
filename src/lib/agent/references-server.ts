import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_REFERENCES, type AgentReference } from "@/lib/agent/references";

/**
 * B2 (P3) — canonicalize pinned @-mention references against the user's
 * own data before persisting them.
 *
 * Server-only. The composer sends `{kind, id, label, ticketNumber}`, but
 * the `label`/`ticketNumber` are client-supplied and the `id` could be
 * forged. Rather than trust either, we re-read the referenced ids from
 * `s2d_items` scoped by `user_id` and rebuild each reference from the DB:
 *   - drops any id that isn't the user's own item (forgery / cross-user)
 *   - drops any id that no longer exists (stale)
 *   - replaces the label/ticket with the canonical DB values, so no
 *     attacker-controlled prose ever reaches the model prompt.
 *
 * Returns the canonical, deduped, capped list (or [] when there are none).
 */
export async function canonicalizeItemReferences(opts: {
  references: AgentReference[] | undefined;
  userId: string;
  supabase: SupabaseClient;
}): Promise<AgentReference[]> {
  const refs = opts.references ?? [];
  if (refs.length === 0) return [];

  // Only `item` references exist today; collect their ids (deduped, capped).
  const ids = [
    ...new Set(refs.filter((r) => r.kind === "item").map((r) => r.id)),
  ].slice(0, MAX_REFERENCES);
  if (ids.length === 0) return [];

  const { data, error } = await opts.supabase
    .from("s2d_items")
    .select("id, ticket_number, title")
    .eq("user_id", opts.userId)
    .in("id", ids);
  if (error || !data) return [];

  // Preserve the order the user pinned them in.
  const byId = new Map(
    (data as Array<{ id: string; ticket_number: number | null; title: string }>).map(
      (row) => [row.id, row]
    )
  );
  const out: AgentReference[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    out.push({
      kind: "item",
      id: row.id,
      label: row.title,
      ticketNumber: row.ticket_number,
    });
  }
  return out;
}
