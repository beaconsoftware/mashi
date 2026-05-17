/**
 * Shared scaffolding for every /api/mcp/tools/* endpoint.
 *
 * Each tool is a small function `(args, ctx) => Promise<result>` where
 * ctx has `userId` and `supabase` (service-role client, scoped by the
 * caller passing `userId` into every query — we don't do anything
 * special at the client level, the discipline is at the query level).
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

export interface ToolContext {
  userId: string;
  supabase: ReturnType<typeof createSupabaseServiceClient>;
}

export type ToolHandler<TArgs, TResult> = (
  args: TArgs,
  ctx: ToolContext
) => Promise<TResult>;

/**
 * Wraps a tool handler with auth + JSON parsing + error formatting.
 * Use in /api/mcp/tools/<name>/route.ts like:
 *
 *   export const POST = mcpTool<{ query: string }, MyResult>(async (args, ctx) => {
 *     const { data } = await ctx.supabase
 *       .from("s2d_items")
 *       .select("*")
 *       .eq("user_id", ctx.userId)
 *       .ilike("title", `%${args.query}%`);
 *     return data ?? [];
 *   });
 */
export function mcpTool<TArgs, TResult>(
  handler: ToolHandler<TArgs, TResult>
): (req: NextRequest) => Promise<NextResponse> {
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

    let args: TArgs;
    try {
      args = (await req.json()) as TArgs;
    } catch {
      args = {} as TArgs;
    }

    try {
      const result = await handler(args, {
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
