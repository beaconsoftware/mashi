import { mcpTool } from "@/lib/mcp/handler";
import { search_messages } from "@/lib/agent/tools/search_messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(search_messages);
