"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Hash, Paperclip, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useS2DItems } from "@/hooks/use-s2d";
import { PendingAttachmentChip } from "@/components/agent/attachment-chip";
import { ReferenceChipList } from "@/components/agent/reference-chip";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_BUCKET,
  MAX_FILES,
  classifyMime,
  validateFile,
  type AttachmentDescriptor,
  type AttachmentKind,
} from "@/lib/agent/attachments";
import { MAX_REFERENCES, type AgentReference } from "@/lib/agent/references";

/**
 * Composer for the agent thread. Enter sends; Shift+Enter inserts a
 * newline. While a turn is streaming the send button becomes a Stop
 * button (A3).
 *
 * B1 (P3): paste an image, drag/drop files, or use the paperclip to
 * attach images / PDFs / text files. Each file uploads directly to the
 * owner-scoped `agent-attachments` Storage bucket (RLS confines it to the
 * user's own prefix); the resolved descriptors ride along with the
 * message. Send is blocked while any upload is in flight, and allowed with
 * attachments even when the text is empty ("summarize this").
 *
 * B2 (P3): type `@` to open a typeahead over the user's board items. Picking
 * one strips the `@query` text and pins a reference chip; the structured
 * references ride along with the message so the agent treats them as already
 * resolved (skipping the resolve_reference round-trip).
 */

/**
 * Find an in-progress `@`-mention immediately before the caret. Returns the
 * query text (after `@`) and the `@`'s index, or null when the caret isn't
 * inside a mention token (no `@`, whitespace in between, or `@` not at a
 * word boundary).
 */
