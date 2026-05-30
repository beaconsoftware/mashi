/**
 * B1 (P3) — image paste + file upload, shared pure module.
 *
 * No DB / SDK / browser-client imports so it's safe to use on both the
 * client (composer validation) and the server (route intake + replay) and
 * to unit-test in isolation (`__tests__/attachments.test.ts`).
 *
 * Flow overview:
 *   1. Composer uploads each file directly to Supabase Storage (bucket
 *      below, owner-scoped path `${userId}/...`) via the browser client;
 *      RLS confines a user to their own prefix.
 *   2. The composer sends `AttachmentDescriptor[]` (storage path + meta,
 *      never bytes) alongside the message text.
 *   3. The loop persists the descriptors on the user `agent_messages` row
 *      and, on every turn, `messagesToReplay` emits a lightweight
 *      `mashi_ref` placeholder block per attachment.
 *   4. `resolveAttachmentRefs` (server, service-role) downloads the bytes
 *      and swaps each placeholder for a real Anthropic image/document
 *      content block before the model call.
 */

/** Private Storage bucket for agent attachments (created in migration 043). */
export const ATTACHMENT_BUCKET = "agent-attachments";

/** Caps, enforced client-side (fail fast) and server-side (authoritative). */
export const MAX_FILES = 6;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic per-image API ceiling.
export const MAX_DOC_BYTES = 20 * 1024 * 1024;
/** Total decoded attachment bytes resolved into a single turn's context. */
export const MAX_TURN_BYTES = 25 * 1024 * 1024;

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
] as const;

/** `accept` attribute for the hidden file input. */
export const ATTACHMENT_ACCEPT = [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES].join(",");

export type AttachmentKind = "image" | "document";

/**
 * The descriptor that travels client → route → message row. Bytes live in
 * Storage; this is just the pointer + metadata. The same shape is stored
 * verbatim in the `agent_messages.attachments` JSONB column.
 */
export interface AttachmentDescriptor {
  kind: AttachmentKind;
  /** Storage object path, always `${userId}/...` so RLS + the server
   * prefix check confine a user to their own files. */
  storagePath: string;
  mime: string;
  name: string;
  size: number;
}

/** Map a mime type to its attachment kind, or null if unsupported. */
export function classifyMime(mime: string): AttachmentKind | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return "image";
  if ((DOCUMENT_MIME_TYPES as readonly string[]).includes(mime)) return "document";
  return null;
}

/** Per-kind byte ceiling. */
export function maxBytesForKind(kind: AttachmentKind): number {
  return kind === "image" ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
}

export interface FileValidation {
  ok: boolean;
  kind?: AttachmentKind;
  error?: string;
}

/**
 * Validate a single file's mime + size. Used by the composer before
 * upload and by the route before persisting, so a forged descriptor can't
 * smuggle an oversized or wrong-type file past the client checks.
 */
export function validateFile(input: {
  mime: string;
  size: number;
  name?: string;
}): FileValidation {
  const kind = classifyMime(input.mime);
  if (!kind) {
    return { ok: false, error: `Unsupported file type (${input.mime || "unknown"}).` };
  }
  const cap = maxBytesForKind(kind);
  if (input.size > cap) {
    return {
      ok: false,
      kind,
      error: `${input.name ?? "File"} is too large (max ${Math.round(cap / (1024 * 1024))}MB).`,
    };
  }
  return { ok: true, kind };
}

/** Sentinel `source.type` for an unresolved attachment placeholder block. */
export const MASHI_REF_SOURCE = "mashi_ref";

/**
 * A placeholder content block: a well-formed Anthropic image/document
 * block whose `source.type` is the sentinel above. `resolveAttachmentRefs`
 * downloads the bytes and rewrites `source` into a real base64/text block.
 * Keeping the outer `type` correct means the message list is structurally
 * valid even before resolution.
 */
export interface MashiRefBlock {
  type: "image" | "document";
  source: { type: typeof MASHI_REF_SOURCE; storagePath: string; mime: string };
  title?: string;
}

export function attachmentToPlaceholderBlock(a: AttachmentDescriptor): MashiRefBlock {
  const block: MashiRefBlock = {
    type: a.kind === "image" ? "image" : "document",
    source: { type: MASHI_REF_SOURCE, storagePath: a.storagePath, mime: a.mime },
  };
  if (a.kind === "document" && a.name) block.title = a.name;
  return block;
}

export function isMashiRefBlock(block: unknown): block is MashiRefBlock {
  return (
    !!block &&
    typeof block === "object" &&
    (block as { source?: { type?: unknown } }).source?.type === MASHI_REF_SOURCE
  );
}

/**
 * Parse / sanitize a raw attachments array (from a request body or a DB
 * JSONB cell) into validated descriptors. Drops anything malformed or
 * over-cap rather than throwing, so one bad row never wedges a turn.
 * `expectedPrefix` (the user id) is enforced when provided so a forged
 * `storagePath` can't point at another user's object.
 */
export function sanitizeAttachments(
  raw: unknown,
  opts: { expectedPrefix?: string } = {}
): AttachmentDescriptor[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachmentDescriptor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const storagePath = typeof r.storagePath === "string" ? r.storagePath : "";
    const mime = typeof r.mime === "string" ? r.mime : "";
    const name = typeof r.name === "string" ? r.name : "file";
    const size = typeof r.size === "number" && Number.isFinite(r.size) ? r.size : 0;
    if (!storagePath || storagePath.length > 512) continue;
    if (opts.expectedPrefix && !storagePath.startsWith(`${opts.expectedPrefix}/`)) {
      continue;
    }
    const check = validateFile({ mime, size, name });
    if (!check.ok || !check.kind) continue;
    out.push({ kind: check.kind, storagePath, mime, name: name.slice(0, 256), size });
    if (out.length >= MAX_FILES) break;
  }
  return out;
}
