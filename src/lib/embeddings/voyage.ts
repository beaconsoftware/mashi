/**
 * Tiny Voyage AI embeddings client.
 *
 * Used by the activity matcher's title-similarity tier (matcher v2) when
 * `VOYAGE_API_KEY` is set. When it isn't, the matcher falls back to
 * Jaccard token overlap and this module is never called.
 *
 * No SDK install — Voyage exposes a simple REST endpoint and we keep the
 * surface small. If usage grows beyond this one call site, lift to a
 * full client.
 *
 * Caching: in-process LRU keyed by SHA1(text). Capped at 500 entries.
 * Voyage charges per million tokens; embedding the same title repeatedly
 * during a noisy heartbeat burst would be wasteful. The cache survives
 * the lifetime of the serverless function instance, which on Vercel is
 * typically minutes — enough to absorb a burst, not enough to drift.
 */
import { createHash } from "node:crypto";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-lite";
const CACHE_MAX = 500;

// Simple LRU: a Map preserves insertion order, so re-inserting on hit
// keeps recently-used entries at the back. When we exceed CACHE_MAX we
// drop the oldest (the first key).
const cache = new Map<string, number[]>();

function cacheKey(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function cacheGet(text: string): number[] | undefined {
  const key = cacheKey(text);
  const hit = cache.get(key);
  if (!hit) return undefined;
  // Refresh recency
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(text: string, vector: number[]): void {
  const key = cacheKey(text);
  if (cache.has(key)) cache.delete(key);
  cache.set(key, vector);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * Embed a batch of texts. Returns one vector per input, in the same
 * order. Throws on API error so callers can fall back to Jaccard.
 *
 * Inputs that hit the cache are not sent to the API; only the misses
 * are batched. The returned array still maps 1:1 with `texts`.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY not set");
  }

  // Separate cached vs to-fetch, preserving the input order so we can
  // reassemble at the end.
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const missIndexes: number[] = [];
  const missTexts: string[] = [];

  texts.forEach((text, i) => {
    const hit = cacheGet(text);
    if (hit) {
      results[i] = hit;
    } else {
      missIndexes.push(i);
      missTexts.push(text);
    }
  });

  if (missTexts.length > 0) {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: missTexts,
        input_type: "document",
      }),
    });
    if (!res.ok) {
      throw new Error(`Voyage API ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as VoyageResponse;
    // Voyage returns `data` sorted by `index` matching input order, but
    // we don't trust that — sort defensively.
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    sorted.forEach((entry, j) => {
      const text = missTexts[j];
      const vec = entry.embedding;
      cacheSet(text, vec);
      results[missIndexes[j]] = vec;
    });
  }

  // All slots should be filled at this point.
  return results.map((v, i) => {
    if (!v) throw new Error(`Voyage embed: missing vector at index ${i}`);
    return v;
  });
}

/**
 * Standard cosine similarity. Returns 0 for zero-length inputs rather
 * than NaN — defensive against pathological vectors.
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
