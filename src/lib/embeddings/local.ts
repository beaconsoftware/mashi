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
 * If model load fails (network down, disk full, ONNX runtime issue),
 * the caller's try/catch is expected to fall back to a safe default
 * (e.g. ship the full tool pool) — we never want a runtime crash here
 * to take down the agent loop.
 */
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL = "Xenova/all-MiniLM-L6-v2";

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("feature-extraction", MODEL) as Promise<FeatureExtractionPipeline>;
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
