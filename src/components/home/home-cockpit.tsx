"use client";

import { useMemo, useState } from "react";
import { useS2DItems, useCompanies } from "@/hooks/use-s2d";
import { useCalendarEvents } from "@/hooks/use-calendar";
import { useMagneticHover } from "@/lib/animation/interactions";
import type { S2DItem } from "@/types";
import {
  NowCard,
  AiCommandTile,
  SprintLauncherTile,
  ReviewQueueTile,
  UpdatesTile,
  CalendarStripTile,
  QuickKnockTile,
  WaitingTile,
  PortfolioTile,
} from "@/components/home/home-tiles";

/**
 * Home is no longer a briefing — it's a cockpit. Three rows of three tiles,
 * each tile interactive. A single companyFilter piece of state cross-wires
 * everything: click a portfolio card and every other tile narrows to that
 * company. Click again to clear.
 *
 * The grid collapses to 1-col on small screens; on lg+ it's a real 12-col
 * grid sized so the entire fold (above ~750px) is visible without scroll
 * on a 13" laptop — the explicit goal Sidd set when redesigning this page.
 */
export function HomeCockpit() {
  const { data: rawItems = [], isLoading } = useS2DItems();
  const { data: companies = [] } = useCompanies();
  const { data: calendar = [] } = useCalendarEvents();

  const [companyFilter, setCompanyFilter] = useState<string | null>(null);

  const items = useMemo<S2DItem[]>(
    () =>
      companyFilter ? rawItems.filter((i) => i.company_id === companyFilter) : rawItems,
    [rawItems, companyFilter]
  );

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      {companyFilter && (
        <FilterChip
          label={
            companies.find((c) => c.id === companyFilter)?.name ?? "Unknown"
          }
          onClear={() => setCompanyFilter(null)}
        />
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 auto-rows-[220px] lg:grid-cols-12 lg:auto-rows-auto lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {/* Row 1 — orchestration surface */}
        <Tile className="lg:col-span-5">
          <NowCard items={items} loading={isLoading} />
        </Tile>
        <Tile className="lg:col-span-4">
          <AiCommandTile />
        </Tile>
        <Tile className="lg:col-span-3">
          <SprintLauncherTile items={items} />
        </Tile>

        {/* Row 2 — what needs you */}
        <Tile className="lg:col-span-3">
          <ReviewQueueTile items={rawItems} />
        </Tile>
        <Tile className="lg:col-span-4">
          <UpdatesTile items={items} />
        </Tile>
        <Tile className="lg:col-span-5">
          <CalendarStripTile events={calendar} items={items} />
        </Tile>

        {/* Row 3 — situational awareness */}
        <Tile className="lg:col-span-5">
          <QuickKnockTile items={items} />
        </Tile>
        <Tile className="lg:col-span-4">
          <WaitingTile items={items} />
        </Tile>
        <Tile className="lg:col-span-3">
          <PortfolioTile
            companies={companies}
            items={rawItems}
            active={companyFilter}
            onToggle={(id) =>
              setCompanyFilter((cur) => (cur === id ? null : id))
            }
          />
        </Tile>
      </div>
    </div>
  );
}

function Tile({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { ref: tileRef, onEnter, onLeave } = useMagneticHover<HTMLElement>({
    intensity: "strong",
  });
  return (
    <section
      ref={tileRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={
        "relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/40 bg-card transition-colors hover:border-primary/30 " +
        (className ?? "")
      }
    >
      {children}
    </section>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[11px]">
      <span className="text-muted-foreground">Filtering to</span>
      <button
        onClick={onClear}
        className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-foreground hover:bg-primary/20"
      >
        {label}
        <span className="text-muted-foreground">·</span>
        <span>×</span>
      </button>
    </div>
  );
}
