/**
 * P6.d.a (Epic G2) — minimal MCP client over the Streamable HTTP transport.
 *
 * Dependency-free on purpose: MCP is JSON-RPC 2.0 and the Streamable HTTP
 * transport is "POST a JSON-RPC message, read a JSON or SSE reply", so we do
 * not pull in the official SDK (and its lockfile churn) for the small slice we
 * need — `initialize`, `tools/list`, `tools/call`. All envelope construction
 * and body parsing lives in the pure `jsonrpc.ts`; this is the thin fetch shell
 * around it: auth header, session header, timeout/abort.
 *
 * Reliability (A4-style): every request is bounded by a timeout and honors a
 * caller-supplied AbortSignal, so a slow or hung third-party server fails fast
 * rather than hanging a turn.
 */

import {
  buildNotification,
  buildRequest,
  extractResult,
  McpRpcError,
  parseRpcMessages,
} from "@/lib/mcp/jsonrpc";
import type { DiscoveredTool } from "@/lib/mcp/external-tools";

const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 20_000;

export interface McpClientConfig {
  url: string;
  /** Decrypted auth secret (bearer token / API key), or null for none. */
  credential?: string | null;
  /** Header the credential is sent under. Defaults to Authorization (Bearer). */
  authHeader?: string;
  timeoutMs?: number;
}

export interface McpToolCallResult {
  /** Concatenated text content blocks from the tool result. */
  text: string;
  /** Whether the server flagged the result as an error (isError: true). */
  isError: boolean;
}

export class McpClient {
  private readonly url: string;
  private readonly credential: string | null;
  private readonly authHeader: string;
  private readonly timeoutMs: number;
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(config: McpClientConfig) {
    this.url = config.url;
    this.credential = config.credential ?? null;
    this.authHeader = config.authHeader || "Authorization";
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
    };
    if (this.credential) {
      // Authorization gets a Bearer prefix; a custom header gets the raw value.
      h[this.authHeader] =
        this.authHeader.toLowerCase() === "authorization"
          ? `Bearer ${this.credential}`
          : this.credential;
    }
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  /** POST a JSON-RPC request and return its result, or throw McpRpcError. */
  private async request<T>(
    method: string,
    params: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    const id = this.nextId++;
    const res = await this.post(buildRequest(id, method, params), signal);
    const text = await res.text();
    if (!res.ok) {
      throw new McpRpcError(
        `MCP server returned HTTP ${res.status} for ${method}`,
        { code: res.status }
      );
    }
    // A server may hand back its session id on initialize.
    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) this.sessionId = sid;
    const messages = parseRpcMessages(res.headers.get("Content-Type"), text);
    return extractResult<T>(messages, id);
  }

  /** Fire-and-forget JSON-RPC notification (no id, no response read). */
  private async notify(method: string, signal?: AbortSignal): Promise<void> {
    await this.post(buildNotification(method), signal);
  }

  private async post(
    payload: unknown,
    signal?: AbortSignal
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const composite = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;
    return fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: composite,
    });
  }

  /** MCP handshake: initialize + notifications/initialized. Idempotent. */
  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.initialized) return;
    await this.request(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mashi", version: "1.0.0" },
      },
      signal
    );
    await this.notify("notifications/initialized", signal);
    this.initialized = true;
  }

  /** List the server's tools. Initializes first if needed. */
  async listTools(signal?: AbortSignal): Promise<DiscoveredTool[]> {
    await this.initialize(signal);
    const result = await this.request<{ tools?: unknown }>(
      "tools/list",
      {},
      signal
    );
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    const out: DiscoveredTool[] = [];
    for (const t of tools as Array<Record<string, unknown>>) {
      if (t && typeof t.name === "string") {
        out.push({
          name: t.name,
          description:
            typeof t.description === "string" ? t.description : undefined,
          inputSchema: t.inputSchema,
        });
      }
    }
    return out;
  }

  /** Call a tool and flatten its content blocks to text. */
  async callTool(
    name: string,
    args: unknown,
    signal?: AbortSignal
  ): Promise<McpToolCallResult> {
    await this.initialize(signal);
    const result = await this.request<{
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    }>("tools/call", { name, arguments: args ?? {} }, signal);
    const text = (result?.content ?? [])
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n");
    return { text, isError: result?.isError === true };
  }
}
