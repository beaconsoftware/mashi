import { mcpTool } from "@/lib/mcp/handler";
import { get_linear_issue } from "@/lib/agent/tools/get_linear_issue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(get_linear_issue);
