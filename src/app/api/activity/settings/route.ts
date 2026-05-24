/**
 * GET /api/activity/settings — fetch the user's activity_settings row
 * POST /api/activity/settings — upsert it
 *
 * Web-session auth only. Used by the Settings → Activity Watcher page to
 * toggle enabled, manage pause, and edit ignore lists.
 *
 * Note: pause and resume are convenience aliases handled here too via the
 * `paused_until` field on POST. A separate /api/activity/pause endpoint
 * is provided for the menubar helper (which speaks a simpler shape).
 */

import { NextResponse } from "next/server";
import { authenticateActivity } from "@/lib/activity/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpsertBody {
  enabled?: boolean;
  paused_until?: string | null;
  ignore_apps?: string[];
  ignore_domains?: string[];
}

export async function GET(req: Request) {
  const auth = await authenticateActivity(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("activity_settings")
    .select("enabled, paused_until, ignore_apps, ignore_domains, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    data ?? {
      enabled: false,
      paused_until: null,
      ignore_apps: [],
      ignore_domains: [],
    }
  );
}

export async function POST(req: Request) {
  const auth = await authenticateActivity(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let body: UpsertBody;
  try {
    body = (await req.json()) as UpsertBody;
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const fields: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (typeof body.enabled === "boolean") fields.enabled = body.enabled;
  if (body.paused_until !== undefined) fields.paused_until = body.paused_until;
  if (Array.isArray(body.ignore_apps)) fields.ignore_apps = body.ignore_apps;
  if (Array.isArray(body.ignore_domains)) fields.ignore_domains = body.ignore_domains;

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("activity_settings")
    .upsert(fields, { onConflict: "user_id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
