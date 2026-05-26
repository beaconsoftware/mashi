import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { generateSuccessStatements } from "@/lib/anthropic/success-statement";
import type { Pathway } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sprint/contract
 *
 * Backs the Contract Card (Phase 5). Two sub-modes:
 *
 *   action: "generate"  → returns AI-drafted success_statement strings
 *                         (one per item). Mounted on contract-card open
 *                         so they pre-fill the textboxes.
 *   action: "commit"    → persists the user-edited success_statement
 *                         strings to s2d_items.success_statement. The
 *                         block-level prewarm_opt_in flags live in the
 *                         client Zustand store, so they're set there
 *                         directly — this route only owns DB writes.
 */

type GenItem = {
  id: string;
  title: string;
  pathway: Pathway;
  description?: string | null;
};

interface ReqBody {
  action: "generate" | "commit";
  items?: GenItem[];
  successStatements?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<ReqBody>;
  const action = body.action;

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (action === "generate") {
    const items = Array.isArray(body.items) ? body.items : [];
    const cleaned = items
      .filter(
        (it): it is GenItem =>
          !!it &&
          typeof it.id === "string" &&
          typeof it.title === "string" &&
          typeof it.pathway === "string"
      )
      .slice(0, 8);
    if (cleaned.length === 0) {
      return NextResponse.json({ statements: [] });
    }
    try {
      const statements = await generateSuccessStatements({
        items: cleaned,
        userId: user.id,
      });
      return NextResponse.json({ statements });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "generation failed";
      return NextResponse.json({ error: msg, statements: [] }, { status: 200 });
    }
  }

  if (action === "commit") {
    const statements = body.successStatements ?? {};
    const entries = Object.entries(statements).filter(
      ([id, val]) =>
        typeof id === "string" && id.length > 0 && typeof val === "string"
    );
    if (entries.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }
    const sb = createSupabaseServiceClient();
    let updated = 0;
    for (const [itemId, statement] of entries) {
      const trimmed = statement.trim().slice(0, 200);
      const { error } = await sb
        .from("s2d_items")
        .update({ success_statement: trimmed || null })
        .eq("user_id", user.id)
        .eq("id", itemId);
      if (!error) updated += 1;
    }
    return NextResponse.json({ ok: true, updated });
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}
