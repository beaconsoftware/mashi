/**
 * Sentence embeddings via OpenAI's `text-embedding-3-small`.
 *
 * Used by Phase 6 tool retrieval:
 *   - `scripts/embed-tools.ts` — offline pass over TOOL_REGISTRY_LIST.
 *   - `src/lib/agent/retrieve.ts` — per-turn query embedding.
 *
 * Why OpenAI and not @huggingface/transformers (the previous choice):
 * @huggingface/transformers depends on `libonnxruntime.so.1` which is not
 * shipped in Vercel's serverless Node runtime. A top-level import there
 * crashes the whole route at module load time. Network-based embeddings
 * are immune to that class of problem and add negligible latency
 * (~50–150ms per turn for an ~10-token query) and negligible cost
 * (~$0.02 / 1M tokens; per-turn cost is sub-cent).
 *
 * Model: `text-embedding-3-small` — 1536 dims, cheap, plenty of signal
 * for short tool-description queries.
 *
 * On any failure (missing key, network outage, OpenAI 5xx) the caller's
 * try/catch is expected to fall back to "ship the full candidate pool"
 * — the agent stays functional, we just spend more tokens for one turn.
 */

const MODEL = "text-embedding-3-small";
const ENDPOINT = "https://api.openai.com/v1/embeddings";

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * Embed a single text into a 1536-dim vector. OpenAI returns
 * L2-normalized vectors for the `-3-` family, so cosine similarity
 * reduces to dot product (consumers shouldn't rely on that — we keep
 * the full cosine formula in `cosineSimilarity`).
 */
export async function embedRemote(text: string): Promise<number[]> {
  const [vec] = await embedRemoteBatch([text]);
  return vec;
}

/**
 * Embed a batch of texts in one API call. Returns vectors in matching
 * input order. We sort the response by `index` because the API doesn't
 * guarantee response order, even though in practice it's stable today.
 */
export async function embedRemoteBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY not set — cannot embed");
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as EmbeddingResponse;
  if (!Array.isArray(json.data) || json.data.length !== texts.length) {
    throw new Error(
      `OpenAI embeddings returned ${json.data?.length ?? 0} vectors for ${texts.length} inputs`
    );
  }
  // Defensive sort — API SHOULD return in input order but we don't want
  // a quiet ordering bug to silently scramble the tool index.
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/**
 * Cosine similarity. OpenAI's `-3-` embeddings are unit-normalized so
 * this reduces to a dot product, but we keep the full formula so
 * callers can pass any vector safely.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const EMBEDDING_MODEL = MODEL;
