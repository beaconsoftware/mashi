"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  BanIcon,
  Brain,
  Building2,
  Calendar,
  CalendarDays,
  CheckCircleIcon,
  ChevronDownIcon,
  CircleDot,
  CircleIcon,
  CircleQuestionMark,
  ClipboardCheck,
  ClockIcon,
  Eye,
  FileText,
  Gavel,
  GitBranch,
  Kanban,
  Link2,
  ListChecks,
  type LucideIcon,
  Mail,
  MessageSquare,
  PenLine,
  RefreshCw,
  Rocket,
  Search,
  SmilePlus,
  Target,
  Ticket,
  User,
  Video,
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
import { toolMeta, type ToolIconKey } from "@/lib/agent/tool-meta";

// Mashi note: hand-copied from vercel/ai-elements/tool.tsx. Adapted to:
//   - drop the shiki-based CodeBlock dependency (heavy; agent rarely
//     emits code). Tool input/output renders inside a plain <pre>.
//   - simplify the state union to match what Mashi's agent loop emits.
//   - C2/C3: known tool results render as a readable summary with a
//     "view raw" disclosure, and raw output gets a copy button. Wrapping
//     uses break-words (not break-all, which mangled JSON).
//   - I9: per-tool iconography + a human label + a collapsed-state outcome
//     line + an animated running/completed/error state machine + a sequence
//     rail when a turn fires several tools. The shape-knowledge (icon, label,
//     outcome) lives in the pure `tool-meta` module; this file maps the icon
//     key to a lucide glyph and renders the motion.

export type ToolPartState =
  | "approval-requested"
  | "approval-responded"
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-denied"
  | "output-cancelled"
  | "output-error";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  // I1: the most-repeated element in a turn. It lifts on hover like every
  // other clickable row (.mashi-magnetic), animates in as it streams
  // (.mashi-enter), and its content expand/collapse + chevron rotation are
  // driven by Radix data-state below. Reduced-motion short-circuits both.
  // I7: the card samples the ambient via the sanctioned /80 step so it reads
  // as the same glass material as the rest of the app instead of a flat fill.
  <Collapsible
    className={cn(
      "mashi-magnetic mashi-enter group not-prose w-full overflow-hidden rounded-md border bg-card/80",
      className
    )}
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
  "output-cancelled": "Cancelled",
  "output-error": "Error",
};

const statusIcons: Record<ToolPartState, ReactNode> = {
  "approval-requested": <ClockIcon className="size-3 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-3 text-blue-600" />,
  "input-available": <ClockIcon className="size-3 animate-pulse motion-reduce:animate-none" />,
  "input-streaming": <CircleIcon className="size-3" />,
  // Completed check settles in once (scale-up) when the call lands. Keyed by
  // state at the call site so it remounts on the running → completed flip.
  "output-available": (
    <CheckCircleIcon className="mashi-settle size-3 text-emerald-500" />
  ),
  "output-denied": <XCircleIcon className="size-3 text-orange-600" />,
  "output-cancelled": <BanIcon className="size-3 text-muted-foreground" />,
  "output-error": <XCircleIcon className="size-3 text-destructive" />,
};

