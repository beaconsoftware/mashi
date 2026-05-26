import { MODELS } from "./client";
import { trackedStream } from "./tracked";
import { sanitizeForAITells } from "./sanitize";

export { sanitizeForAITells };

type ModelKey = keyof typeof MODELS;

interface StreamOpts {
  model?: ModelKey;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  /** Usage tag for /settings/usage. Defaults to "stream:unknown". */
  purpose?: string;
  /** Attribute cost to a specific user in ai_usage_log. */
  userId?: string | null;
}

/**
 * Stream a Claude response as a plain UTF-8 text body, with a runtime
 * sanitizer that strips em/en dashes (the single most reliable AI tell).
 * Belt-and-suspenders against the model regressing on the system prompt.
 *
 * Substitution rules applied per delta:
 *   " — " (space-em-space) → ", "
 *   "—"   (anywhere else)  → ", "
 *   " – " (en-dash variant) → ", "
 *   "–"                    → ", "
 *   " -- " (ASCII em-dash) → ", "
 *
 * We don't strip dashes inside hyphenated words (e.g. "go-to-market") because
 * those use ASCII hyphen-minus, which is unaffected. Number ranges using
 * en-dashes ("5–10") are rare in chat/draft output; collateral damage is
 * acceptable and the prompt-level guidance discourages the model from
 * producing them in the first place.
 */
export async function streamClaudeText(opts: StreamOpts): Promise<ReadableStream<Uint8Array>> {
  const stream = trackedStream(
    {
      model: MODELS[opts.model ?? "primary"],
      system: opts.system,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 1024,
    },
    opts.purpose ?? "stream:unknown",
    opts.userId
  );

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const sanitized = sanitizeForAITells(event.delta.text);
            if (sanitized.length > 0) {
              controller.enqueue(encoder.encode(sanitized));
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "stream error";
        controller.enqueue(encoder.encode(`\n\n[error: ${msg}]`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.controller.abort();
    },
  });
}

// Per-delta sanitizer lives in ./sanitize and is re-exported above so
// existing callers continue to import `sanitizeForAITells` from this file.
