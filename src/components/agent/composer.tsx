"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { PendingAttachmentChip } from "@/components/agent/attachment-chip";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_BUCKET,
  MAX_FILES,
  classifyMime,
  validateFile,
  type AttachmentDescriptor,
  type AttachmentKind,
} from "@/lib/agent/attachments";

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
 */

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
}: {
  disabled: boolean;
  onSend: (text: string, attachments?: AttachmentDescriptor[]) => void;
  /** A3 — interrupt the in-flight turn. */
  onStop?: () => void;
  /** Quality Phase 3 — drives placeholder copy. */
  mode?: "plan" | "act";
  allowAttachments?: boolean;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
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
    setText("");
    // Hand off the uploaded descriptors; drop the chips (don't revoke the
    // object URLs here, the optimistic bubble may still reference them
    // briefly, the browser reclaims them on navigation / unmount).
    setAttachments([]);
    onSend(v, descriptors.length > 0 ? descriptors : undefined);
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
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
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
    </div>
  );
}
