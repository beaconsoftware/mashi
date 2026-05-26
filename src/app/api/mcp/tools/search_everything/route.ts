import { mcpTool } from "@/lib/mcp/handler";
import { search_everything } from "@/lib/agent/tools/search_everything";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(search_everything);
