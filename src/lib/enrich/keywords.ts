/**
 * Shared keyword extraction + PostgREST query helpers for enrichment
 * search. Used by both:
 *   - POST /api/s2d/enrich            (placeholder → draft new item)
 *   - POST /api/s2d/[id]/enrich       (per-item pathway-routed enrich)
 *
 * Centralised so the stopword list, scoring, and OR-clause shape stay
 * in lockstep across both flows.
 */

/**
 * Common English stop-words + a handful of task/meeting glue words
 * that eat ILIKE matches without adding signal.
 */
export const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","so","because","of","for","to","in","on","at","with","by","from",
  "is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","should","can",
  "could","this","that","these","those","it","its","as","not","also","just","about","via","per","into","onto",
  "out","up","down","over","under","more","less","new","old","status","data","quality","check","review","update",
]);

/**
 * Tokenize free text into searchable keywords:
 *   - lowercase, split on non-word chars
 *   - drop stop-words and tokens shorter than 3 chars
 *   - de-dupe
 */
export function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

/**
 * Count how many distinct keywords appear in `haystack`. Useful for
 * scoring "best matches first" when ILIKE returns more candidates than
 * we want to surface.
 */
export function scoreByKeywords(haystack: string, keywords: string[]): number {
  const h = haystack.toLowerCase();
  let n = 0;
  for (const kw of keywords) if (h.includes(kw)) n += 1;
  return n;
}

/**
 * Build a PostgREST `.or(...)` clause from a set of keywords and a list
 * of column names. Each keyword × column pair becomes a separate
 * `col.ilike.%kw%` term, all OR'd together. Empty keyword list returns
 * null so the caller can skip the filter entirely.
 */
export function ilikeOrClause(columns: string[], keywords: string[]): string | null {
  if (keywords.length === 0) return null;
  const parts: string[] = [];
  for (const col of columns) {
    for (const kw of keywords) {
      // Strip PostgREST OR-list delimiters defensively. Tokenizer above
      // already prevents these characters, but a future change to it
      // shouldn't be able to break the query layer.
      const safe = kw.replace(/[,()]/g, "");
      if (safe) parts.push(`${col}.ilike.%${safe}%`);
    }
  }
  return parts.join(",");
}
