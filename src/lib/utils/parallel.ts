/**
 * Run `fn` over `items` with at most `concurrency` calls in flight at once.
 *
 * Used to fan out triage calls per source. Sonnet calls are ~3-5s each, so
 * processing 200 units sequentially takes ~15min — concurrency of 8 brings
 * that to ~2min while staying well under Anthropic's tier-1 rate limits.
 *
 * Order of results matches order of items even though workers race.
 */
export async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Math.min(concurrency, items.length);
  const workers = Array.from({ length: lanes }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        // Re-throw to surface upstream; caller can wrap if it wants soft failures.
        throw err;
      }
    }
  });
  await Promise.all(workers);
  return results;
}
