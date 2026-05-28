import type { AnyToolDefinition } from "@/lib/agent/types";
import { get_item } from "@/lib/agent/tools/get_item";
import { search_board } from "@/lib/agent/tools/search_board";
import { whoami } from "@/lib/agent/tools/whoami";
import { list_today } from "@/lib/agent/tools/list_today";
import { list_companies } from "@/lib/agent/tools/list_companies";
import { who_is } from "@/lib/agent/tools/who_is";
import { get_style } from "@/lib/agent/tools/get_style";
import { context_for_item } from "@/lib/agent/tools/context_for_item";
import { get_message_thread } from "@/lib/agent/tools/get_message_thread";
import { search_messages } from "@/lib/agent/tools/search_messages";
import { get_meeting } from "@/lib/agent/tools/get_meeting";
import { search_meetings } from "@/lib/agent/tools/search_meetings";
import { get_calendar_event } from "@/lib/agent/tools/get_calendar_event";
import { get_linear_issue } from "@/lib/agent/tools/get_linear_issue";
import { search_linear } from "@/lib/agent/tools/search_linear";
import { search_everything } from "@/lib/agent/tools/search_everything";
import { run_sync } from "@/lib/agent/tools/run_sync";
import { get_cursor_context } from "@/lib/agent/tools/get_cursor_context";
import { get_today } from "@/lib/agent/tools/get_today";
import { get_current_sprint } from "@/lib/agent/tools/get_current_sprint";
import { list_needs_review } from "@/lib/agent/tools/list_needs_review";
import { get_thread_summary } from "@/lib/agent/tools/get_thread_summary";
import { get_spawn_chain } from "@/lib/agent/tools/get_spawn_chain";
import { create_item } from "@/lib/agent/tools/create_item";
import { update_item } from "@/lib/agent/tools/update_item";
import { complete_item } from "@/lib/agent/tools/complete_item";
import { snooze_item } from "@/lib/agent/tools/snooze_item";
import { set_pathway } from "@/lib/agent/tools/set_pathway";
import { set_planned_for } from "@/lib/agent/tools/set_planned_for";
import { merge_items } from "@/lib/agent/tools/merge_items";
import { spawn_follow_up } from "@/lib/agent/tools/spawn_follow_up";
import { approve_review_item } from "@/lib/agent/tools/approve_review_item";
import { reject_review_item } from "@/lib/agent/tools/reject_review_item";
import { complete_block } from "@/lib/agent/tools/complete_block";
import { set_success_statement } from "@/lib/agent/tools/set_success_statement";
import { log_decision } from "@/lib/agent/tools/log_decision";
import { record_watch_check_in } from "@/lib/agent/tools/record_watch_check_in";
import { set_watch_target } from "@/lib/agent/tools/set_watch_target";
import { set_plan } from "@/lib/agent/tools/set_plan";
import { resolve_reference } from "@/lib/agent/tools/resolve_reference";
import { attach_thread_to_item } from "@/lib/agent/tools/attach_thread_to_item";
import { list_recent_threads } from "@/lib/agent/tools/list_recent_threads";
import { ask_followup_question } from "@/lib/agent/tools/ask_followup_question";
// Phase 5 — ring 3 (write_world) catalogue + supporting reads.
import { list_linear_teams } from "@/lib/agent/tools/list_linear_teams";
import { send_email } from "@/lib/agent/tools/send_email";
import { draft_email } from "@/lib/agent/tools/draft_email";
import { mark_email_read } from "@/lib/agent/tools/mark_email_read";
import { archive_email } from "@/lib/agent/tools/archive_email";
import { send_slack_message } from "@/lib/agent/tools/send_slack_message";
import { react_with_emoji } from "@/lib/agent/tools/react_with_emoji";
import { create_calendar_event } from "@/lib/agent/tools/create_calendar_event";
import { update_calendar_event } from "@/lib/agent/tools/update_calendar_event";
import { staged_to_meeting } from "@/lib/agent/tools/staged_to_meeting";
import { create_linear_issue } from "@/lib/agent/tools/create_linear_issue";
import { update_linear_issue } from "@/lib/agent/tools/update_linear_issue";
import { comment_on_linear_issue } from "@/lib/agent/tools/comment_on_linear_issue";

