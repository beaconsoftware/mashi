"use client";

// translucency-audit-ok: file — sprint card chrome composed of sanctioned /15 + /55 surfaces, see AGENTS.md.

import { useState } from "react";
import {
  Sparkles,
  ChevronDown,
  ChevronRight,
  Wand2,
  Bot,
  Mail,
  CheckSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { S2DItem } from "@/types";
import { SprintContextPackage } from "./sprint-context-package";
import { SprintItemContext } from "./sprint-item-context";

/**
 * Sprint Card v2 — the four-section flow that sits between the timer
 * and the Move row inside an active sprint slot.
 *
 *   1 · CONTEXT          what we know about this item (always open)
 *   2 · ENRICH + PLAN    agentic context + 3-step plan (PR 3)
 *                        + refine thread (PR 4)
 *   3 · ACT              tabbed actions — Claude / Draft / Decide
 *                        (PRs 5-7)
 *   4 · MOVE             Done / Skip / Bench / Snooze / Detail
 *                        (rendered by the parent SlotCard)
 *
 * PR 2 ships the layout shell only — Sections 2 and 3 render
 * collapsed placeholders that wire up to the live agents in later PRs.
 * Section 1 wraps the existing SprintContextPackage + SprintItemContext
 * so the Claude affordances and source list keep working today.
 */

interface Props {
  item: S2DItem;
  /**
   * When the slot is benched / queued, suppress any expensive
   * fetches inside subcomponents.
   */
  active?: boolean;
}

export function SprintCardSections({ item, active = true }: Props) {
  return (
    <div className="space-y-3">
      <Section1Context item={item} active={active} />
      <Section2EnrichPlan item={item} />
      <Section3Act item={item} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section 1 · CONTEXT — what we already know
// ─────────────────────────────────────────────────────────────────────

function Section1Context({ item, active }: { item: S2DItem; active: boolean }) {
  return (
    <SectionShell number={1} title="Context" tagline="what we know">
      <div className="space-y-3">
        <SprintContextPackage item={item} />
        <SprintItemContext item={item} enabled={active} />
      </div>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section 2 · ENRICH + PLAN — placeholder
//   PR 3 wires this to POST /api/s2d/{id}/enrich and renders plan +
//   pulled_sources. PR 4 adds the refine thread.
// ─────────────────────────────────────────────────────────────────────

function Section2EnrichPlan({ item: _item }: { item: S2DItem }) {
  const [open, setOpen] = useState(false);
  return (
    <SectionShell
      number={2}
      title="Enrich + Plan"
      tagline="generate context"
      collapsible
      open={open}
      onToggle={() => setOpen((v) => !v)}
      headerRight={
        <Button
          type="button"
          size="sm"
          disabled
          className="h-6 gap-1 px-2 text-[11px]"
          title="Coming in PR 3"
        >
          <Wand2 className="h-3 w-3" />
          Run Enrich
        </Button>
      }
    >
      {open && (
        <div className="rounded-md border border-dashed border-border/40 bg-secondary/20 p-3 text-[11px] text-muted-foreground">
          Run Enrich to pull related context (other Mashi items, recent
          messages, meetings, Linear, GitHub) and get a 3-step plan
          grounded in those sources. Wires up in the next PR.
        </div>
      )}
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section 3 · ACT — placeholder with tab pills only
//   PR 5 wires the Claude tab; PR 6 the Draft tab; PR 7 the Decide tab.
// ─────────────────────────────────────────────────────────────────────

type ActTab = "claude" | "draft" | "decide";

function Section3Act({ item }: { item: S2DItem }) {
  const [tab, setTab] = useState<ActTab>(defaultTabForPathway(item.pathway));
  return (
    <SectionShell number={3} title="Act" tagline="do the work">
      <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-secondary/30 p-1">
        <TabPill active={tab === "claude"} onClick={() => setTab("claude")} icon={<Bot className="h-3 w-3" />} label="Claude" />
        <TabPill active={tab === "draft"} onClick={() => setTab("draft")} icon={<Mail className="h-3 w-3" />} label="Draft" />
        <TabPill active={tab === "decide"} onClick={() => setTab("decide")} icon={<CheckSquare className="h-3 w-3" />} label="Decide" />
      </div>
      <div className="mt-2 rounded-md border border-dashed border-border/40 bg-secondary/20 p-3 text-[11px] text-muted-foreground">
        {tab === "claude" && "Hand off to Claude Desktop or Code with the enriched context baked in. PR 5."}
        {tab === "draft" && "Live preview of a drafted reply in your style. Copy or send via Gmail / Slack. PR 6."}
        {tab === "decide" && "Record the decision + optionally spin up a follow-up item. PR 7."}
      </div>
    </SectionShell>
  );
}

function defaultTabForPathway(pathway: S2DItem["pathway"]): ActTab {
  if (pathway === "quick_reply" || pathway === "drafted_response") return "draft";
  if (pathway === "decision_gate") return "decide";
  return "claude";
}

// ─────────────────────────────────────────────────────────────────────
// Section primitives
// ─────────────────────────────────────────────────────────────────────

function SectionShell({
  number,
  title,
  tagline,
  collapsible,
  open,
  onToggle,
  headerRight,
  children,
}: {
  number: number;
  title: string;
  tagline?: string;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border/40 bg-card/55">
      <header
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5",
          collapsible && "cursor-pointer select-none"
        )}
        onClick={collapsible ? onToggle : undefined}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? open : undefined}
      >
        <span className="font-mono text-[10px] font-bold text-primary">{number}</span>
        {collapsible && (
          <span className="text-muted-foreground/80">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {title}
        </span>
        {tagline && (
          <span className="text-[10px] text-muted-foreground">· {tagline}</span>
        )}
        {headerRight && (
          <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
            {headerRight}
          </span>
        )}
      </header>
      {(!collapsible || open) && <div className="border-t border-border/30 p-2.5">{children}</div>}
    </section>
  );
}

function TabPill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-auto items-center gap-1 rounded px-2 py-1 text-[11px] font-normal transition-colors",
        active
          ? "bg-primary text-primary-foreground hover:bg-primary/95 hover:text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </Button>
  );
}

// Silence linter when Section 2 isn't using the item yet — wires up in PR 3.
export { Sparkles as _unused };
