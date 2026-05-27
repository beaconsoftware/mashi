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

// Mashi note: hand-copied from vercel/ai-elements/tool.tsx. Adapted to:
//   - drop the shiki-based CodeBlock dependency (heavy; agent rarely
//     emits code). Tool input/output renders inside a plain <pre>.
//   - simplify the state union to match what Mashi's agent loop emits.

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
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[10px] text-foreground/80">
      {JSON.stringify(input ?? null, null, 2)}
    </pre>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: unknown;
  errorText?: string | null;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) return null;

  const renderOutput = (): ReactNode => {
    if (errorText) return <span>{errorText}</span>;
    if (isValidElement(output)) return output;
    if (typeof output === "string") return output;
    return JSON.stringify(output ?? null, null, 2);
  };

  return (
    <div className={cn("space-y-1", className)} {...props}>
      <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {errorText ? "Error" : "Result"}
      </h4>
      <pre
        className={cn(
          "max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md px-2 py-1.5 font-mono text-[10px]",
          errorText
            ? "bg-destructive/15 text-destructive"
            : "bg-muted/60 text-foreground/80"
        )}
      >
        {renderOutput()}
      </pre>
    </div>
  );
};
