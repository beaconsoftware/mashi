/**
 * Quality Phase 6: tool retrieval over the registry.
 *
 * On every turn we used to ship every ring-matched tool to the model
 * (50+ entries). Token cost grew linearly and accuracy degraded past
 * ~30 tools because the model has to attend across more options.
 *
 * Now we ship a small per-turn slice:
 *   - The always-on CORE_TOOLS (cursor + lookups + clarifier).
 *   - Top-K by cosine similarity between the user message and each
 *     tool's offline-embedded description (default K=10).
 *   - Sticky retention: anything called earlier in this thread, so
 *     multi-turn flows don't lose access mid-conversation.
 *
 * Embeddings are precomputed by `pnpm embed-tools` and committed at
 * `src/lib/agent/tools/_embeddings.json`. Freshness is checked by
 * `pnpm check:embeddings` (purely hash-based — no API key needed in CI).
 *
 * If the runtime embed call fails (OpenAI outage, missing key, network),
 * we fall back to the full mode-and-ring-filtered pool. Better to spend
 * tokens than break the agent.
 */
import { TOOL_REGISTRY_LIST } from "@/lib/agent/registry";
import type { AnyToolDefinition, ToolRing } from "@/lib/agent/types";
import { cosineSimilarity, embedRemote } from "@/lib/embeddings/openai";
import embeddingsData from "@/lib/agent/tools/_embeddings.json";

interface EmbeddingEntry {
  descriptionHash: string;
  embedding: number[];
}

interface EmbeddingsFile {
  model: string;
  dimensions: number;
  generatedAt: string;
  tools: Record<string, EmbeddingEntry>;
}

const EMBEDDINGS = embeddingsData as EmbeddingsFile;

/**
 * Tools that ALWAYS ship regardless of retrieval. Cursor lookups,
 * board search, the clarifier escape valve, and the message-thread
 * reader cover the vast majority of opening moves. Adding anything
 * here costs tokens on every single turn, so the bar is high.
 *
 * Plan mode further trims this to read-only + ask_followup_question;
 * any name in CORE_TOOLS that isn't `read`/`ask_followup_question`
 * is filtered out before the model sees it.
 */
export const CORE_TOOLS = [
  "get_cursor_context",
  "get_item",
  "search_board",
  "whoami",
  "ask_followup_question",
  "get_message_thread",
  "resolve_reference",
] as const;

export interface RetrieveToolsOpts {
  /** The current turn's user message — the retrieval query. */
  userMessage: string;
  /** Plan vs Act mode. Plan mode hard-filters to read + ask. */
  mode: "plan" | "act";
  /** Which rings the caller has opted into. Phase 3+ callers pass
   * ["read","write_mashi","write_world"] for act mode; phase 2 callers
   * pass ["read"]. Ignored in plan mode. */
  rings: ToolRing[];
  /** Sticky retention: tool names already called in this thread.
   * Always kept in the returned set even if they score below K, as long
   * as they're allowed by the mode/ring filter. */
  calledThisThread?: string[];
  /** Top-K retrieved by similarity. Default 10. */
  k?: number;
}

/**
 * Public for testing. Given a candidate pool and a query embedding,
 * return the top-K candidates by cosine similarity. Pure function.
 */
export function rankByEmbedding(
  candidates: AnyToolDefinition[],
  queryEmbedding: number[],
  k: number
): string[] {
  const scored: Array<{ name: string; score: number }> = [];
  for (const def of candidates) {
    const entry = EMBEDDINGS.tools[def.name];
    if (!entry) continue;
    scored.push({
      name: def.name,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.name);
}

/**
 * Filter the registry to the candidate pool for this turn, respecting
 * plan/act mode. Exported for testing — production callers should
 * prefer `retrieveTools()`.
 */
export function candidatePoolForMode(
  mode: "plan" | "act",
  rings: ToolRing[]
): AnyToolDefinition[] {
  if (mode === "plan") {
    return TOOL_REGISTRY_LIST.filter(
      (d) => d.ring === "read" || d.name === "ask_followup_question"
    );
  }
  const set = new Set(rings);
  return TOOL_REGISTRY_LIST.filter((d) => set.has(d.ring));
}

/**
 * Resolve the toolset for a single turn.
 *
 * Returns AnyToolDefinition[] (preserving the loop's downstream
 * expectations) sized to roughly 8-18 tools: CORE_TOOLS ∪ sticky ∪
 * top-K retrieved, all intersected with the mode/ring candidate pool.
 *
 * On any embedding failure we fall back to returning the full candidate
 * pool — the agent stays functional, just less token-efficient.
 */
export async function retrieveTools(
  opts: RetrieveToolsOpts
): Promise<AnyToolDefinition[]> {
  const k = opts.k ?? 10;
  const candidates = candidatePoolForMode(opts.mode, opts.rings);
  const candidateNames = new Set(candidates.map((d) => d.name));
  const candidateByName = new Map(candidates.map((d) => [d.name, d]));

  // Always-on core, intersected with the candidate pool. (In plan
  // mode this drops ring-2/3 names automatically.)
  const finalNames = new Set<string>();
  for (const name of CORE_TOOLS) {
    if (candidateNames.has(name)) finalNames.add(name);
  }

  // Sticky retention — same intersection rule.
  for (const name of opts.calledThisThread ?? []) {
    if (candidateNames.has(name)) finalNames.add(name);
  }

  // Top-K by similarity. On any failure we ship the whole candidate
  // pool so the agent keeps working.
  try {
    const trimmed = opts.userMessage.trim();
    if (trimmed.length === 0) {
      // Empty turn (e.g. re-entry after a follow-up) — just core + sticky.
      return candidates.filter((d) => finalNames.has(d.name));
    }
    const queryEmbedding = await embedRemote(trimmed);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      throw new Error("empty embedding response");
    }
    const topK = rankByEmbedding(candidates, queryEmbedding, k);
    for (const name of topK) finalNames.add(name);
  } catch (err) {
    console.warn(
      "[agent/retrieve] embedding failed, falling back to full candidate pool:",
      err instanceof Error ? err.message : err
    );
    return candidates;
  }

  // Preserve registry order so the model sees a stable list across turns.
  const out: AnyToolDefinition[] = [];
  for (const def of candidates) {
    if (finalNames.has(def.name)) {
      out.push(candidateByName.get(def.name)!);
    }
  }
  return out;
}

/**
 * Extract the names of every tool already called in a thread's
 * persisted messages. Used to seed `calledThisThread` for retrieval.
 *
 * Defensive about the JSONB shape — `tool_calls` may be `null`, an
 * array, or (in legacy rows) a malformed value.
 */
export function calledToolNamesFromMessages(
  messages: Array<{ tool_calls: unknown | null }>
): string[] {
  const out = new Set<string>();
  for (const row of messages) {
    if (!Array.isArray(row.tool_calls)) continue;
    for (const tc of row.tool_calls as Array<{ name?: unknown }>) {
      if (typeof tc?.name === "string") out.add(tc.name);
    }
  }
  return [...out];
}
