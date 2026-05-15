import { NextRequest } from "next/server";
import { streamClaudeText } from "@/lib/anthropic/stream";
import { buildS2DSystemPrompt } from "@/lib/anthropic/prompts";
import { getPathwayPrompt } from "@/lib/anthropic/pathway-prompts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { S2DItem } from "@/types";
import type { StyleProfile } from "@/types/style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SuggestBody {
  item: S2DItem;
  styleProfile?: StyleProfile | null;
}

/**
 * POST /api/s2d/:id/suggest
 *
 * Stream a pathway-specific suggestion for an S2D item. The client sends the
 * full item in the body (no DB yet); Phase 2 swaps this for a server-side
 * lookup once Supabase is wired.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as SuggestBody | S2DItem;

  // Accept legacy body shape (raw item) for backwards compat during dev.
  const item: S2DItem | undefined =
    "item" in (body as object) ? (body as SuggestBody).item : (body as S2DItem);
  const styleProfile =
    "styleProfile" in (body as object) ? (body as SuggestBody).styleProfile : null;

  if (!item?.title || !item?.pathway) {
    return new Response("Missing item fields", { status: 400 });
  }

  const system = buildS2DSystemPrompt({ styleProfile });
  const userPrompt = getPathwayPrompt(item, item.pathway);

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const stream = await streamClaudeText({
    model: "primary",
    system,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 700,
    purpose: "copilot",
    userId: user?.id ?? null,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
