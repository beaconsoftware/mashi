/**
 * P6.d.a (Epic G2) — unit tests for the pure JSON-RPC / Streamable-HTTP
 * parsing helpers.
 *
 * Self-running assertion script. Run:
 *   pnpm test:mcp-jsonrpc
 *
 * Covers:
 *   - request / notification envelope construction
 *   - parsing a plain application/json body (object + batch array)
 *   - parsing a text/event-stream (SSE) body, skipping heartbeats
 *   - extractResult matches by id, surfaces JSON-RPC errors, and rejects a
 *     missing id rather than returning a wrong value
 *   - a non-JSON body throws rather than silently passing
 */
import {
  buildNotification,
  buildRequest,
  extractResult,
  McpRpcError,
  parseRpcMessages,
} from "@/lib/mcp/jsonrpc";

const stats = { pass: 0, fail: 0 };

function assert(ok: boolean, label: string) {
  if (ok) {
    stats.pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    stats.fail += 1;
    console.error(`  ✗ ${label}`);
  }
}

function testBuild() {
  console.log("envelope construction");
  const req = buildRequest(1, "tools/list", { a: 1 });
  assert(req.jsonrpc === "2.0" && req.id === 1 && req.method === "tools/list", "request has version/id/method");
  assert(JSON.stringify(req.params) === JSON.stringify({ a: 1 }), "request carries params");
  const bare = buildRequest("x", "ping");
  assert(!("params" in bare), "params omitted when undefined");
  const note = buildNotification("notifications/initialized");
  assert(note.jsonrpc === "2.0" && note.method === "notifications/initialized" && !("id" in note), "notification has no id");
}

function testParseJson() {
  console.log("parse application/json");
  const single = parseRpcMessages("application/json", JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
  assert(single.length === 1 && single[0].id === 1, "single object parsed");
  const batch = parseRpcMessages("application/json; charset=utf-8", JSON.stringify([
    { jsonrpc: "2.0", id: 1, result: 1 },
    { jsonrpc: "2.0", id: 2, error: { code: -1, message: "no" } },
    { not: "a response" },
  ]));
  assert(batch.length === 2, "batch keeps only well-formed responses");
  assert(parseRpcMessages("application/json", "").length === 0, "empty body → no messages");
}

function testParseSse() {
  console.log("parse text/event-stream");
  const sse = [
    ": heartbeat",
    "",
    "event: message",
    "data: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"tools\":[]}}",
    "",
    "data: not json",
    "",
  ].join("\n");
  const msgs = parseRpcMessages("text/event-stream", sse);
  assert(msgs.length === 1 && msgs[0].id === 7, "extracts the one real message, skips heartbeat + non-JSON");
}

function testExtract() {
  console.log("extractResult");
  const ok = extractResult<{ v: number }>([{ jsonrpc: "2.0", id: 3, result: { v: 9 } }], 3);
  assert(ok.v === 9, "returns the matching result");
  let threwErr = false;
  try {
    extractResult([{ jsonrpc: "2.0", id: 4, error: { code: -32601, message: "method not found" } }], 4);
  } catch (e) {
    threwErr = e instanceof McpRpcError && (e as McpRpcError).code === -32601;
  }
  assert(threwErr, "JSON-RPC error → McpRpcError with code");
  let threwMissing = false;
  try {
    extractResult([{ jsonrpc: "2.0", id: 1, result: 1 }], 2);
  } catch (e) {
    threwMissing = e instanceof McpRpcError;
  }
  assert(threwMissing, "missing id → throws rather than returning a wrong response");
}

function testNonJson() {
  console.log("non-JSON body");
  let threw = false;
  try {
    parseRpcMessages("text/html", "<html>502 Bad Gateway</html>");
  } catch (e) {
    threw = e instanceof McpRpcError;
  }
  assert(threw, "non-JSON body throws McpRpcError");
}

console.log("\n=== jsonrpc.test.ts ===\n");
testBuild();
testParseJson();
testParseSse();
testExtract();
testNonJson();

console.log(`\n${stats.pass} passed, ${stats.fail} failed\n`);
if (stats.fail > 0) process.exit(1);
