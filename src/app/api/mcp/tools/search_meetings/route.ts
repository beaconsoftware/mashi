import { mcpTool } from "@/lib/mcp/handler";
import { search_meetings } from "@/lib/agent/tools/search_meetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(search_meetings);
