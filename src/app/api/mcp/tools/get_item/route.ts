import { mcpTool } from "@/lib/mcp/handler";
import { get_item } from "@/lib/agent/tools/get_item";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(get_item);
