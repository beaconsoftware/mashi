"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Message, MessageContent } from "@/components/ai-elements/message";

/**
 * D3 — an editable user turn. Renders the normal user bubble with a
 * hover/focus "Edit" affordance; entering edit mode swaps in a multi-line
 * Textarea with Save / Cancel. Saving re-runs the conversation from this
 * message (the server truncates everything after it). Self-contained so
 * the host thread view stays free of edit state + onClick wiring.
 */
export function EditableUserMessage({
  content,
  disabled,
  onResend,
}: {
  content: string;
  /** True while a turn is streaming — editing is disabled mid-turn. */
  disabled: boolean;
  onResend: (newContent: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  function startEditing() {
    setDraft(content);
    setEditing(true);
  }

  function save() {
    const next = draft.trim();
    setEditing(false);
    if (next.length > 0 && next !== content.trim()) {
      onResend(next);
    }
  }

  if (editing) {
    return (
      <Message from="user">
        <MessageContent>
          <div className="flex flex-col gap-1.5">
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  save();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              rows={2}
              className="min-h-0 resize-none rounded-md border-border/40 bg-card/80 px-2.5 py-1.5 text-sm leading-snug"
            />
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                className="mashi-press h-6 px-2 text-[11px]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={save}
                className="mashi-press h-6 px-2 text-[11px]"
              >
                Save and resend
              </Button>
            </div>
          </div>
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from="user">
      <MessageContent>
        <div className="group/edit flex items-start gap-1.5">
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{content}</p>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={disabled}
            onClick={startEditing}
            aria-label="Edit message"
            title="Edit and resend"
            className="mashi-press h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover/edit:opacity-100 focus-visible:opacity-100"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      </MessageContent>
    </Message>
  );
}
