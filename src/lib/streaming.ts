/**
 * Stream a POST response body as plain text, calling `onDelta` with each chunk
 * and resolving with the full text. Supports abort via AbortSignal.
 */
export async function streamPostText(
  url: string,
  body: unknown,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onDelta(chunk);
  }
  // Flush remaining bytes
  const tail = decoder.decode();
  if (tail) {
    full += tail;
    onDelta(tail);
  }
  return full;
}
