/**
 * P6.d.a (Epic G2) — pure JSON-RPC 2.0 helpers for the MCP client.
 *
 * MCP speaks JSON-RPC 2.0. The Streamable HTTP transport replies to a POST
 * either as a single `application/json` object or as a `text/event-stream`
 * (SSE) body whose `data:` lines each carry one JSON-RPC message. All of the
 * envelope construction and response parsing lives here as pure functions so
 * it is unit-testable without a network; `client.ts` is the thin fetch shell
 * that calls these.
 *
 * Nothing here trusts the remote: a malformed body, an error object, or a
 * mismatched id all surface as a thrown `McpRpcError` rather than a silent
 * wrong value.
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number | string;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export class McpRpcError extends Error {
  readonly code?: number;
  readonly data?: unknown;
  constructor(message: string, opts?: { code?: number; data?: unknown }) {
    super(message);
    this.name = "McpRpcError";
    this.code = opts?.code;
    this.data = opts?.data;
  }
}

/** Construct a JSON-RPC request envelope. */
export function buildRequest(
  id: number | string,
  method: string,
  params?: unknown
): JsonRpcRequest {
  const req: JsonRpcRequest = { jsonrpc: "2.0", id, method };
  if (params !== undefined) req.params = params;
  return req;
}

/** Construct a JSON-RPC notification (no id, no response expected). */
export function buildNotification(
  method: string,
  params?: unknown
): JsonRpcNotification {
  const n: JsonRpcNotification = { jsonrpc: "2.0", method };
  if (params !== undefined) n.params = params;
  return n;
}

function isResponseObject(v: unknown): v is JsonRpcResponse {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.jsonrpc === "2.0" && ("result" in o || "error" in o);
}

/**
 * Pull every JSON-RPC message out of a raw HTTP body, given its Content-Type.
 *
 * - `application/json`: the body is a single object (or a batch array).
 * - `text/event-stream`: SSE frames; each `data:` payload is parsed as JSON.
 *   Lines that don't parse (comments, partial frames) are skipped rather than
 *   throwing, so a heartbeat comment can't break a real message.
 *
 * Returns only the well-formed JSON-RPC response objects, in arrival order.
 */
export function parseRpcMessages(
  contentType: string | null | undefined,
  body: string
): JsonRpcResponse[] {
  const ct = (contentType ?? "").toLowerCase();
  const out: JsonRpcResponse[] = [];

  const consider = (parsed: unknown) => {
    if (Array.isArray(parsed)) {
      for (const item of parsed) if (isResponseObject(item)) out.push(item);
    } else if (isResponseObject(parsed)) {
      out.push(parsed);
    }
  };

  if (ct.includes("text/event-stream")) {
    // SSE: split into events on blank lines, collect each event's data lines.
    for (const frame of body.split(/\r?\n\r?\n/)) {
      const dataLines: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length === 0) continue;
      try {
        consider(JSON.parse(dataLines.join("\n")));
      } catch {
        // Not JSON (heartbeat / partial) — skip.
      }
    }
    return out;
  }

  // Default: treat as a single JSON document.
  const trimmed = body.trim();
  if (trimmed.length === 0) return out;
  try {
    consider(JSON.parse(trimmed));
  } catch {
    throw new McpRpcError("MCP server returned a non-JSON body");
  }
  return out;
}

/**
 * Find the response matching `id` and return its `result`, throwing
 * `McpRpcError` on a JSON-RPC error or a missing/mismatched id.
 */
export function extractResult<T = unknown>(
  responses: JsonRpcResponse[],
  id: number | string
): T {
  const match = responses.find((r) => r.id === id);
  if (!match) {
    throw new McpRpcError(`MCP server did not return a response for request ${id}`);
  }
  if ("error" in match) {
    throw new McpRpcError(match.error.message || "MCP server returned an error", {
      code: match.error.code,
      data: match.error.data,
    });
  }
  return match.result as T;
}
