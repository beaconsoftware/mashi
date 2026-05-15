import { cn } from "@/lib/utils";
import { PATHWAY_META, type Pathway } from "@/types";

export function PathwayBadge({
  pathway,
  className,
  compact = true,
}: {
  pathway: Pathway;
  className?: string;
  compact?: boolean;
}) {
  const m = PATHWAY_META[pathway];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        className
      )}
      style={{
        color: `hsl(var(${m.colorVar}))`,
        borderColor: `hsl(var(${m.colorVar}) / 0.35)`,
        backgroundColor: `hsl(var(${m.colorVar}) / 0.08)`,
      }}
    >
      <span aria-hidden className="leading-none">
        {m.icon}
      </span>
      <span>{compact ? m.shortLabel : m.label}</span>
    </span>
  );
}
