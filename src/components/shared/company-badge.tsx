import { cn } from "@/lib/utils";
import type { Company } from "@/types";

export function CompanyBadge({
  company,
  className,
}: {
  company?: Company | null;
  className?: string;
}) {
  if (!company) {
    return (
      <span className={cn("text-[10px] uppercase tracking-wide text-muted-foreground", className)}>
        no co.
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11px] text-foreground/80", className)}
    >
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: company.color_hex }}
        aria-hidden
      />
      <span className="truncate">{company.name}</span>
    </span>
  );
}
