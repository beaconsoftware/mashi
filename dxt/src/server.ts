/**
 * Mashi DXT — MCP stdio server.
 *
 * Bundled into a single .js file via esbuild (see dxt/build.mjs) so the
 * .dxt can run under Claude Desktop's embedded Node without an
 * `npm install` step. The bundle includes @modelcontextprotocol/sdk.
 *
 * Architecture: this server holds no data. Every tool call HTTPS-POSTs
 * to https://mashi-beacon-sw.vercel.app/api/mcp/tools/<name> with the
 * user's API token in the Authorization header. The Mashi server does
 * the auth + DB work and returns JSON, which we surface as the tool
 * response.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_TOKEN = process.env.MASHI_API_TOKEN;
const BASE_URL = (process.env.MASHI_BASE_URL || "https://mashi-beacon-sw.vercel.app").replace(/\/$/, "");

if (!API_TOKEN) {
  console.error("Mashi DXT: MASHI_API_TOKEN env var is required. Configure it in Claude Desktop → Extensions → Mashi.");
  process.exit(1);
}

// ── Tool catalog ────────────────────────────────────────────────────
// JSON Schema for each tool's args. Keep these accurate — Claude reads
// them to know what it can do.
const TOOLS: Array<{ name: string; description: string; inputSchema: object }> = [
  {
    name: "whoami",
    description:
      "Identify the current Mashi user. Returns profile, connected providers, and counts of companies + open board items. Call this first if you're unsure who's driving.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_today",
    description:
      "What does today look like? Returns today's calendar events, urgent + high-priority open items, items scheduled in today's sprint, and items resurfacing from snooze. Good orientation call at the start of a session.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_companies",
    description: "List the user's portfolio companies. Each has id, name, color, status, email_domain.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_board",
    description:
      "Search S2D (board) items. The board is the user's unified task list across every source. Use this for 'what's on my plate about X' or 'find anything related to Y'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword to match in title, description, outcome." },
        pathway: {
          oneOf: [
            { type: "string", enum: ["quick_reply", "drafted_response", "meeting_backed", "heads_down", "decision_gate", "delegated", "watching"] },
            { type: "array", items: { type: "string" } },
          ],
        },
        priority: {
          oneOf: [
            { type: "string", enum: ["urgent", "high", "medium", "low"] },
            { type: "array", items: { type: "string" } },
          ],
        },
        status: {
          oneOf: [
            { type: "string", enum: ["backlog", "todo", "in_progress", "in_queue", "done"] },
            { type: "array", items: { type: "string" } },
          ],
        },
        company_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_meetings",
    description: "Search Fireflies meetings cached locally. Returns title/date/summary/attendees.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        company_id: { type: "string" },
        since: { type: "string", description: "ISO date; only meetings on/after." },
        limit: { type: "integer", default: 20, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_messages",
    description: "Search Gmail + Slack messages cached locally. Returns sender/subject/preview/timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        source: { type: "string", enum: ["gmail", "slack"] },
        sender_email: { type: "string" },
        since: { type: "string", description: "ISO date." },
        limit: { type: "integer", default: 30, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_linear",
    description: "Search Linear issues cached locally. Filter by query/status/priority/assignee.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { type: "string" },
        priority: { type: "integer" },
        assignee_email: { type: "string" },
        company_id: { type: "string" },
        limit: { type: "integer", default: 30, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_everything",
    description: "Cross-source search in one call. Returns hits from board, meetings, messages, Linear with a `kind` discriminator. Use for 'tell me everything about X'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit_per_source: { type: "integer", default: 5, maximum: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_item",
    description: "Full detail on one S2D item — by UUID or by ticket number (e.g. 237 for MASH-237). Includes linked_sources for cross-source provenance.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "UUID" },
        ticket_number: { type: "integer", description: "Integer (e.g. 237 for MASH-237)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_meeting",
    description: "One meeting + its extracted action_items. Identify by DB id or by Fireflies external_id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        external_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_message_thread",
    description: "Every message in a Gmail thread or Slack day-slice conversation, ordered chronologically.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["gmail", "slack"] },
        thread_id: { type: "string" },
      },
      required: ["source", "thread_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_linear_issue",
    description: "Full Linear issue by DB id, Linear external_id, or URL.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        external_id: { type: "string" },
        url: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_calendar_event",
    description: "Calendar event by DB id or external_id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        external_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "who_is",
    description: "Cross-source person lookup. Pass a name or email — returns recent Gmail from them, Slack messages, Linear issues they're assigned to, S2D items mentioning them, and meetings they attended.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Name or email of the person" },
        limit_per_source: { type: "integer", default: 5, maximum: 25 },
      },
      required: ["identifier"],
      additionalProperties: false,
    },
  },
  {
    name: "context_for_item",
    description: "Full source-side context bundle for one S2D item — hydrates every linked Gmail thread, Slack convo, Linear issue, Fireflies meeting, Calendar event. Use when you need to understand 'what is MASH-N actually about'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        ticket_number: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
];

// ── HTTP client for the Mashi backend ───────────────────────────────
async function callMashi(tool: string, args: unknown): Promise<unknown> {
  const url = `${BASE_URL}/api/mcp/tools/${tool}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const msg =
      (body as { error?: string }).error ??
      `Mashi returned ${res.status}`;
    throw new Error(msg);
  }
  return (body as { result?: unknown }).result ?? body;
}

// ── MCP server wiring ───────────────────────────────────────────────
const server = new Server(
  { name: "mashi", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const known = TOOLS.find((t) => t.name === name);
  if (!known) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }
  try {
    const result = await callMashi(name, args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `mashi.${name} failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
});

// Surface any fatal error to stderr so Claude Desktop's MCP log shows
// the reason instead of just "Server transport closed unexpectedly".
process.on("uncaughtException", (err) => {
  console.error("[mashi-dxt] uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[mashi-dxt] unhandledRejection:", err);
});

const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (err) {
  console.error("[mashi-dxt] connect failed:", err);
  process.exit(1);
}
