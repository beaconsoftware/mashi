import { mcpTool } from "@/lib/mcp/handler";
import { whoami } from "@/lib/agent/tools/whoami";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(whoami);
