import { mcpTool } from "@/lib/mcp/handler";
import { search_board } from "@/lib/agent/tools/search_board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export const POST = mcpTool(search_board);