export const getStatusBadge = (status: ToolPartState) => (
  <Badge
    className="shrink-0 gap-1 rounded-full px-1.5 py-0 text-[10px] font-normal normal-case tracking-normal"
    variant="default"
  >
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

/** While the call is in flight the card shows an indeterminate bar and a
 * pulsing domain icon (the I9 "Running" state). */
function isRunningState(state: ToolPartState): boolean {
  return (
    state === "input-available" ||
    state === "input-streaming" ||
    state === "approval-requested"
  );
}

/** Per-status accent for the sequence-rail node dot (exported so the rail in
 * thread-view colours each step without re-deriving the state→tone map). */
export function statusDotClass(state: ToolPartState): string {
  switch (state) {
    case "output-available":
      return "bg-emerald-500";
    case "output-error":
      return "bg-destructive";
    case "output-denied":
      return "bg-orange-600";
    case "output-cancelled":
      return "bg-muted-foreground";
    case "approval-requested":
      return "bg-yellow-600";
    default:
      return "bg-primary animate-pulse motion-reduce:animate-none";
  }
}

const TOOL_ICONS: Record<ToolIconKey, LucideIcon> = {
  search: Search,
  board: Kanban,
  item: Ticket,
  person: User,
  whoami: User,
  company: Building2,
  style: PenLine,
  message: MessageSquare,
  meeting: Video,
  calendar: Calendar,
  today: CalendarDays,
  linear: CircleDot,
  sync: RefreshCw,
  context: Eye,
  sprint: Rocket,
  review: ClipboardCheck,
  summary: FileText,
  chain: GitBranch,
  reference: Link2,
  question: CircleQuestionMark,
  decision: Gavel,
  watch: Target,
  plan: ListChecks,
  mail: Mail,
  emoji: SmilePlus,
  memory: Brain,
  generic: WrenchIcon,
};

/** The leading domain icon: which tool ran, at a glance. Pulses while the
 * call is in flight; tints destructive on error so the row reads as failed
 * even before the badge is parsed. Reduced-motion drops the pulse. */
function ToolDomainIcon({
  iconKey,
  state,
}: {
  iconKey: ToolIconKey;
  state: ToolPartState;
}) {
  const Icon = TOOL_ICONS[iconKey] ?? WrenchIcon;
  const running = isRunningState(state);
  return (
    <Icon
      className={cn(
        "size-3.5 shrink-0",
        state === "output-error"
          ? "text-destructive"
          : running
            ? "text-primary animate-pulse motion-reduce:animate-none"
            : "text-muted-foreground"
      )}
    />
  );
}

export type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  toolName: string;
  state: ToolPartState;
  /** I9: a one-line "what happened" for the collapsed card (e.g. "12 board
   * items", "MASH-1130 · Title"). Derived by the caller via `toolOutcome`. */
  outcome?: string | null;
};

export const ToolHeader = ({
  className,
  toolName,
  state,
  outcome,
  ...props
}: ToolHeaderProps) => {
  const meta = toolMeta(toolName);
  const running = isRunningState(state);
  return (
    <CollapsibleTrigger
      className={cn(
        "relative flex w-full items-center justify-between gap-2 overflow-hidden px-2.5 py-2 text-xs",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ToolDomainIcon iconKey={meta.icon} state={state} />
        <div className="flex min-w-0 flex-col gap-0.5 text-left">
          <span className="truncate text-[11px] font-medium text-foreground">
            {meta.label}
          </span>
          {outcome && (
            <span className="truncate text-[10px] text-muted-foreground">
              {outcome}
            </span>
          )}
        </div>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      {/* I9: indeterminate progress bar while the call is in flight. */}
      {running && (
        <span
          aria-hidden="true"
          className="mashi-indeterminate absolute inset-x-0 bottom-0 h-px"
        />
      )}
    </CollapsibleTrigger>
  );
};

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

/** I9: the raw snake_case tool name, demoted to mono secondary and shown only
 * on expand (the human label leads the collapsed card). */
export const ToolRawName = ({ toolName }: { toolName: string }) => (
  <p className="font-mono text-[10px] text-muted-foreground/80">{toolName}</p>
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

/**
 * I9 sequence rail. When a turn fires several tools, wrap their cards in this
 * so they read as one connected sequence (a left timeline rail + a per-step
 * status dot) rather than loose boxes. A single tool renders without the rail.
 */
export const ToolSequence = ({
  className,
  children,
  ...props
}: ComponentProps<"div">) => (
  <div
    className={cn(
      "relative space-y-1.5 pl-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border/60",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

/** One step in a `ToolSequence`: positions a status-coloured node dot on the
 * rail beside its card. */
export const ToolSequenceItem = ({
  state,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { state: ToolPartState }) => (
  <div className={cn("relative", className)} {...props}>
    <span
      aria-hidden="true"
      className={cn(
        "absolute -left-[14px] top-[13px] size-1.5 rounded-full ring-2 ring-card/80",
        statusDotClass(state)
      )}
    />
    {children}
  </div>
);
