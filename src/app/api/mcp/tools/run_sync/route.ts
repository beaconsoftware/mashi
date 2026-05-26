import { mcpTool } from "@/lib/mcp/handler";
import { run_sync } from "@/lib/agent/tools/run_sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 300;

export const POST = mcpTool(run_sync);
