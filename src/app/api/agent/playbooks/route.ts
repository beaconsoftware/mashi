import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import {
  createPlaybook,
  deletePlaybook,
  loadUserPlaybooks,
} from "@/lib/agent/playbooks-server";
import { BUILTIN_PLAYBOOKS } from "@/lib/agent/playbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/agent/playbooks — list / create / delete the user's playbooks (F2).
 * Session-authed; the user_id comes from the cookie so playbooks can never be
 * read or mutated across users.
 *
 *   GET    → { builtins: [...], playbooks: [...] }  (user's own, newest first)
 *   POST   → create/edit one from a draft { name, description?, params?, steps }
 *   DELETE → remove one { id }  (built-ins are read-only and have no row)
 *
 * The draft shape is validated by the pure `validatePlaybookDraft` inside
 * `createPlaybook`; the route only checks identity here.
 */

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
  const playbooks = await loadUserPlaybooks(userId, sb);
  return NextResponse.json({ builtins: BUILTIN_PLAYBOOKS, playbooks });
}

export async function POST(req: NextRequest) {
  const userId = await requireUser();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const draft = await req.json().catch(() => null);
  const sb = createSupabaseServiceClient();
  const result = await createPlaybook({ userId, draft, supabase: sb });
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
  const result = await deletePlaybook({
    userId,
    id: parsed.data.id,
    supabase: sb,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
