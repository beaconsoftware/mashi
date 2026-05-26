import { mcpTool } from "@/lib/mcp/handler";
import { context_for_item } from "@/lib/agent/tools/context_for_item";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(context_for_item);
