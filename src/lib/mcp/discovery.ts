import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptOrNull } from "@/lib/encryption";
import { isMcpClientEnabled } from "@/lib/flags";
import { McpClient } from "@/lib/mcp/client";
import { discoveredToolToRecord } from "@/lib/mcp/external-tools";

/**
 * P6.d.a (Epic G2) — server-side discovery: connect to a registered MCP
 * server, list its tools, and refresh the persisted catalogue.
 *
 * Multi-tenancy (AGENTS.md hard rules 1, 4, 5): every read here scopes by
 * `userId` (the `mcp_servers` row id is opaque, so we filter on both id and
 * user_id), and every write sets `user_id` explicitly. The caller MUST have
 * already authenticated the user and passed their own id — this function never
 * derives identity itself.
 *
 * Gated by the MCP_CLIENT_ENABLED flag: while OFF this is a no-op so the
 * foundation cannot do anything in production until a later sub-row turns it on.
 */

type Supa = SupabaseClient;

interface McpServerRow {
  id: string;
  user_id: string;
  slug: string;
  transport: "streamable_http" | "sse";
  url: string;
  credentials: string | null;
  auth_header: string;
}

export interface DiscoveryResult {
  ok: boolean;
  toolCount: number;
  error?: string;
}

/**
 * Load an owner-scoped server row. Returns null if it doesn't exist or isn't
 * owned by `userId` (the explicit user_id filter is the IDOR guard — never
 * trust the id alone under service-role).
 */
async function loadServer(
  serverId: string,
  userId: string,
  supabase: Supa
): Promise<McpServerRow | null> {
  const { data, error } = await supabase
    .from("mcp_servers")
    .select("id, user_id, slug, transport, url, credentials, auth_header")
    .eq("id", serverId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as McpServerRow;
}

/**
 * Connect to a server, list its tools, and replace its cached catalogue.
 *
 * Best-effort and self-contained: any failure (flag off, unknown server,
 * transport error, bad credentials) is recorded on the server row's status and
 * returned as `{ ok: false, error }` rather than thrown, so a settings "Test
 * connection" button can render it without try/catch plumbing.
 */
export async function syncServerTools(
  serverId: string,
  userId: string,
  supabase: Supa,
  signal?: AbortSignal
): Promise<DiscoveryResult> {
  if (!isMcpClientEnabled()) {
    return { ok: false, toolCount: 0, error: "MCP client is disabled" };
  }

  const server = await loadServer(serverId, userId, supabase);
  if (!server) {
    return { ok: false, toolCount: 0, error: "server not found" };
  }

  try {
    const client = new McpClient({
      url: server.url,
      credential: decryptOrNull(server.credentials),
      authHeader: server.auth_header,
    });
    const tools = await client.listTools(signal);
    const records = tools.map(discoveredToolToRecord);

    // Replace the catalogue: drop rows for tools the server no longer reports,
    // then upsert the current set. All writes set user_id explicitly.
    const currentNames = records.map((r) => r.tool_name);
    let staleDelete = supabase
      .from("mcp_server_tools")
      .delete()
      .eq("server_id", server.id)
      .eq("user_id", userId);
    if (currentNames.length > 0) {
      staleDelete = staleDelete.not(
        "tool_name",
        "in",
        `(${currentNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(",")})`
      );
    }
    await staleDelete;

    if (records.length > 0) {
      await supabase.from("mcp_server_tools").upsert(
        records.map((r) => ({
          user_id: userId,
          server_id: server.id,
          tool_name: r.tool_name,
          description: r.description,
          input_schema: r.input_schema,
          ring: r.ring,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "server_id,tool_name" }
      );
    }

    await supabase
      .from("mcp_servers")
      .update({
        status: "connected",
        last_error: null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", server.id)
      .eq("user_id", userId);

    return { ok: true, toolCount: records.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("mcp_servers")
      .update({
        status: "error",
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", server.id)
      .eq("user_id", userId);
    return { ok: false, toolCount: 0, error: message };
  }
}
