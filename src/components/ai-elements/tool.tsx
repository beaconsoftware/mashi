"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { CopyButton } from "@/components/agent/copy-button";
import {
  summarizeToolResult,
  type ToolSummary,
} from "@/lib/agent/provenance";

// Mashi note: hand-copied from vercel/ai-elements/tool.tsx. Adapted to:
//   - drop the shiki-based CodeBlock dependency (heavy; agent rarely
//     emits code). Tool input/output renders inside a plain <pre>.
//   - simplify the state union to match what Mashi's agent loop emits.
//   - C2/C3: known tool results render as a readable summary with a
//     "view raw" disclosure, and raw output gets a copy button. Wrapping
//     uses break-words (not break-all, which mangled JSON).

export type ToolPartState =
  | "approval-requested"
  | "approval-responded"
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-denied"
  | "output-error";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose w-full rounded-md border", className)}
    {...props}
  />
);

const statusLabels: Record<ToolPartState, string> = {
  "approval-requested": "Awaiting approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPartState, ReactNode> = {
  "approval-requested": <ClockIcon className="size-3 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-3 text-blue-600" />,
  "input-available": <ClockIcon className="size-3 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-3" />,
  "output-available": <CheckCircleIcon className="size-3 text-emerald-500" />,
  "output-denied": <XCircleIcon className="size-3 text-orange-600" />,
  "output-error": <XCircleIcon className="size-3 text-destructive" />,
};

export const getStatusBadge = (status: ToolPartState) => (
  <Badge
    className="gap-1 rounded-full px-1.5 py-0 text-[10px] font-normal normal-case tracking-normal"
    variant="default"
  >
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  title?: string;
  toolName: string;
  state: ToolPartState;
};

export const ToolHeader = ({
  className,
  title,
  toolName,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-xs",
      className
    )}
    {...props}
  >
    <div className="flex min-w-0 items-center gap-1.5">
      <WrenchIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-[11px] text-foreground">
        {title ?? toolName}
      </span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-2 px-2.5 pb-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: unknown;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-1", className)} {...props}>
    <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      Parameters
    </h4>
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[10px] text-foreground/80">
      {JSON.stringify(input ?? null, null, 2)}
    </pre>
  </div>
);

/** C2: a compact, readable rendering of a known tool result. */
const ToolSummaryView = ({ summary }: { summary: ToolSummary }) => (
  <div className="space-y-1">
    <p className="text-[11px] font-medium text-foreground">{summary.headline}</p>
    {summary.rows.length > 0 && (
      <ul className="space-y-0.5">
        {summary.rows.map((row, i) => (
          <li
            key={`${row.title}-${i}`}
            className="flex min-w-0 items-baseline gap-1.5 text-[11px]"
          >
            <span className="truncate text-foreground/90">{row.title}</span>
            {row.meta && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {row.meta}
              </span>
            )}
          </li>
        ))}
      </ul>
    )}
  </div>
);

/** The (wrap-fixed, copyable) raw JSON / text fallback. */
const RawOutput = ({
  text,
  tone,
}: {
  text: string;
  tone: "error" | "default";
}) => (
  <div className="relative">
    <div className="absolute right-1 top-1 z-10">
      <CopyButton text={text} label="Copy result" />
    </div>
    <pre
      className={cn(
        "max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md px-2 py-1.5 pr-8 font-mono text-[10px]",
        tone === "error"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted/60 text-foreground/80"
      )}
    >
      {text}
    </pre>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: unknown;
  errorText?: string | null;
  /** When provided, a known result shape renders as a readable summary with
   * raw JSON one click away (C2). */
  toolName?: string;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  toolName,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) return null;

  // Caller-supplied React node passes through untouched.
  if (!errorText && isValidElement(output)) {
    return (
      <div className={cn("space-y-1", className)} {...props}>
        <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Result
        </h4>
        {output}
      </div>
    );
  }

  const rawText = errorText
    ? errorText
    : typeof output === "string"
      ? output
      : JSON.stringify(output ?? null, null, 2);

  const summary =
    !errorText && toolName ? summarizeToolResult(toolName, output) : null;

  return (
    <div className={cn("space-y-1", className)} {...props}>
      <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {errorText ? "Error" : "Result"}
      </h4>
      {summary ? (
        <div className="space-y-1.5">
          <ToolSummaryView summary={summary} />
          <Collapsible className="group/raw">
            <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
              <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]/raw:rotate-180" />
              View raw
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1">
              <RawOutput text={rawText} tone="default" />
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : (
        <RawOutput text={rawText} tone={errorText ? "error" : "default"} />
      )}
    </div>
  );
};
