import { anthropic, MODELS } from "./client";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sanitizeMessageResponse } from "./sanitize";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic call tracker.
 *
 * Wraps `anthropic.messages.create` and `anthropic.messages.stream` so every
 * AI call lands a row in `ai_usage_log` with model, tokens, computed cost,
 * and the purpose tag. The /settings/usage page aggregates these.
 *
 * Use `trackedCreate(params, "purpose")` instead of `anthropic.messages.create(params)`.
 * Use `trackedStream(params, "purpose")` instead of `anthropic.messages.stream(params)`.
 */

/** USD per million tokens. Snapshot of pricing on the day of the call —
 *  the value gets stamped on the ai_usage_log row, so future price changes
 *  don't rewrite history. */
interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export const PRICING: Record<string, ModelPricing> = {
  // Opus 4.7 / 4.6
  "claude-opus-4-7":           { input: 15, output: 75, cache_read: 1.5,  cache_write: 18.75 },
  "claude-opus-4-6":           { input: 15, output: 75, cache_read: 1.5,  cache_write: 18.75 },
  // Sonnet 4.x
  "claude-sonnet-4-6":         { input: 3,  output: 15, cache_read: 0.3,  cache_write: 3.75 },
  "claude-sonnet-4-5":         { input: 3,  output: 15, cache_read: 0.3,  cache_write: 3.75 },
  // Haiku 4.5
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4, cache_read: 0.08, cache_write: 1 },
};

function priceFor(model: string): ModelPricing {
  return PRICING[model] ?? { input: 0, output: 0, cache_read: 0, cache_write: 0 };
}

function computeCostUsd(model: string, usage: Anthropic.Messages.Usage): number {
  const p = priceFor(model);
  const i = usage.input_tokens ?? 0;
  const o = usage.output_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  return (i * p.input + o * p.output + cr * p.cache_read + cw * p.cache_write) / 1_000_000;
}

async function logUsage(opts: {
  purpose: string;
  model: string;
  usage: Anthropic.Messages.Usage | null;
  request_ms: number;
  user_id?: string | null;
  error?: string;
}) {
  try {
    const supabase = createSupabaseServiceClient();
    const u = opts.usage;
    const row = {
      user_id: opts.user_id ?? null,
      purpose: opts.purpose,
      model: opts.model,
      input_tokens: u?.input_tokens ?? 0,
      output_tokens: u?.output_tokens ?? 0,
      cache_creation_tokens: u?.cache_creation_input_tokens ?? 0,
      cache_read_tokens: u?.cache_read_input_tokens ?? 0,
      cost_usd: u ? computeCostUsd(opts.model, u) : 0,
      request_ms: opts.request_ms,
      error: opts.error ?? null,
    };
    await supabase.from("ai_usage_log").insert(row);
  } catch (err) {
    // Don't let logging failures break the actual call
    console.warn("[ai-usage] log failed:", err);
  }
}

/**
 * Tracked drop-in replacement for `anthropic.messages.create`.
 * `purpose` is a short tag like "triage:gmail" / "copilot" / "chat".
 * `userId` attributes the cost to a user — pass it whenever the caller
 * has a user context (API routes, triage running per-connection).
 * Calls without userId log with NULL (system-level work like cross-user
 * dedup propagation), which is queryable by anyone via the migration-012
 * SELECT policy on ai_usage_log.
 */
export async function trackedCreate(
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  purpose: string,
  userId?: string | null
): Promise<Anthropic.Messages.Message> {
  const t0 = Date.now();
  try {
    const resp = await anthropic.messages.create(params);
    await logUsage({
      purpose,
      model: params.model,
      usage: resp.usage,
      request_ms: Date.now() - t0,
      user_id: userId,
    });
    // Unconditional em/en dash strip on every text content block. This is
    // the non-streaming sibling of the per-delta sanitizer in stream.ts; the
    // ban applies regardless of which entry point Claude is called through.
    return sanitizeMessageResponse(resp);
  } catch (err) {
    await logUsage({
      purpose,
      model: params.model,
      usage: null,
      request_ms: Date.now() - t0,
      user_id: userId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Tracked drop-in replacement for `anthropic.messages.stream`.
 * Returns the same MessageStream the SDK returns; usage gets logged after
 * the stream finishes (we await `finalMessage()` internally for the side
 * effect — the caller's existing async-iteration on the stream still works
 * because final usage is in the last event).
 */
type StreamParams = Parameters<typeof anthropic.messages.stream>[0];

export function trackedStream(
  params: StreamParams,
  purpose: string,
  userId?: string | null
): ReturnType<typeof anthropic.messages.stream> {
  const t0 = Date.now();
  const stream = anthropic.messages.stream(params);

  // Fire-and-forget logging once the final message resolves
  stream
    .finalMessage()
    .then((finalMsg) => {
      void logUsage({
        purpose,
        model: params.model,
        usage: finalMsg.usage ?? null,
        request_ms: Date.now() - t0,
        user_id: userId,
      });
    })
    .catch((err: unknown) => {
      void logUsage({
        purpose,
        model: params.model,
        usage: null,
        request_ms: Date.now() - t0,
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return stream;
}

// Re-export the model identifiers for call sites that want them
export { MODELS };
