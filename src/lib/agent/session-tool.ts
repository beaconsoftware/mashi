import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import type { AnyToolDefinition, ToolDefinition } from "@/lib/agent/types";

/**
 * `sessionTool(def)` — wraps a `ToolDefinition` into a session-authed
 * Next.js route handler. The in-app agent (Phase 2) calls the handler
 * directly; this wrapper is what powers any future "expose a single
 * tool as a session-authed POST endpoint" use cases (e.g. quick
 * cockpit panels that want to fire one read without booting the
 * agent loop).
 *
 * Auth model: resolves the user from the Supabase session cookie. If
 * there's no session, returns 401. The handler is then handed a
 * service-role client + the resolved user id — every query inside
 * the handler must continue to scope by `ctx.userId` (per
 * AGENTS.md multi-tenancy invariants). Service-role bypasses RLS, so
 * the handler MUST NOT trust queries that aren't user-scoped.
 *
 * Why service-role here even though we have a session? Symmetry with
 * `mcpTool`: tools are written once, consume the same `ToolContext`,
 * and apply the user_id filter at the query level. Re-using service
 * role keeps the tool implementations identical across surfaces.
 */
export function sessionTool<TArgs, TResult>(
  def: ToolDefinition<TArgs, TResult>
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    const supa = await createSupabaseServerClient();
    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json(
        { ok: false, error: "Not signed in." },
        { status: 401 }
      );
    }

    let raw: unknown = {};
    try {
      raw = await req.json();
    } catch {
      // Empty body is allowed; tools with required args will reject below.
    }

    const parsed = def.args.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid arguments.",
          issues: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    try {
      const result = await def.handler(parsed.data, {
        userId: userData.user.id,
        supabase: createSupabaseServiceClient(),
        origin: "session",
      });
      return NextResponse.json({ ok: true, result });
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "tool failed",
        },
        { status: 500 }
      );
    }
  };
}

/** Looser-typed variant for the registry — callers that store
 * heterogeneous definitions in a `Map<string, AnyToolDefinition>` can
 * use this without having to cast back to a concrete generic. */
export function sessionToolAny(
  def: AnyToolDefinition
): (req: NextRequest) => Promise<NextResponse> {
  return sessionTool(def);
}
