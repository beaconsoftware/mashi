import { mcpTool } from "@/lib/mcp/handler";
import { search_linear } from "@/lib/agent/tools/search_linear";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(search_linear);
