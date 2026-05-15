"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useS2DItems, useCompanies } from "@/hooks/use-s2d";

export function CompaniesGrid() {
  const { data: companies = [], isLoading: companiesLoading } = useCompanies();
  const { data: items = [], isLoading: itemsLoading } = useS2DItems();

  if (companiesLoading || itemsLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {companies.map((c) => {
        const companyItems = items.filter((i) => i.company_id === c.id);
        const open = companyItems.filter((i) => i.status !== "done").length;
        const urgent = companyItems.filter(
          (i) => i.priority === "urgent" && i.status !== "done"
        ).length;
        return (
          <Link
            key={c.id}
            href="/s2d"
            className="group rounded-md border border-border/40 bg-card p-4 transition-colors hover:border-border hover:bg-accent/30"
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color_hex }} />
              <h3 className="text-sm font-medium">{c.name}</h3>
              <span className="ml-auto rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {c.status}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-4">
              <div>
                <div className="font-mono text-2xl">{open}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">open</div>
              </div>
              <div>
                <div className="font-mono text-2xl text-destructive/90">{urgent}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">urgent</div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
