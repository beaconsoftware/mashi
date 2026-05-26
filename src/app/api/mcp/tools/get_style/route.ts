import { mcpTool } from "@/lib/mcp/handler";
import { get_style } from "@/lib/agent/tools/get_style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;


export const POST = mcpTool(get_style);
