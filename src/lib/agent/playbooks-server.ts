import type { SupabaseClient } from "@supabase/supabase-js";
import {
  slugify,
  validatePlaybookDraft,
  type Playbook,
  type PlaybookParam,
} from "@/lib/agent/playbooks";

/**
 * F2 (P6.b) — server reads/writes for `agent_playbooks`.
 *
 * Kept apart from the pure `playbooks.ts` so the definition shape, prompt
 * composition, and validation stay importable into the client trigger UI
 * without dragging Supabase along. Every query is `user_id`-scoped per the
 * multi-tenancy doctrine (the table is owner-only RLS, but these run under a
 * service client, so we filter explicitly).
 */

type Supa = SupabaseClient;

interface PlaybookRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  params: unknown;
  steps: unknown;
}

function rowToPlaybook(r: PlaybookRow): Playbook {
  const params: PlaybookParam[] = Array.isArray(r.params)
    ? (r.params as PlaybookParam[])
    : [];
  const steps: string[] = Array.isArray(r.steps)
    ? (r.steps as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? "",
    params,
    steps,
    builtin: false,
  };
}

/** Load the user's own playbooks, newest first. */
export async function loadUserPlaybooks(
  userId: string,
  supabase: Supa
): Promise<Playbook[]> {
  const { data, error } = await supabase
    .from("agent_playbooks")
    .select("id, name, slug, description, params, steps")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as PlaybookRow[]).map(rowToPlaybook);
}

/**
 * Validate + persist a user-authored playbook. The draft is validated by the
 * pure `validatePlaybookDraft` (the route never trusts the raw client shape).
 * Slug collisions upsert onto the existing row so re-saving a same-named
 * playbook edits it rather than failing on the unique index.
 */
export async function createPlaybook(input: {
  userId: string;
  draft: unknown;
  supabase: Supa;
}): Promise<{ ok: boolean; playbook?: Playbook; error?: string }> {
  const validated = validatePlaybookDraft(input.draft);
  if (!validated.ok) return { ok: false, error: validated.error };
  const { name, description, params, steps } = validated.draft;
  const slug = slugify(name) || "playbook";

  const { data, error } = await input.supabase
    .from("agent_playbooks")
    .upsert(
      {
        user_id: input.userId,
        name,
        slug,
        description,
        params,
        steps,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,slug" }
    )
    .select("id, name, slug, description, params, steps")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Couldn't save playbook." };
  }
  return { ok: true, playbook: rowToPlaybook(data as PlaybookRow) };
}

export async function deletePlaybook(input: {
  userId: string;
  id: string;
  supabase: Supa;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await input.supabase
    .from("agent_playbooks")
    .delete()
    .eq("user_id", input.userId)
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
