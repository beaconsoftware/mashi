import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { streamClaudeText } from "@/lib/anthropic/stream";
import { getUserContext } from "@/lib/user-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * POST /api/s2d/:id/chat
 *
 * Multi-turn chat scoped to a single S2D item. The server loads the item +
 * its consolidated context (same data as /context) and bakes it into the
 * system prompt so every reply is grounded in what Mashi knows about this
 * work unit. Streams plain text back so the existing streamPostText helper
 * on the client can render token-by-token.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as ChatBody;

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response("messages required", { status: 400 });
  }

  // Pull the consolidated context off the existing /context endpoint by
  // reusing the same DB queries. Simpler than calling the endpoint over HTTP.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: item } = await supabase
    .from("s2d_items")
    .select("*")
    .eq("id", id)
    .single();
  if (!item) return new Response("item not found", { status: 404 });

  // Gather minimal context: per linked source, pull a snippet/messages list
  // similar to /context but kept lean (we're feeding a prompt, not a UI).
  const contextText = await buildContextText(supabase, item);

  const today = new Date().toISOString().slice(0, 10);
  const userCtx = user ? await getUserContext(user.id) : null;
  const userName = userCtx?.firstName ?? "the user";
  const system = `You are Mashi, ${userName}'s AI Chief of Staff, focused on ONE specific task on their board.

Today: ${today}.

# The task
${item.title}
${item.description ? `\n${item.description}\n` : ""}
pathway: ${item.pathway}
priority: ${item.priority}
status: ${item.status}
${item.queue_reason ? `queue: ${item.queue_reason}` : ""}
${item.outcome ? `outcome: ${item.outcome}` : ""}

# Everything Mashi knows about this work
${contextText}

# How you answer
- ${userName} opened this task and is asking about it specifically. Stay on this task — don't tour the rest of their board.
- Be concrete. Cite actual people, dates, decisions, blockers from the context above.
- If they ask "what should I do" or "draft a reply", DRAFT IT in their voice (which is direct, no preamble, no LLM tells). No em dashes, no "I'd be happy to", no "Let me know".
- If something they're asking isn't in the context, say so plainly — don't fabricate.
- Short answers unless they ask for length. They're busy.`;

  const stream = await streamClaudeText({
    model: "primary",
    system,
    messages: body.messages,
    maxTokens: 1200,
    purpose: "item_chat",
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

type SB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function buildContextText(
  supabase: SB,
  item: { source_type: string | null; source_thread_id: string | null; linked_sources: unknown }
): Promise<string> {
  type RawLinked = {
    source_type?: string | null;
    source_thread_id?: string | null;
    source_label?: string | null;
  };

  const sources: Array<{ source_type: string; source_thread_id: string; source_label: string | null }> =
    [];
  if (item.source_type && item.source_thread_id) {
    sources.push({
      source_type: item.source_type,
      source_thread_id: item.source_thread_id,
      source_label: null,
    });
  }
  for (const ls of (item.linked_sources ?? []) as RawLinked[]) {
    if (!ls.source_type || !ls.source_thread_id) continue;
    if (
      sources.some(
        (s) => s.source_type === ls.source_type && s.source_thread_id === ls.source_thread_id
      )
    ) {
      continue;
    }
    sources.push({
      source_type: ls.source_type,
      source_thread_id: ls.source_thread_id,
      source_label: ls.source_label ?? null,
    });
  }

  if (sources.length === 0) return "(no source context — manually created item)";

  const blocks: string[] = [];
  for (const s of sources) {
    const block = await sourceBlockText(supabase, s);
    if (block) blocks.push(block);
  }
  return blocks.join("\n\n---\n\n");
}

async function sourceBlockText(
  supabase: SB,
  src: { source_type: string; source_thread_id: string; source_label: string | null }
): Promise<string | null> {
  if (src.source_type === "gmail") {
    const { data: msgs } = await supabase
      .from("messages")
      .select("sender_name, sender_email, subject, full_content, preview, received_at")
      .eq("source", "gmail")
      .eq("thread_id", src.source_thread_id)
      .order("received_at", { ascending: true })
      .limit(10);
    if (!msgs || msgs.length === 0) return `GMAIL THREAD (${src.source_label ?? "?"}): (no cached messages)`;
    const lines = msgs.map((m) => {
      const who = m.sender_name || m.sender_email || "?";
      const when = m.received_at ? m.received_at.slice(0, 16) : "";
      const body = (m.full_content || m.preview || "").slice(0, 600);
      return `[${when}] ${who} — ${m.subject ?? ""}\n${body}`;
    });
    return `GMAIL THREAD (${src.source_label ?? msgs[0]?.subject ?? ""}):\n${lines.join("\n\n")}`;
  }

  if (src.source_type === "slack") {
    const { data: msgs } = await supabase
      .from("messages")
      .select("sender_name, channel, full_content, preview, received_at")
      .eq("source", "slack")
      .eq("thread_id", src.source_thread_id)
      .order("received_at", { ascending: true })
      .limit(15);
    if (!msgs || msgs.length === 0) return `SLACK THREAD (${src.source_label ?? "?"}): (no cached messages)`;
    const lines = msgs.map((m) => {
      const who = m.sender_name || "?";
      const when = m.received_at ? m.received_at.slice(0, 16) : "";
      const body = (m.full_content || m.preview || "").slice(0, 400);
      return `[${when}] #${m.channel ?? "?"} ${who}: ${body}`;
    });
    return `SLACK THREAD (${src.source_label ?? ""}):\n${lines.join("\n")}`;
  }

  if (src.source_type === "linear") {
    const { data: issue } = await supabase
      .from("linear_issues")
      .select("title, status, description, assignee_name, url")
      .eq("external_id", src.source_thread_id)
      .maybeSingle();
    if (!issue) return `LINEAR ISSUE (${src.source_label ?? src.source_thread_id}): (not cached)`;
    return `LINEAR ISSUE (${src.source_label ?? ""}):
title: ${issue.title ?? ""}
status: ${issue.status ?? ""}
assignee: ${issue.assignee_name ?? "—"}
url: ${issue.url ?? ""}
description:
${(issue.description ?? "").slice(0, 1500)}`;
  }

  if (src.source_type === "fireflies") {
    const { data: meeting } = await supabase
      .from("meetings")
      .select("title, date, summary, attendees, id")
      .eq("external_id", src.source_thread_id)
      .maybeSingle();
    if (!meeting) return `FIREFLIES MEETING (${src.source_label ?? src.source_thread_id}): (not cached)`;
    const { data: ai } = await supabase
      .from("action_items")
      .select("description, assignee, status")
      .eq("source_meeting_id", meeting.id);
    const aiLines =
      ai && ai.length > 0
        ? ai
            .map((a) => `- ${a.description} (assignee: ${a.assignee ?? "—"}, status: ${a.status})`)
            .join("\n")
        : "(none)";
    return `FIREFLIES MEETING (${src.source_label ?? ""}):
title: ${meeting.title ?? ""}
date: ${meeting.date ?? ""}
summary:
${(meeting.summary ?? "").slice(0, 1500)}

action items:
${aiLines}`;
  }

  return `${src.source_type.toUpperCase()} (${src.source_label ?? src.source_thread_id}): (no resolver)`;
}
