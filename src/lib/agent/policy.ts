/**
 * P4.b (Epic E1 + E5) — pure per-tool approval policy logic.
 *
 * Deliberately free of any server / Supabase / React import so it is safe to
 * pull into the client approval card AND unit-test in isolation
 * (`pnpm test:policy`). The server reads the rows (`policy-server.ts`); this
 * module decides what they MEAN for a given call.
 *
 * Three modes per (tool, scope):
 *   - `always_allow` — skip the approval card for matching calls.
 *   - `ask`          — current behaviour (default): show the card.
 *   - `never`        — block the call outright, no card.
 *
 * Scope keeps `always_allow` narrow (privacy doctrine): a policy row scopes
 * to a derived key (`channel:…`, `to:…`) or the `*` wildcard. The most
 * specific match wins. And `always_allow` is only HONOURED for actions that
 * aren't irreversible sends — see `isAlwaysAllowEligible` (this is the E5
 * "reclassification": a reversible draft / reaction can be waved through, an
 * irreversible email / Slack post / Linear comment can not).
 */
import { approvalMetaFor } from "@/lib/agent/approval-meta";

export type PolicyMode = "always_allow" | "ask" | "never";

export interface ToolPolicy {
  id?: string;
  tool_name: string;
  scope: string;
  mode: PolicyMode;
}

/** Matches any args for the tool. */
export const WILDCARD_SCOPE = "*";

/**
 * Whether a tool may be set to (and have honoured) an `always_allow` policy.
 *
 * E5 / privacy doctrine: an irreversible SEND to a human (email, Slack post,
 * Linear comment) is never waved through automatically — those stay `ask`
 * or `never`. Everything lighter (a Gmail draft, an emoji reaction, a
 * mark-read/archive, an external create/update we can recall or change) is
 * eligible. Driven off the approval *weight* so it stays in lockstep with the
 * card's own send-vs-reversible classification (`approval-meta.ts`).
 */
export function isAlwaysAllowEligible(toolName: string): boolean {
  return approvalMetaFor(toolName).weight !== "send";
}

/**
 * Derive the narrow scope key for a specific call. `always_allow` set for
 * one scope must not leak to another (acceptance: "skips the card for that
 * scope only"). Slack actions scope by channel; email by recipient;
 * everything else is unscoped (`*`).
 */
export function scopeForCall(toolName: string, args: unknown): string {
  const a =
    args && typeof args === "object"
      ? (args as Record<string, unknown>)
      : {};
  switch (toolName) {
    case "send_slack_message":
    case "react_with_emoji":
      return typeof a.channel === "string" && a.channel
        ? `channel:${a.channel}`
        : WILDCARD_SCOPE;
    case "send_email":
    case "draft_email":
      return typeof a.to === "string" && a.to
        ? `to:${a.to.trim().toLowerCase()}`
        : WILDCARD_SCOPE;
    default:
      return WILDCARD_SCOPE;
  }
}

/**
 * Resolve the configured mode for a call against the user's policy rows.
 * Exact-scope match wins over the wildcard; absent both, the default is
 * `ask` (the safe, unchanged behaviour).
 */
export function resolvePolicy(
  policies: ToolPolicy[],
  toolName: string,
  callScope: string
): PolicyMode {
  const forTool = policies.filter((p) => p.tool_name === toolName);
  const exact = forTool.find((p) => p.scope === callScope);
  if (exact) return exact.mode;
  const wild = forTool.find((p) => p.scope === WILDCARD_SCOPE);
  if (wild) return wild.mode;
  return "ask";
}

/**
 * The mode the ring-3 hook should actually act on. Layers the eligibility
 * guardrail on top of the raw resolution: an `always_allow` on an
 * ineligible (irreversible-send) tool is downgraded to `ask` so the card
 * still gates it. `never` and `ask` pass through unchanged.
 */
export function effectiveDecision(
  policies: ToolPolicy[],
  toolName: string,
  callScope: string
): PolicyMode {
  const mode = resolvePolicy(policies, toolName, callScope);
  if (mode === "always_allow" && !isAlwaysAllowEligible(toolName)) {
    return "ask";
  }
  return mode;
}

/**
 * Short human suffix describing the scope an inline "always allow" affordance
 * would write, e.g. " in this channel", " to this address", or "" for an
 * unscoped tool. Used by the approval card's remember toggle.
 */
export function rememberScopeLabel(toolName: string, args: unknown): string {
  const scope = scopeForCall(toolName, args);
  if (scope === WILDCARD_SCOPE) return "";
  if (scope.startsWith("channel:")) return " in this channel";
  if (scope.startsWith("to:")) return " to this address";
  return "";
}

/** Human-readable rendering of a stored scope key for the settings list. */
export function describeScope(scope: string): string {
  if (scope === WILDCARD_SCOPE) return "any";
  if (scope.startsWith("channel:")) return `channel ${scope.slice(8)}`;
  if (scope.startsWith("to:")) return scope.slice(3);
  return scope;
}