function findActiveMention(
  value: string,
  caret: number
): { query: string; start: number } | null {
  for (let i = caret - 1; i >= 0; i -= 1) {
    const ch = value[i];
    if (ch === "@") {
      const before = i === 0 ? "" : value[i - 1];
      if (i !== 0 && !/\s/.test(before)) return null;
      const query = value.slice(i + 1, caret);
      if (/\s/.test(query) || query.length > 60) return null;
      return { query, start: i };
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

interface PendingAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  status: "uploading" | "done" | "error";
  error?: string;
  /** Local object URL for an instant image preview before send. */
  previewUrl?: string;
  /** Storage path, set once the upload completes. */
  storagePath?: string;
}

function extFor(name: string, mime: string): string {
  const fromName = name.includes(".") ? name.split(".").pop() : "";
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/csv": "csv",
  };
  return map[mime] ?? "bin";
}

export function AgentComposer({
  disabled,
  onSend,
  onStop,
  mode = "act",
  /** B1: hide the attach affordance where uploads aren't wanted. */
  allowAttachments = true,
  /** B2: enable the `@`-mention typeahead over board items. */
  allowMentions = true,
}: {
  disabled: boolean;
  onSend: (
    text: string,
    attachments?: AttachmentDescriptor[],
    references?: AgentReference[]
  ) => void;
  /** A3 — interrupt the in-flight turn. */
  onStop?: () => void;
  /** Quality Phase 3 — drives placeholder copy. */
  mode?: "plan" | "act";
  allowAttachments?: boolean;
  allowMentions?: boolean;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  // B2: pinned @-mention references + the in-progress typeahead state.
  const [references, setReferences] = useState<AgentReference[]>([]);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(
    null
  );
  const [highlight, setHighlight] = useState(0);
  const { data: items = [] } = useS2DItems();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const userIdRef = useRef<string | null>(null);
  // Object URLs created for image previews, tracked so we can revoke them
  // on unmount. Mutated only in event handlers (uploadOne), never during
  // render, so the React Compiler is happy.
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Revoke any outstanding object URLs when the composer unmounts. We
  // intentionally read objectUrlsRef.current at cleanup time (not a
  // setup-time snapshot, which would be the empty initial array) so every
  // URL created during the component's life is revoked.
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  async function resolveUserId(): Promise<string | null> {
    if (userIdRef.current) return userIdRef.current;
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getUser();
    userIdRef.current = data.user?.id ?? null;
    return userIdRef.current;
  }

  function patch(id: string, next: Partial<PendingAttachment>) {
    setAttachments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...next } : a))
    );
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const hit = prev.find((a) => a.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  // B2: typeahead matches over board items, excluding already-pinned ones.
  // Ranks ticket-number hits first, then title prefix, then substring; an
  // empty query (just `@`) shows the most-recent items (the hook already
  // orders by updated_at desc, and Array.sort is stable).
  const mentionResults = useMemo(() => {
    if (!mention) return [] as typeof items;
    const pinned = new Set(references.map((r) => r.id));
    const q = mention.query.trim().toLowerCase();
    const scored: Array<{ it: (typeof items)[number]; score: number }> = [];
    for (const it of items) {
      if (pinned.has(it.id)) continue;
      if (!q) {
        scored.push({ it, score: 0 });
        continue;
      }
      const title = it.title.toLowerCase();
      const ticket = it.ticket_number != null ? `mash-${it.ticket_number}` : "";
      let score = -1;
      if (ticket && (ticket === q || `${it.ticket_number}` === q)) score = 4;
      else if (ticket && ticket.startsWith(q)) score = 3;
      else if (title.startsWith(q)) score = 2;
      else if (title.includes(q) || (ticket && ticket.includes(q))) score = 1;
      if (score >= 0) scored.push({ it, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 6).map((s) => s.it);
  }, [mention, items, references]);

  function syncMention(value: string, caret: number) {
    if (!allowMentions) return;
    setMention(findActiveMention(value, caret));
    setHighlight(0);
  }

  function selectMention(item: (typeof items)[number]) {
    if (!mention) return;
    const start = mention.start;
    const end = start + 1 + mention.query.length;
    setReferences((prev) => {
      if (prev.some((r) => r.id === item.id) || prev.length >= MAX_REFERENCES) {
        return prev;
      }
      return [
        ...prev,
        {
          kind: "item",
          id: item.id,
          label: item.title,
          ticketNumber: item.ticket_number ?? null,
        },
      ];
    });
    setText((prev) => prev.slice(0, start) + prev.slice(end));
    setMention(null);
    setHighlight(0);
    // Restore focus + place the caret where the mention token was.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(start, start);
      }
    });
  }

  function removeReference(id: string) {
    setReferences((prev) => prev.filter((r) => r.id !== id));
  }

  async function uploadOne(file: File) {
    const kind = classifyMime(file.type);
    const check = validateFile({ mime: file.type, size: file.size, name: file.name });
    const id = crypto.randomUUID();
    if (!check.ok || !kind) {
      setAttachments((prev) => [
        ...prev,
        {
          id,
          name: file.name,
          kind: kind ?? "document",
          mime: file.type,
          size: file.size,
          status: "error",
          error: check.error,
        },
      ]);
      return;
    }

    const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;
    if (previewUrl) objectUrlsRef.current.push(previewUrl);
    setAttachments((prev) => [
      ...prev,
      {
        id,
        name: file.name,
        kind,
        mime: file.type,
        size: file.size,
        status: "uploading",
        previewUrl,
      },
    ]);

    const userId = await resolveUserId();
    if (!userId) {
      patch(id, { status: "error", error: "Not signed in." });
      return;
    }
    const path = `${userId}/${id}.${extFor(file.name, file.type)}`;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      patch(id, { status: "error", error: "Upload failed." });
      return;
    }
    patch(id, { status: "done", storagePath: path });
  }

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    // Soft cap; the route also enforces MAX_FILES. addFiles only runs from
    // event handlers, so `attachments` here is the current render's set.
    const room = MAX_FILES - attachments.length;
    for (const file of list.slice(0, Math.max(room, 0))) {
      void uploadOne(file);
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!allowAttachments) return;
    const files = Array.from(e.clipboardData.files ?? []);
    const images = files.filter((f) => classifyMime(f.type));
    if (images.length > 0) {
      e.preventDefault();
      addFiles(images);
    }
  }

  function onDrop(e: React.DragEvent) {
    if (!allowAttachments) return;
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  const uploading = attachments.some((a) => a.status === "uploading");
  const ready = attachments.filter((a) => a.status === "done" && a.storagePath);

  function submit() {
    const v = text.trim();
    if (disabled || uploading) return;
    if (!v && ready.length === 0) return;
    const descriptors: AttachmentDescriptor[] = ready.map((a) => ({
      kind: a.kind,
      storagePath: a.storagePath!,
      mime: a.mime,
      name: a.name,
      size: a.size,
    }));
    const refs = references;
    setText("");
    // Hand off the uploaded descriptors; drop the chips (don't revoke the
    // object URLs here, the optimistic bubble may still reference them
    // briefly, the browser reclaims them on navigation / unmount).
    setAttachments([]);
    setReferences([]);
    setMention(null);
    onSend(
      v,
      descriptors.length > 0 ? descriptors : undefined,
      refs.length > 0 ? refs : undefined
    );
  }

  const placeholder =
    mode === "plan" ? "Plan with Mashi…" : "Ask, decide, snooze, send…";

  const showStop = disabled && !!onStop;
  const sendDisabled =
    disabled || uploading || (text.trim().length === 0 && ready.length === 0);

  return (
    <div
      className="flex flex-col gap-1.5"
      onDragOver={
        allowAttachments
          ? (e) => {
              e.preventDefault();
              setDragging(true);
            }
          : undefined
      }
      onDragLeave={allowAttachments ? () => setDragging(false) : undefined}
      onDrop={allowAttachments ? onDrop : undefined}
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <PendingAttachmentChip
              key={a.id}
              name={a.name}
              kind={a.kind}
              size={a.size}
              status={a.status}
              error={a.error}
              previewUrl={a.previewUrl}
              onRemove={() => removeAttachment(a.id)}
            />
          ))}
        </div>
      )}
      {references.length > 0 && (
        <ReferenceChipList references={references} onRemove={removeReference} />
      )}
      <Popover
        open={!!mention && mentionResults.length > 0}
        onOpenChange={(v) => {
          if (!v) setMention(null);
        }}
      >
        <PopoverAnchor asChild>
          <div className="flex items-stretch gap-1.5">
            {allowAttachments && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || attachments.length >= MAX_FILES}
              className="mashi-press h-auto px-2 text-muted-foreground"
              title="Attach image, PDF, or text file"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        <Textarea
          ref={ref}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            syncMention(
              e.target.value,
              e.target.selectionStart ?? e.target.value.length
            );
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            // B2: while the mention typeahead is open, the arrow keys,
            // Enter/Tab (select), and Escape (close) drive it instead of
            // the composer. This must run before the Enter-to-send below.
            if (mention && mentionResults.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % mentionResults.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight(
                  (h) => (h - 1 + mentionResults.length) % mentionResults.length
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                selectMention(
                  mentionResults[Math.min(highlight, mentionResults.length - 1)]
                );
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={dragging ? "Drop files to attach…" : placeholder}
          className={`min-h-0 resize-none rounded-md border-border/40 bg-card/80 px-2.5 py-1.5 text-xs leading-snug placeholder:text-muted-foreground/60 ${
            dragging ? "ring-1 ring-primary/50" : ""
          }`}
          disabled={disabled}
        />
        {showStop ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onStop}
            className="mashi-press h-auto gap-1 px-3"
            title="Stop Mashi"
          >
            <Square className="h-3 w-3 fill-current" />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={sendDisabled}
            className="mashi-press h-auto gap-1 px-3"
            title="Enter to send · Shift+Enter for newline"
          >
            <Send className="h-3 w-3" />
          </Button>
        )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={6}
          // Keep focus in the textarea so typing keeps driving the query.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="w-[min(26rem,80vw)] p-1"
        >
          <div className="max-h-56 overflow-y-auto">
            {mentionResults.map((it, i) => (
              <button
                key={it.id}
                type="button"
                // mousedown (not click) + preventDefault avoids blurring the
                // textarea before the selection lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(it);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`mashi-magnetic flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs ${
                  i === highlight ? "bg-secondary/40" : ""
                }`}
              >
                <Hash className="h-3 w-3 shrink-0 text-primary" />
                <span className="shrink-0 font-mono text-[10px] text-primary">
                  {it.ticket_number != null ? `MASH-${it.ticket_number}` : "item"}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground/90">
                  {it.title}
                </span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
