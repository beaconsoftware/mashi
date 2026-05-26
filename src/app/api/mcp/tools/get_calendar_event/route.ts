import { mcpTool } from "@/lib/mcp/handler";
import { get_calendar_event } from "@/lib/agent/tools/get_calendar_event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(get_calendar_event);
