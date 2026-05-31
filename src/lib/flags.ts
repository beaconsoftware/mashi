/**
 * Server-side feature flags.
 *
 * Simple env-gated booleans for staged, behind-a-flag capabilities. A flag is
 * ON only when its env var is the exact string "true"; anything else (unset,
 * empty string, "0", "false") is OFF. This deliberately mirrors the AGENTS.md
 * env-var discipline: an empty string from Vercel must read as "unset", and a
 * boolean flag is the one case where strict equality is the right test (no
 * `||` default needed — absence is the default).
 *
 * Flags live here rather than scattered across modules so the set of staged
 * capabilities is greppable in one place.
 */

function flagEnabled(value: string | undefined): boolean {
  return value === "true";
}

/**
 * G2 (P6.d): the MCP *client* — registering external MCP servers and surfacing
 * their tools to the agent. Staged behind this flag because it is a large,
 * security-sensitive surface (untrusted external tool descriptions are a
 * prompt-injection vector). While OFF, the mcp_servers tables are inert: no
 * discovery runs, no external tools enter the loop, and the settings surface
 * is hidden.
 */
export function isMcpClientEnabled(): boolean {
  return flagEnabled(process.env.MCP_CLIENT_ENABLED);
}
