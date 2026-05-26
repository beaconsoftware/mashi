/**
 * Shared scaffolding for every /api/mcp/tools/* endpoint.
 *
 * Phase 1 of the Mashi Agent buildout (Sep 2026) moved every tool body
 * into `src/lib/agent/tools/<name>.ts` as a `ToolDefinition`. This file
 * stayed put — it still owns the Bearer-token auth flow — but `mcpTool`
 * now consumes a `ToolDefinition` directly so the same tool body is
 * reachable from PATs (Claude Code / DXT) and from the in-app agent
 * loop (Phase 2+).
 *
 * Why service-role + manual user_id filtering rather than a user-scoped
 * client tied to the bearer token? Because MCP tokens aren't Supabase
 * JWTs — they're our own opaque tokens. Resolving them produces a
 * user_id but not a JWT, so we use service-role and apply the user_id
 * filter on every query. Same pattern as the rest of the codebase.
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { bearerFromRequest, verifyToken } from "./tokens";
import type { AnyToolDefinition, ToolDefinition } from "@/lib/agent/types";

export interface ToolContext {
  userId: string;
  supabase: ReturnType<typeof createSupabaseServiceClient>;
}

export type ToolHandler<TArgs, TResult> = (
  args: TArgs,
  ctx: ToolContext
) => Promise<TResult>;

/**
 * Wraps a tool into a Bearer-authed route handler.
 *
 * Two calling conventions are supported:
 *
 *   1. ToolDefinition (preferred, used by the registry):
 *        export const POST = mcpTool(registry.get_item);
 *      Args are validated via the tool's zod schema before the handler runs.
 *
 *   2. Raw handler (legacy):
 *        export const POST = mcpTool<{ q: string }, MyResult>(async (args, ctx) => …);
 *      No arg validation — kept so callers outside the registry don't
 *      have to migrate in lockstep. Prefer ToolDefinition for new tools.
 */
export function mcpTool<TArgs, TResult>(
  defOrHandler: ToolDefinition<TArgs, TResult> | ToolHandler<TArgs, TResult>
): (req: NextRequest) => Promise<NextResponse> {
  const isDefinition =
    typeof defOrHandler === "object" &&
    defOrHandler !== null &&
    "handler" in defOrHandler &&
    "args" in defOrHandler;

  return async (req: NextRequest) => {
    const token = bearerFromRequest(req);
    if (!token) {
      return NextResponse.json(
        { error: "Missing Bearer token. Include `Authorization: Bearer mashi_pat_...`." },
        { status: 401 }
      );
    }
    const auth = await verifyToken(token);
    if (!auth) {
      return NextResponse.json(
        { error: "Invalid or revoked token." },
        { status: 401 }
      );
    }

    let raw: unknown = {};
    try {
      raw = await req.json();
    } catch {
      // Empty body is allowed; tools with required args reject below.
    }

    try {
      if (isDefinition) {
        const def = defOrHandler as ToolDefinition<TArgs, TResult>;
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
        const result = await def.handler(parsed.data, {
          userId: auth.userId,
          supabase: createSupabaseServiceClient(),
          origin: "mcp",
        });
        return NextResponse.json({ ok: true, result });
      }
      const handler = defOrHandler as ToolHandler<TArgs, TResult>;
      const result = await handler(raw as TArgs, {
        userId: auth.userId,
        supabase: createSupabaseServiceClient(),
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

/** Variant for the registry — accepts a heterogeneously-typed
 * definition without forcing the caller to thread the generics through. */
export function mcpToolAny(
  def: AnyToolDefinition
): (req: NextRequest) => Promise<NextResponse> {
  return mcpTool(def);
}
