import type {
  PostToolUseHook,
  PreToolUseHook,
} from "@/lib/agent/hooks/types";
import { ring3ApprovalHook } from "@/lib/agent/hooks/ring3-approval";
import { dedupCreateHook } from "@/lib/agent/hooks/dedup-create";
import { ring2AuditHook } from "@/lib/agent/hooks/ring2-audit";
import { logToolCallHook } from "@/lib/agent/hooks/log-tool-call";

/**
 * Quality Phase 4 — hook chain registry.
 *
 * Order matters. Pre-tool hooks run in declaration order; the first
 * non-`allow` / non-`transform` decision short-circuits. Post-tool
 * hooks all run regardless.
 *
 * Order rationale:
 *   1. dedup-create — cheapest first-line gate; should run before any
 *      external system is touched.
 *   2. ring3-approval — last, because asking the user is the
 *      most-expensive gate. Approval also blocks the stream for up to
 *      270s.
 *
 * To add a new gate (per-recipient allowlists, rate limits, dry-run
 * preview): drop a new file under hooks/, register it here in the
 * right position.
 */

export const HOOKS: {
  preTool: PreToolUseHook[];
  postTool: PostToolUseHook[];
} = {
  preTool: [dedupCreateHook, ring3ApprovalHook],
  postTool: [ring2AuditHook, logToolCallHook],
};
