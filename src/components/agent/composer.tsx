"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Composer for the persistent agent thread. Enter sends; Shift+Enter
 * inserts a newline. Auto-focuses on mount so the user can start
 * typing immediately. While a turn is streaming the send button becomes
 * a Stop button (A3) so the user can interrupt a turn that's going the
 * wrong way; the textarea stays disabled until the turn settles.
 */
export function AgentComposer({
  disabled,
  onSend,
  onStop,
  mode = "act",
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  /** A3 — interrupt the in-flight turn. When provided, the send button
   * turns into a Stop button while `disabled` (streaming). */
  onStop?: () => void;
  /** Quality Phase 3 — drives placeholder copy so the user knows whether
   * Mashi can act on the message they're about to send. */
  mode?: "plan" | "act";
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function submit() {
    const v = text.trim();
    if (!v || disabled) return;
    setText("");
    onSend(v);
  }

  const placeholder =
    mode === "plan" ? "Plan with Mashi…" : "Ask, decide, snooze, send…";

  // A3: while streaming, the action button stops the turn instead of
  // sending. Falls back to a plain disabled send button when no onStop
  // is wired (older callers).
  const showStop = disabled && !!onStop;

  return (
    <div className="flex items-stretch gap-1.5">
      <Textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder={placeholder}
        className="min-h-0 resize-none rounded-md border-border/40 bg-card/80 px-2.5 py-1.5 text-xs leading-snug placeholder:text-muted-foreground/60"
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
          disabled={disabled || text.trim().length === 0}
          className="mashi-press h-auto gap-1 px-3"
          title="Enter to send · Shift+Enter for newline"
        >
          <Send className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