/**
 * Canonical catalogue of every agent-callable tool. One source of
 * truth consumed by:
 *   - the MCP route handlers (`/api/mcp/tools/*`) via `mcpTool(def)`
 *   - the in-app agent loop (Phase 2+) via direct handler invocation
 *   - the optional `sessionTool` wrapper for session-authed one-shot
 *     endpoints
 *
 * Phases 1, 2 added the ring 1 (`read`) tools. Phase 3 adds the ring 2
 * (`write_mashi`) set below; Phase 5 will add the ring 3
 * (`write_world`) set.
 *
 * Note on sprint lifecycle: start_sprint, add_to_sprint, pause_sprint,
 * resume_sprint, exit_sprint live in the client-side Zustand sprint
 * store, not in Postgres — there's no server-side handle on a live
 * sprint to mutate. They are intentionally NOT in the ring-2 catalogue;
 * sprint lifecycle has to be driven from the takeover UI directly.
 */
export const TOOL_REGISTRY: Record<string, AnyToolDefinition> = {
  // Ring 1 (read)
  [get_item.name]: get_item,
  [search_board.name]: search_board,
  [whoami.name]: whoami,
  [list_today.name]: list_today,
  [list_companies.name]: list_companies,
  [who_is.name]: who_is,
  [get_style.name]: get_style,
  [context_for_item.name]: context_for_item,
  [get_message_thread.name]: get_message_thread,
  [search_messages.name]: search_messages,
  [get_meeting.name]: get_meeting,
  [search_meetings.name]: search_meetings,
  [get_calendar_event.name]: get_calendar_event,
  [get_linear_issue.name]: get_linear_issue,
  [search_linear.name]: search_linear,
  [search_everything.name]: search_everything,
  [run_sync.name]: run_sync,
  [get_cursor_context.name]: get_cursor_context,
  [get_today.name]: get_today,
  [get_current_sprint.name]: get_current_sprint,
  [list_needs_review.name]: list_needs_review,
  [get_thread_summary.name]: get_thread_summary,
  [get_spawn_chain.name]: get_spawn_chain,
  // Phase 4 — reference resolver + orphan thread surface
  [resolve_reference.name]: resolve_reference,
  [list_recent_threads.name]: list_recent_threads,
  // Quality Phase 1 — structured clarification escape valve.
  [ask_followup_question.name]: ask_followup_question,
  // Ring 2 (write_mashi) — Phase 3
  [create_item.name]: create_item,
  [update_item.name]: update_item,
  [complete_item.name]: complete_item,
  [snooze_item.name]: snooze_item,
  [set_pathway.name]: set_pathway,
  [set_planned_for.name]: set_planned_for,
  [merge_items.name]: merge_items,
  [spawn_follow_up.name]: spawn_follow_up,
  [approve_review_item.name]: approve_review_item,
  [reject_review_item.name]: reject_review_item,
  [complete_block.name]: complete_block,
  [set_success_statement.name]: set_success_statement,
  [log_decision.name]: log_decision,
  [record_watch_check_in.name]: record_watch_check_in,
  [set_watch_target.name]: set_watch_target,
  // Phase 8 — Focus card plan editor
  [set_plan.name]: set_plan,
  // Phase 4 — binding orphan threads to items
  [attach_thread_to_item.name]: attach_thread_to_item,
  // Phase 5 — supporting read for Linear creates
  [list_linear_teams.name]: list_linear_teams,
  // Ring 3 (write_world) — Phase 5
  [send_email.name]: send_email,
  [draft_email.name]: draft_email,
  [mark_email_read.name]: mark_email_read,
  [archive_email.name]: archive_email,
  [send_slack_message.name]: send_slack_message,
  [react_with_emoji.name]: react_with_emoji,
  [create_calendar_event.name]: create_calendar_event,
  [update_calendar_event.name]: update_calendar_event,
  [staged_to_meeting.name]: staged_to_meeting,
  [create_linear_issue.name]: create_linear_issue,
  [update_linear_issue.name]: update_linear_issue,
  [comment_on_linear_issue.name]: comment_on_linear_issue,
};

export const TOOL_REGISTRY_LIST: AnyToolDefinition[] =
  Object.values(TOOL_REGISTRY);

export function getTool(name: string): AnyToolDefinition | undefined {
  return TOOL_REGISTRY[name];
}
