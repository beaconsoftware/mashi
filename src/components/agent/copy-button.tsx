"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * C3 — a small, reusable copy-to-clipboard control for the agent thread
 * (assistant answers, drafted bodies, tool-result raw). Built on the shadcn
 * Button (press feedback baked in) plus an explicit `.mashi-press` so the
 * file satisfies the liveness invariant / audit:motion. Shows a transient
 * check on success.
 *
 * Files that merely render <CopyButton /> stay free of an `onClick=` literal,
 * so the copy affordance can be dropped anywhere without tripping the motion
 * audit on the host file.
 */
export function CopyButton({
  text,
  label = "Copy",
  className,
  size = "icon",
}: {
  /** Resolved lazily so callers can pass a serializer without paying it on
   * every render. */
  text: string | (() => string);
  label?: string;
  className?: string;
  size?: "icon" | "sm";
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const onCopy = useCallback(async () => {
    const value = typeof text === "function" ? text() : text;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can reject (permissions, insecure context). Silent — a
      // failed copy shouldn't throw a toast in the middle of a thread.
    }
  }, [text]);

  const isIcon = size === "icon";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={isIcon ? "icon" : "sm"}
            onClick={onCopy}
            aria-label={label}
            className={cn(
              "mashi-press text-muted-foreground hover:text-foreground",
              isIcon ? "h-6 w-6" : "h-6 gap-1 px-2 text-[11px]",
              className
            )}
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {!isIcon && <span>{copied ? "Copied" : label}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
