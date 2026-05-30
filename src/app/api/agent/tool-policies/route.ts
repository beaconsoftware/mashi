import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import {
  deleteToolPolicy,
  loadToolPolicies,
  setToolPolicy,
} from "@/lib/agent/policy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/agent/tool-policies — CRUD for the per-tool approval policy (E1).
 * Session-authed; the user_id comes from the cookie so policies can never be
 * read or mutated across users.
 *
 *   GET    → { policies: [...] }
 *   POST   → upsert one { tool_name, scope?, mode }
 *   DELETE → remove one  { id }
 */

const postSchema = z.object({
  tool_name: z.string().min(1).max(128),
  scope: z.string().max(256).optional(),
  mode: z.enum(["always_allow", "ask", "never"]),
});
const deleteSchema = z.object({ id: z.string().uuid() });

async function requireUser() {
  const userSb = await createSupabaseServerClient();
  const { data, error } = await userSb.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

export async function GET() {
  const userId = await requireUser();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = createSupabaseServiceClient();
  const policies = await loadToolPolicies(userId, sb);
  return NextResponse.json({ policies });
}

export async function POST(req: NextRequest) {
  const userId = await requireUser();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid policy." }, { status: 400 });
  }
  const sb = createSupabaseServiceClient();
  const result = await setToolPolicy({
    userId,
    toolName: parsed.data.tool_name,
    scope: parsed.data.scope,
    mode: parsed.data.mode,
    supabase: sb,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUser();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = deleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }
  const sb = createSupabaseServiceClient();
  const result = await deleteToolPolicy({
    userId,
    id: parsed.data.id,
    supabase: sb,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
