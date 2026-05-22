import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { streamClaudeText } from "@/lib/anthropic/stream";
import { resolveItemContext } from "@/lib/s2d/context-resolver";
import { emptyBrief, type ItemBrief } from "@/lib/s2d/item-brief";
import {
  buildActionPrompt,
  type ActionKey,
} from "@/lib/s2d/action-agents";
import { MODELS } from "@/lib/anthropic/client";
import { getUserContext } from "@/lib/user-context";
import type { S2DItem } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ActionBody {
  action: ActionKey;
  /** Optional client-supplied brief to skip a redundant fetch. */
  brief?: ItemBrief;
  /** Free-form params (variant tone, delegate name, etc). */
  params?: Record<string, unknown>;
}

/**
 * POST /api/s2d/:id/action
 *
 * Layer 2 of the action toolkit. Routes the action key to a per-action
 * prompt builder, then streams Claude's response back as plain text so
 * the existing streamPostText helper on the client can render it
 * token-by-token in the toolkit drawer.
 *
 * Body shape: { action: ActionKey, brief?: ItemBrief, params?: object }
 *
 * If brief is omitted, the route fetches the live brief by calling
 * /api/s2d/:id/brief logic inline. Passing the brief from the client
 * (where it's already cached in TanStack) saves a redundant LLM call.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as ActionBody;

  if (!body.action) {
    return new Response("action required", { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("not authenticated", { status: 401 });
  }

  const { data: itemRow, error: itemErr } = await supabase
    .from("s2d_items")
    .select("*")
    .eq("id", id)
    .single();
  if (itemErr || !itemRow) {
    return new Response("item not found", { status: 404 });
  }
  const item = itemRow as S2DItem;

  // Need the raw context for the action prompts that quote source material.
  const ctx = await resolveItemContext(supabase, item);

  // Use the client-supplied brief if it's recent and for this item;
  // otherwise produce an empty skeleton (we don't re-synthesize here to
  // avoid double-LLM-call latency, and the action prompts can lean on
  // the raw ctx for substance).
  const brief: ItemBrief =
    body.brief && body.brief.meta?.item_id === id
      ? body.brief
      : emptyBrief(id, MODELS.secondary);

  const userCtx = await getUserContext(user.id);

  let prompt;
  try {
    prompt = buildActionPrompt(body.action, {
      item,
      brief,
      ctx,
      params: body.params,
      userName: userCtx.firstName,
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "bad action", {
      status: 400,
    });
  }

  const stream = await streamClaudeText({
    model: prompt.model,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.userPrompt }],
    maxTokens: prompt.maxTokens,
    purpose: `action:${body.action}`,
    userId: user.id,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
