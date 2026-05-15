import { NextRequest } from "next/server";
import { streamClaudeText } from "@/lib/anthropic/stream";
import { buildChatSystemPrompt } from "@/lib/anthropic/prompts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StyleProfile } from "@/types/style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  currentPage?: string;
  styleProfile?: StyleProfile | null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatBody;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response("messages required", { status: 400 });
  }

  // Anthropic requires the first message to be from the user. The chat panel
  // seeds an assistant greeting; strip it from the first turn if present.
  const messages = body.messages[0]?.role === "assistant" ? body.messages.slice(1) : body.messages;

  if (messages.length === 0) {
    return new Response("no user message", { status: 400 });
  }

  const system = buildChatSystemPrompt({
    currentPage: body.currentPage,
    styleProfile: body.styleProfile,
  });

  const stream = await streamClaudeText({
    model: "primary",
    system,
    messages,
    maxTokens: 800,
    purpose: "chat",
    userId: user?.id ?? null,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
