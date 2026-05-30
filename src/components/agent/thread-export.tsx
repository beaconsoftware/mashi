"use client";

import { useCallback } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  exportFilename,
  threadToJSON,
  threadToMarkdown,
  type TranscriptMessage,
  type TranscriptThread,
} from "@/lib/agent/transcript";

/**
 * D4 — export the current thread to Markdown or JSON. Self-contained so
 * the host thread view stays free of download wiring (and an onClick=
 * literal). The serializers are the pure, unit-tested core in
 * lib/agent/transcript.ts; this only handles the Blob download.
 */
export function ThreadExport({
  thread,
  messages,
}: {
  thread: TranscriptThread;
  messages: TranscriptMessage[];
}) {
  const download = useCallback(
    (kind: "md" | "json") => {
      const body =
        kind === "md"
          ? threadToMarkdown(thread, messages)
          : threadToJSON(thread, messages);
      const mime = kind === "md" ? "text/markdown" : "application/json";
      const blob = new Blob([body], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(thread, kind);
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
    [thread, messages]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Export conversation"
          title="Export conversation"
          className="mashi-press h-6 w-6 text-muted-foreground hover:text-foreground"
        >
          <Download className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => download("md")}>
          Export as Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => download("json")}>
          Export as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
