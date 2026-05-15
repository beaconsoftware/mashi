import { cn } from "@/lib/utils";
import { PRIORITY_META, type Priority } from "@/types";

export function PriorityDot({ priority, className }: { priority: Priority; className?: string }) {
  const m = PRIORITY_META[priority];
  return (
    <span
      className={cn("inline-block h-1.5 w-1.5 rounded-full shrink-0", className)}
      style={{ backgroundColor: m.color }}
      aria-label={`${m.label} priority`}
      title={`${m.label} priority`}
    />
  );
}
