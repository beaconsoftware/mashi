/**
 * Local-only sentence embeddings via @huggingface/transformers.
 *
 * Picked for Quality Phase 6 (tool retrieval) so the runtime has no
 * external API dependency — no key, no network call per request. The
 * model is downloaded once at process boot and cached in-memory for
 * the lifetime of the function instance.
 *
 * Model: `Xenova/all-MiniLM-L6-v2` — 384-dim sentence embeddings, ~25MB
 * ONNX, good baseline quality for short English text. We mean-pool and
 * L2-normalize the token embeddings, which is the canonical sentence-
 * embedding recipe for this model family.
 *
 * Used by:
 *   - `scripts/embed-tools.ts` — offline pass over TOOL_REGISTRY_LIST.
 *   - `src/lib/agent/retrieve.ts` — per-turn query embedding.
 *
 * Runtime caveat: on Vercel serverless `@huggingface/transformers`
 * cannot load — it depends on `libonnxruntime.so.1`, a native shared
 * library that isn't present in the Node runtime image. The static
 * import alone is enough to blow the function up with a 500 before any
 * caller's try/catch can fire. So:
 *
 *   1. The import is dynamic + try/wrapped so failures are catchable.
 *   2. We refuse to even attempt loading on Vercel (`VERCEL=1`) —
 *      `retrieveTools()` then falls back to shipping the full ring-
 *      filtered tool pool. Less token-efficient, but the agent works.
 *
 * Offline scripts (`pnpm embed-tools`) still get the full local path
 * because Node CLI doesn't set `VERCEL`. That keeps the precomputed
 * `_embeddings.json` build pipeline intact.
 */

// Loosely typed because we lazy-load the module — pulling the real
// FeatureExtractionPipeline type would force a static import of
// @huggingface/transformers and reintroduce the cold-start crash.
type FeatureExtractionPipeline = (
  texts: string[],
  opts: { pooling: "mean"; normalize: true }
) => Promise<{ tolist(): number[][] }>;

const MODEL = "Xenova/all-MiniLM-L6-v2";

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function isUnsupportedRuntime(): boolean {
  // Vercel sets VERCEL=1 in every serverless invocation. The onnxruntime
  // native binary doesn't ship in Vercel's Node runtime, so loading the
  // pipeline there throws "libonnxruntime.so.1: cannot open shared
  // object file". Detect once, short-circuit forever.
  return process.env.VERCEL === "1";
}

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (isUnsupportedRuntime()) {
    throw new Error(
      "embedLocal unsupported on this runtime (onnxruntime native binary unavailable)"
    );
  }
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // Dynamic import so module-load failure (missing native bin,
      // missing optional dep) raises an awaitable Promise rejection
      // instead of a synchronous, uncatchable top-level throw.
      const mod = await import("@huggingface/transformers");
      return (await mod.pipeline(
        "feature-extraction",
        MODEL
      )) as unknown as FeatureExtractionPipeline;
    })();
  }
  return pipelinePromise;
}

/**
 * Embed a single text into a normalized 384-dim vector. Cosine
 * similarity over these is equivalent to dot product because the
 * vectors are unit-normalized.
 */
export async function embedLocal(text: string): Promise<number[]> {
  const [vec] = await embedLocalBatch([text]);
  return vec;
}

/**
 * Embed a batch of texts in one pipeline call. Returns one vector per
 * input in matching order. Mean-pooled + L2-normalized.
 */
export async function embedLocalBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getPipeline();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  // Tensor → list of plain number[] vectors. tolist() returns a nested
  // array shaped [batch, dims].
  const nested = output.tolist() as number[][];
  return nested;
}

/** Cosine similarity. Inputs from embedLocal are unit-normalized so this
 * reduces to a dot product, but we keep the full formula for safety
 * against any caller that passes an externally produced vector. */
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
