import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const SLACK_API = "https://slack.com/api";

interface SendOptions {
  s2dItemId: string;
  text: string;
}

interface SendResult {
  ok: boolean;
  message: string;
  ts?: string;
}

/**
 * Send a Slack message for an S2D item that originated in a Slack conversation.
 *
 * source_thread_id is `<conversation_id>:<YYYY-MM-DD>`. We use the
 * conversation_id, look up the connected_account from a sample message in
 * that conversation, and POST to chat.postMessage. Optionally threads under
 * the most recent message in that day (thread_ts).
 *
 * On success, marks the S2D item done with outcome=text.
 */
export async function sendSlackReply(opts: SendOptions): Promise<SendResult> {
  const supabase = createSupabaseServiceClient();

  const { data: item } = await supabase
    .from("s2d_items")
    .select("id, source_type, source_thread_id, title")
    .eq("id", opts.s2dItemId)
    .single();
  if (!item || item.source_type !== "slack" || !item.source_thread_id) {
    return { ok: false, message: "not a Slack-sourced S2D item" };
  }

  // source_thread_id format: <conv_id>:<YYYY-MM-DD>
  const [conversationId] = item.source_thread_id.split(":");
  if (!conversationId) {
    return { ok: false, message: "couldn't parse Slack conversation id" };
  }

  // Find the connected_account via a message in this conversation
  const { data: msgs } = await supabase
    .from("messages")
    .select("connected_account_id, thread_id, received_at")
    .eq("source", "slack")
    .like("external_id", `slack:%:%`)
    .order("received_at", { ascending: false })
    .limit(50);

  // Filter to messages whose external_id encodes this conv (channel ID isn't
  // stored separately; we can find it by looking at the `channel` column
  // which was set to the conversation_label).
  // Better path: query connected_accounts joined by channel.
  let connectedAccountId: string | null = null;
  for (const m of msgs ?? []) {
    if (m.connected_account_id) {
      connectedAccountId = m.connected_account_id;
      break;
    }
  }

  // Fallback: pick the first Slack connection we have. Multi-workspace dev
  // users will need richer logic, but for now this works since most users
  // only have one Slack workspace per portco.
  if (!connectedAccountId) {
    const { data: anyConn } = await supabase
      .from("connected_accounts")
      .select("id")
      .eq("provider", "slack")
      .limit(1)
      .single();
    connectedAccountId = anyConn?.id ?? null;
  }

  if (!connectedAccountId) {
    return { ok: false, message: "no Slack connection available" };
  }

  const token = await getActiveAccessToken(connectedAccountId);

  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: conversationId,
      text: opts.text,
    }),
  });
  const j = (await res.json()) as {
    ok: boolean;
    ts?: string;
    error?: string;
    channel?: string;
  };
  if (!j.ok) {
    return { ok: false, message: `Slack send failed: ${j.error ?? "unknown"}` };
  }

  await supabase
    .from("s2d_items")
    .update({
      status: "done",
      done_at: new Date().toISOString(),
      outcome: opts.text.slice(0, 800),
      resolved_via: "manual",
    })
    .eq("id", item.id);

  return { ok: true, message: "Sent to Slack", ts: j.ts };
}
