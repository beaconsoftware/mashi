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

/**
 * Canonical catalogue of every agent-callable tool. One source of
 * truth consumed by:
 *   - the MCP route handlers (`/api/mcp/tools/*`) via `mcpTool(def)`
 *   - the in-app agent loop (Phase 2+) via direct handler invocation
 *   - the optional `sessionTool` wrapper for session-authed one-shot
 *     endpoints
 *
 * As of Phase 1 every tool here is ring=`read`. Phase 3 will add the
 * ring 2 (`write_mashi`) set; Phase 5 the ring 3 (`write_world`) set.
 */
export const TOOL_REGISTRY: Record<string, AnyToolDefinition> = {
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
};

export const TOOL_REGISTRY_LIST: AnyToolDefinition[] =
  Object.values(TOOL_REGISTRY);

export function getTool(name: string): AnyToolDefinition | undefined {
  return TOOL_REGISTRY[name];
}
