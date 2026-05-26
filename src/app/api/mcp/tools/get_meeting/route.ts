import { mcpTool } from "@/lib/mcp/handler";
import { get_meeting } from "@/lib/agent/tools/get_meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(get_meeting);
