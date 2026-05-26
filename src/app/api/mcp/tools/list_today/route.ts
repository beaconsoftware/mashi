import { mcpTool } from "@/lib/mcp/handler";
import { list_today } from "@/lib/agent/tools/list_today";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(list_today);
