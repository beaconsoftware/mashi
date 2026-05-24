/**
 * Auth helpers for the activity-watcher API.
 *
 * Two paths:
 *   - Bearer mashi_pat_... (feeder clients: Mac helper, browser extension)
 *     Requires the 'activity:write' scope on the token.
 *   - Supabase session cookie (Mashi web app reading/writing the user's
 *     own suggestions + settings).
 *
 * Returns a `{ userId }` shape on success or a NextResponse to short-
 * circuit the route with the appropriate 401/403.
 */

import { NextResponse } from "next/server";
import { bearerFromRequest, verifyToken } from "@/lib/mcp/tokens";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const ACTIVITY_WRITE_SCOPE = "activity:write";

export type ActivityAuthResult =
  | { ok: true; userId: string; via: "bearer" | "session" }
  | { ok: false; response: NextResponse };

export async function authenticateActivity(
  req: Request,
  opts: { requireWriteScope?: boolean } = {}
): Promise<ActivityAuthResult> {
  // Path 1: Bearer token (feeders)
  const bearer = bearerFromRequest(req);
  if (bearer) {
    const verified = await verifyToken(bearer);
    if (!verified) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid or revoked token" },
          { status: 401 }
        ),
      };
    }
    if (
      opts.requireWriteScope &&
      !verified.scopes.includes(ACTIVITY_WRITE_SCOPE)
    ) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: `Token missing required scope: ${ACTIVITY_WRITE_SCOPE}`,
          },
          { status: 403 }
        ),
      };
    }
    return { ok: true, userId: verified.userId, via: "bearer" };
  }

  // Path 2: Supabase session (web app)
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  return { ok: true, userId: user.id, via: "session" };
}
