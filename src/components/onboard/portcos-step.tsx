"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGSAP } from "@gsap/react";
import { Plus, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { gsap, withMotion } from "@/lib/animation";

interface CompanyRow {
  id: string;
  name: string;
  color_hex: string;
}

// Auto-cycle colors so users don't have to pick — they can edit later.
const PALETTE = [
  "hsl(248 70% 65%)",
  "hsl(0 75% 60%)",
  "hsl(330 80% 60%)",
  "hsl(20 85% 60%)",
  "hsl(210 80% 60%)",
  "hsl(280 80% 65%)",
  "hsl(180 80% 55%)",
  "hsl(45 90% 55%)",
];

/**
 * Step 3 — add portcos inline. Type a name, press Enter; the chip
 * animates in. No need to leave the page. Chips animate out on remove.
 * canAdvance once at least one portco exists.
 */
const KEY = ["onboard-portcos"] as const;

export function PortcosStep() {
  const qc = useQueryClient();
  const { data: companies = [] } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CompanyRow[]> => {
      const sb = createSupabaseBrowserClient();
      const { data } = await sb
        .from("companies")
        .select("id, name, color_hex")
        .order("name");
      return (data ?? []) as CompanyRow[];
    },
  });
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const chipsRef = useRef<HTMLDivElement | null>(null);

  async function add() {
    const name = draft.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const sb = createSupabaseBrowserClient();
      const color = PALETTE[companies.length % PALETTE.length];
      const { data, error } = await sb
        .from("companies")
        .insert({ name, color_hex: color })
        .select("id, name, color_hex")
        .single();
      if (error) throw error;
      qc.setQueryData<CompanyRow[]>(KEY, (prev) => [...(prev ?? []), data as CompanyRow]);
      setDraft("");
    } catch (err) {
      console.warn("[onboard] add company failed:", err);
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    const sb = createSupabaseBrowserClient();
    await sb.from("companies").delete().eq("id", id);
    qc.setQueryData<CompanyRow[]>(KEY, (prev) => (prev ?? []).filter((c) => c.id !== id));
  }

  // Burst-animate the newest chip on mount
  useGSAP(
    () => {
      if (!chipsRef.current) return;
      const chips = chipsRef.current.querySelectorAll("[data-chip]");
      const last = chips[chips.length - 1];
      if (!last) return;
      withMotion(() => {
        gsap.fromTo(
          last,
          { scale: 0.5, opacity: 0, y: 8 },
          { scale: 1, opacity: 1, y: 0, duration: 0.4, ease: "back.out(2)" }
        );
      });
    },
    { dependencies: [companies.length] }
  );

  return (
    <OnboardingShell currentStep={3} canAdvance={companies.length > 0}>
      <div className="space-y-4 rounded-xl border border-border/40 bg-card/40 p-5">
        <p className="text-[12px] text-muted-foreground">
          Add the portcos you cover. Mashi groups everything by company.
        </p>

        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            placeholder="Company name…"
            className="h-9"
          />
          <Button type="button" onClick={add} disabled={!draft.trim() || adding} size="sm" className="gap-1.5">
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add
          </Button>
        </div>

        <div ref={chipsRef} className="min-h-[48px]">
          {companies.length === 0 ? (
            <div className="rounded border border-dashed border-border/40 px-3 py-3 text-center text-[11px] text-muted-foreground">
              None yet. Add your first portco above.
            </div>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {companies.map((c) => (
                <li
                  key={c.id}
                  data-chip
                  className="group inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-card px-2.5 py-1 text-[12px]"
                  style={{ boxShadow: `0 0 14px -6px ${c.color_hex}, inset 0 0 0 1px ${c.color_hex}40` }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: c.color_hex }}
                  />
                  <span>{c.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(c.id)}
                    className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                    aria-label={`Remove ${c.name}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </OnboardingShell>
  );
}
