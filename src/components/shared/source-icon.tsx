import { Mail, MessageSquare, GitBranch, Mic, FileText, Calendar, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceType } from "@/types";

const META: Record<SourceType, { icon: typeof Mail; label: string; color: string }> = {
  gmail: { icon: Mail, label: "Gmail", color: "text-rose-400" },
  slack: { icon: MessageSquare, label: "Slack", color: "text-violet-400" },
  linear: { icon: GitBranch, label: "Linear", color: "text-indigo-300" },
  fireflies: { icon: Mic, label: "Fireflies", color: "text-orange-400" },
  granola: { icon: FileText, label: "Granola", color: "text-emerald-400" },
  calendar: { icon: Calendar, label: "Calendar", color: "text-sky-400" },
  manual: { icon: Pencil, label: "Manual", color: "text-muted-foreground" },
};

export function SourceIcon({
  type,
  className,
  withLabel = false,
}: {
  type: SourceType;
  className?: string;
  withLabel?: boolean;
}) {
  const m = META[type];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label={m.label}>
      <Icon className={cn("h-3 w-3 shrink-0", m.color)} />
      {withLabel && <span className="text-[10px] text-muted-foreground">{m.label}</span>}
    </span>
  );
}
