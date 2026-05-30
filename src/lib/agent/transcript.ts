/**
 * Thread export (D4). Pure, dependency-free serializers so a thread can
 * be exported to Markdown or JSON. No DOM / Blob here — the download
 * wiring lives in the client component; this module is the testable core
 * (`pnpm test:transcript`).
 */

export interface TranscriptThread {
  id: string;
  title: string;
  created_at?: string | null;
}

export interface TranscriptMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; name: string; input: unknown }> | null;
  tool_results?: Array<{
    tool_use_id: string;
    content: string;
    is_error: boolean;
  }> | null;
  created_at?: string;
}

const ROLE_LABEL: Record<TranscriptMessage["role"], string> = {
  user: "You",
  assistant: "Mashi",
  system: "System",
  tool: "Tool",
};

/** Tool names called by an assistant turn, for the compact "used tools"
 * line in the Markdown export. */
function toolNames(msg: TranscriptMessage): string[] {
  if (!Array.isArray(msg.tool_calls)) return [];
  return msg.tool_calls.map((tc) => tc.name);
}

/**
 * Render a thread to readable Markdown. Tool-result rows are folded away
 * (they're machine output); an assistant turn that called tools gets a
 * compact "used: tool_a, tool_b" line so the transcript stays honest
 * about what Mashi did without dumping raw JSON.
 */
export function threadToMarkdown(
  thread: TranscriptThread,
  messages: TranscriptMessage[]
): string {
  const lines: string[] = [];
  lines.push(`# ${thread.title || "Mashi conversation"}`);
  lines.push("");
  if (thread.created_at) {
    lines.push(`_Started ${new Date(thread.created_at).toLocaleString()}_`);
    lines.push("");
  }

  for (const msg of messages) {
    if (msg.role === "tool") continue; // folded into the assistant turn
    const label = ROLE_LABEL[msg.role];
    const body = (msg.content ?? "").trim();
    const tools = toolNames(msg);
    if (!body && tools.length === 0) continue;

    if (body) {
      lines.push(`**${label}:** ${body}`);
    } else {
      lines.push(`**${label}:**`);
    }
    if (tools.length > 0) {
      lines.push("");
      lines.push(`_used: ${tools.join(", ")}_`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Render a thread to structured JSON — the full record including tool
 * calls and results, for re-import / analysis. Stable shape, pretty
 * printed.
 */
export function threadToJSON(
  thread: TranscriptThread,
  messages: TranscriptMessage[]
): string {
  return JSON.stringify(
    {
      thread: {
        id: thread.id,
        title: thread.title,
        created_at: thread.created_at ?? null,
      },
      exported_at: new Date().toISOString(),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls ?? null,
        tool_results: m.tool_results ?? null,
        created_at: m.created_at ?? null,
      })),
    },
    null,
    2
  );
}

/** A filesystem-safe export filename derived from the thread title. */
export function exportFilename(thread: TranscriptThread, ext: "md" | "json"): string {
  const slug = (thread.title || "mashi-conversation")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "mashi-conversation"}.${ext}`;
}
