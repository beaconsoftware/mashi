import { mcpTool } from "@/lib/mcp/handler";
import { list_companies } from "@/lib/agent/tools/list_companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(list_companies);
