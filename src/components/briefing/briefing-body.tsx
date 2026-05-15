"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ArrowRight, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useS2DItems, useCompanies } from "@/hooks/use-s2d";
import { SourceIcon } from "@/components/shared/source-icon";
import { CompanyBadge } from "@/components/shared/company-badge";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import type { S2DItem } from "@/types";

export function BriefingBody() {
  const { data: items = [], isLoading } = useS2DItems();
  const { data: companies = [] } = useCompanies();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const urgent = items.filter((i) => i.priority === "urgent" && i.status !== "done");
  const todo = items.filter((i) => i.status === "todo");
  const inQueue = items.filter((i) => i.status === "in_queue");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <Hero />

      <Section title="What's urgent" icon={<AlertTriangle className="h-3.5 w-3.5 text-destructive" />}>
        <ul className="divide-y divide-border/40">
          {urgent.map((it) => (
            <BriefingRow key={it.id} item={it} />
          ))}
          {urgent.length === 0 && (
            <li className="py-3 px-3 text-sm text-muted-foreground">Nothing urgent. Enjoy it.</li>
          )}
        </ul>
      </Section>

      <Section title="On deck (To Do)" icon={<ArrowRight className="h-3.5 w-3.5 text-primary" />}>
        <ul className="divide-y divide-border/40">
          {todo.slice(0, 6).map((it) => (
            <BriefingRow key={it.id} item={it} />
          ))}
        </ul>
      </Section>

      <Section title="Waiting on others" icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}>
        <ul className="divide-y divide-border/40">
          {inQueue.map((it) => (
            <BriefingRow key={it.id} item={it} showQueue />
          ))}
        </ul>
      </Section>

      <Section title="Portfolio at a glance" icon={<CheckCircle2 className="h-3.5 w-3.5 text-primary" />}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 p-3">
          {companies.map((c) => {
            const open = items.filter((i) => i.company_id === c.id && i.status !== "done").length;
            return (
              <div
                key={c.id}
                className="rounded-md border border-border/40 bg-card px-3 py-2"
              >
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color_hex }} />
                  <span className="font-medium">{c.name}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-mono text-lg">{open}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">open</span>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="pb-12 text-[11px] text-muted-foreground">
        Mashi briefing · generated 7:30 · sources: Gmail, Slack, Linear, Fireflies, Calendar.
      </div>
    </div>
  );
}

function Hero() {
  return (
    <Card className="border-l-2 border-l-primary">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          Morning briefing
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          Good morning. The board narrative is your hardest move today.
        </h2>
        <p className="text-sm text-muted-foreground">
          You have 2 urgent items, 4 on deck, and one decision sitting in queue.
          The Perigon board prep is in progress — clear blockers there before
          touching anything else. AWS spike for Ledgerline is a 5-minute confirm —
          take it first.
        </p>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="rounded-md border border-border/40 bg-card">{children}</div>
    </section>
  );
}

function BriefingRow({ item, showQueue }: { item: S2DItem; showQueue?: boolean }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <PriorityDot priority={item.priority} />
      {item.source_type && <SourceIcon type={item.source_type} />}
      <Link href="/s2d" className="min-w-0 flex-1 truncate hover:text-foreground">
        {item.title}
      </Link>
      <PathwayBadge pathway={item.pathway} />
      <div className="hidden sm:block">
        <CompanyBadge company={item.company} />
      </div>
      {showQueue && item.queue_reason && (
        <span className="hidden md:inline truncate max-w-48 text-[11px] text-muted-foreground">
          {item.queue_reason}
        </span>
      )}
      {item.est_minutes != null && (
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {item.est_minutes}m
        </span>
      )}
    </li>
  );
}
