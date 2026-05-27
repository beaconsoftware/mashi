"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Composer for the persistent agent thread. Enter sends; Shift+Enter
 * inserts a newline. Auto-focuses on mount so the user can start
 * typing immediately. Disabled while a turn is streaming.
 */
export function AgentComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
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

  return (
    <div className="flex items-start gap-1.5">
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
        placeholder="Ask, decide, snooze, send…"
        className="min-h-0 resize-none rounded-md border-border/40 bg-card/80 px-2.5 py-1.5 text-xs leading-snug placeholder:text-muted-foreground/60"
        disabled={disabled}
      />
      <Button
        type="button"
        size="sm"
        onClick={submit}
        disabled={disabled || text.trim().length === 0}
        className="mashi-press h-8 gap-1 px-2"
        title="Enter to send · Shift+Enter for newline"
      >
        {disabled ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Send className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}
