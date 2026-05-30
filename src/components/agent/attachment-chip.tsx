"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileText, ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  ATTACHMENT_BUCKET,
  type AttachmentDescriptor,
  type AttachmentKind,
} from "@/lib/agent/attachments";

/**
 * B1 (P3) — attachment chips.
 *
 * Two variants share one presentational base:
 *   - `PendingAttachmentChip` (composer): renders from a local File while
 *     it uploads, with progress / error / remove. Preview comes from a
 *     local object URL so there's no round-trip before send.
 *   - `StoredAttachmentChip` (thread view): renders a persisted descriptor.
 *     Images lazily resolve a signed URL via the owner's browser client
 *     (RLS confines it to their own objects); documents render as a chip
 *     that opens the file on click.
 */

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function KindIcon({ kind }: { kind: AttachmentKind }) {
  return kind === "image" ? (
    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  ) : (
    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  );
}

/** Presentational chip body. Thumbnail (when given) replaces the icon. */
function ChipShell({
  kind,
  name,
  meta,
  thumbnailUrl,
  state,
  onRemove,
  onClick,
}: {
  kind: AttachmentKind;
  name: string;
  meta?: string;
  thumbnailUrl?: string | null;
  state?: "uploading" | "error" | "ready";
  onRemove?: () => void;
  onClick?: () => void;
}) {
  const interactive = !!onClick && state !== "uploading";
  return (
    <div
      className={`group flex max-w-[220px] items-center gap-2 rounded-md border border-border/40 bg-card/80 px-2 py-1.5 text-xs ${
        interactive ? "mashi-press cursor-pointer" : ""
      }`}
      onClick={interactive ? onClick : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {state === "uploading" ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : state === "error" ? (
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
      ) : thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt={name}
          className="h-7 w-7 shrink-0 rounded object-cover"
        />
      ) : (
        <KindIcon kind={kind} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{name}</div>
        {meta && (
          <div className="truncate text-[10px] text-muted-foreground">{meta}</div>
        )}
      </div>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="h-5 w-5 shrink-0 text-muted-foreground/70 hover:text-foreground"
          title="Remove attachment"
          aria-label={`Remove ${name}`}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/** Composer-side chip: drives off local upload state. */
export function PendingAttachmentChip({
  name,
  kind,
  size,
  status,
  error,
  previewUrl,
  onRemove,
}: {
  name: string;
  kind: AttachmentKind;
  size: number;
  status: "uploading" | "done" | "error";
  error?: string;
  previewUrl?: string | null;
  onRemove: () => void;
}) {
  const meta =
    status === "error"
      ? error ?? "Upload failed"
      : status === "uploading"
      ? "Uploading…"
      : humanSize(size);
  return (
    <ChipShell
      kind={kind}
      name={name}
      meta={meta}
      thumbnailUrl={kind === "image" && status !== "error" ? previewUrl : null}
      state={
        status === "uploading"
          ? "uploading"
          : status === "error"
          ? "error"
          : "ready"
      }
      onRemove={onRemove}
    />
  );
}

/** Thread-view chip: resolves a signed URL from the persisted descriptor. */
export function StoredAttachmentChip({
  attachment,
}: {
  attachment: AttachmentDescriptor;
}) {
  const { data: signedUrl } = useQuery({
    queryKey: ["attachment-url", attachment.storagePath],
    queryFn: async () => {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(attachment.storagePath, 60 * 60);
      return data?.signedUrl ?? null;
    },
    staleTime: 50 * 60 * 1000,
    retry: 1,
  });

  return (
    <ChipShell
      kind={attachment.kind}
      name={attachment.name}
      meta={humanSize(attachment.size)}
      thumbnailUrl={attachment.kind === "image" ? signedUrl : null}
      state="ready"
      onClick={
        signedUrl ? () => window.open(signedUrl, "_blank", "noopener") : undefined
      }
    />
  );
}

/** A right-aligned row of stored chips, shown above a user message body. */
export function StoredAttachmentList({
  attachments,
}: {
  attachments: AttachmentDescriptor[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {attachments.map((a) => (
        <StoredAttachmentChip key={a.storagePath} attachment={a} />
      ))}
    </div>
  );
}
