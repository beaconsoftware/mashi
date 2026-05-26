import { mcpTool } from "@/lib/mcp/handler";
import { who_is } from "@/lib/agent/tools/who_is";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(who_is);
