import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gmail sender allowlist (per-connection).
 *
 * GET    → returns { manual, auto, auto_cached_at }
 * POST   → body { add?: string[], remove?: string[] } applied to manual.
 * DELETE → body { entry: string } — convenience equivalent of POST {remove:[entry]}.
 *
 * Manual list lives on `connected_accounts.gmail_sender_allowlist`.
 * Auto list lives in `raw_provider_data.gmail_auto_allowlist` and is
 * refreshed by the sync worker every 24h (or forced via `force_refresh`).
 *
 * Multi-tenancy: this uses the session-scoped Supabase client, so RLS
 * gates every read/write to rows where `user_id = auth.uid()`. No
 * service-role anywhere.
 */

interface AutoAllowlistCache {
  addresses: string[];
  cached_at: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitize(entries: string[]): string[] {
  const out = new Set<string>();
  for (const raw of entries) {
    const v = String(raw ?? "").trim().toLowerCase();
    if (EMAIL_RE.test(v)) out.add(v);
  }
  return [...out];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: conn, error } = await supabase
    .from("connected_accounts")
    .select("id, provider, gmail_sender_allowlist, raw_provider_data")
    .eq("id", id)
    .single();
  if (error || !conn || conn.provider !== "gmail") {
    return NextResponse.json(
      { error: "Gmail connection not found" },
      { status: 404 }
    );
  }

  const manual: string[] = Array.isArray(conn.gmail_sender_allowlist)
    ? (conn.gmail_sender_allowlist as unknown[]).filter(
        (v): v is string => typeof v === "string"
      )
    : [];

  const rawProvider =
    (conn.raw_provider_data as Record<string, unknown> | null) ?? {};
  let auto: string[] = [];
  let auto_cached_at: string | null = null;
  const cached = rawProvider.gmail_auto_allowlist;
  if (cached && typeof cached === "object") {
    const c = cached as Partial<AutoAllowlistCache>;
    if (Array.isArray(c.addresses)) {
      auto = c.addresses.filter((s): s is string => typeof s === "string");
    }
    if (typeof c.cached_at === "string") auto_cached_at = c.cached_at;
  }

  return NextResponse.json({ manual, auto, auto_cached_at });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    add?: unknown;
    remove?: unknown;
    force_refresh?: unknown;
  };

  const addInput = Array.isArray(body.add)
    ? (body.add as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const removeInput = Array.isArray(body.remove)
    ? (body.remove as unknown[]).filter(
        (v): v is string => typeof v === "string"
      )
    : [];
  const forceRefresh = body.force_refresh === true;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: conn, error: readErr } = await supabase
    .from("connected_accounts")
    .select("id, provider, gmail_sender_allowlist, raw_provider_data")
    .eq("id", id)
    .single();
  if (readErr || !conn || conn.provider !== "gmail") {
    return NextResponse.json(
      { error: "Gmail connection not found" },
      { status: 404 }
    );
  }

  // Compute new manual list: existing ∪ add, minus remove. Sanitize at
  // both edges so we never persist a malformed entry.
  const existing = Array.isArray(conn.gmail_sender_allowlist)
    ? (conn.gmail_sender_allowlist as unknown[]).filter(
        (v): v is string => typeof v === "string"
      )
    : [];
  const removeSet = new Set(sanitize(removeInput));
  const next = new Set<string>();
  for (const e of sanitize(existing)) {
    if (!removeSet.has(e)) next.add(e);
  }
  for (const e of sanitize(addInput)) {
    if (!removeSet.has(e)) next.add(e);
  }
  const manual = [...next];

  // Optionally clear the cached_at on the auto-list so the next sync
  // forces a refresh. We don't fetch sent mail synchronously here —
  // that's the sync worker's job, and it has the active access token.
  const rawProvider =
    (conn.raw_provider_data as Record<string, unknown> | null) ?? {};
  let updatedRawProvider: Record<string, unknown> | undefined;
  if (forceRefresh) {
    const cached = rawProvider.gmail_auto_allowlist;
    if (cached && typeof cached === "object") {
      const c = cached as Partial<AutoAllowlistCache>;
      updatedRawProvider = {
        ...rawProvider,
        gmail_auto_allowlist: {
          addresses: Array.isArray(c.addresses) ? c.addresses : [],
          cached_at: new Date(0).toISOString(), // epoch → guaranteed stale
        },
      };
    } else {
      // Nothing cached yet → leave it as-is, next sync will populate.
      updatedRawProvider = rawProvider;
    }
  }

  const { error: updateErr } = await supabase
    .from("connected_accounts")
    .update({
      gmail_sender_allowlist: manual,
      ...(updatedRawProvider !== undefined && {
        raw_provider_data: updatedRawProvider,
      }),
    })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, manual });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { entry?: unknown };
  if (typeof body.entry !== "string") {
    return NextResponse.json(
      { error: "body.entry (string) is required" },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: conn, error: readErr } = await supabase
    .from("connected_accounts")
    .select("id, provider, gmail_sender_allowlist")
    .eq("id", id)
    .single();
  if (readErr || !conn || conn.provider !== "gmail") {
    return NextResponse.json(
      { error: "Gmail connection not found" },
      { status: 404 }
    );
  }

  const target = body.entry.trim().toLowerCase();
  const existing = Array.isArray(conn.gmail_sender_allowlist)
    ? (conn.gmail_sender_allowlist as unknown[]).filter(
        (v): v is string => typeof v === "string"
      )
    : [];
  const manual = sanitize(existing).filter((e) => e !== target);

  const { error: updateErr } = await supabase
    .from("connected_accounts")
    .update({ gmail_sender_allowlist: manual })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, manual });
}
