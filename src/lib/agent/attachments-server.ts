import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ATTACHMENT_BUCKET,
  MAX_TURN_BYTES,
  isMashiRefBlock,
  type MashiRefBlock,
} from "@/lib/agent/attachments";

/**
 * B1 (P3) — resolve `mashi_ref` placeholder blocks into real Anthropic
 * content blocks, in place, before the model call.
 *
 * Server-only: downloads each referenced object from Storage with the
 * service-role client (which bypasses RLS), so it re-validates ownership
 * by prefix first — a `storagePath` must live under `${userId}/`. Bytes
 * are base64-encoded for images / PDFs, or decoded to text for plain/CSV,
 * and the placeholder's `source` is rewritten. Anything missing, oversized
 * (per-turn cap), or unreadable degrades to a short text block so a stale
 * reference never wedges the turn.
 *
 * Mutates the passed message list in place (it's freshly built per turn in
 * the loop) and returns it for convenience.
 */
export async function resolveAttachmentRefs(
  messages: Anthropic.Messages.MessageParam[],
  opts: { userId: string; supabase: SupabaseClient }
): Promise<Anthropic.Messages.MessageParam[]> {
  let totalBytes = 0;
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    const content = msg.content as unknown[];
    for (let i = 0; i < content.length; i += 1) {
      const block = content[i];
      if (!isMashiRefBlock(block)) continue;
      content[i] = await resolveOne(block, opts, () => {
        // Closure over the running byte total so the per-turn cap spans
        // every attachment across every replayed user message.
        const allow = totalBytes < MAX_TURN_BYTES;
        return { allow, add: (n: number) => (totalBytes += n) };
      });
    }
  }
  return messages;
}

async function resolveOne(
  block: MashiRefBlock,
  opts: { userId: string; supabase: SupabaseClient },
  budget: () => { allow: boolean; add: (n: number) => void }
): Promise<unknown> {
  const { storagePath, mime } = block.source;
  // Ownership: service-role bypasses RLS, so the prefix check is the guard
  // that a forged path can't read another user's file.
  if (!storagePath.startsWith(`${opts.userId}/`)) {
    return textFallback(block, "attachment unavailable");
  }
  const { allow } = budget();
  if (!allow) return textFallback(block, "attachment omitted (turn size limit)");

  const dl = await opts.supabase.storage.from(ATTACHMENT_BUCKET).download(storagePath);
  if (dl.error || !dl.data) {
    return textFallback(block, "attachment unavailable");
  }
  const buf = Buffer.from(await dl.data.arrayBuffer());
  budget().add(buf.length);

  if (block.type === "image") {
    return {
      type: "image",
      source: { type: "base64", media_type: mime, data: buf.toString("base64") },
    };
  }
  // document
  if (mime === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
      ...(block.title ? { title: block.title } : {}),
    };
  }
  // text/plain, text/csv → a text document block.
  return {
    type: "document",
    source: { type: "text", media_type: "text/plain", data: buf.toString("utf-8") },
    ...(block.title ? { title: block.title } : {}),
  };
}

function textFallback(block: MashiRefBlock, reason: string): unknown {
  const label = block.title ? `${block.title}: ${reason}` : reason;
  return { type: "text", text: `[${label}]` };
}
