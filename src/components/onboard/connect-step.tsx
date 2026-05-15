"use client";

import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGSAP } from "@gsap/react";
import { ExternalLink, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { gsap, withMotion } from "@/lib/animation";
import { cn } from "@/lib/utils";

interface ConnRow {
  provider: string;
}

const PROVIDERS = [
  { key: "linear", label: "Linear", letter: "L", color: "hsl(248 70% 65%)" },
  { key: "gmail", label: "Gmail", letter: "G", color: "hsl(0 75% 60%)" },
  { key: "slack", label: "Slack", letter: "S", color: "hsl(330 80% 60%)" },
  { key: "fireflies", label: "Fireflies", letter: "F", color: "hsl(20 85% 60%)" },
  { key: "gcal", label: "Calendar", letter: "C", color: "hsl(210 80% 60%)" },
];

/**
 * Step 2 — connect providers, visualized as a 5-tile grid that fills with
 * light as accounts connect. Polls every 4s so coming back from an OAuth
 * round-trip lights up the tile without a page reload.
 *
 * canAdvance once at least one provider is connected.
 */
export function ConnectStep() {
  const { data: connected = new Set<string>() } = useQuery({
    queryKey: ["onboard-connections"],
    queryFn: async () => {
      const sb = createSupabaseBrowserClient();
      const { data } = await sb
        .from("connected_accounts")
        .select("provider");
      const providers = new Set<string>();
      for (const r of (data ?? []) as ConnRow[]) providers.add(r.provider);
      return providers;
    },
    refetchInterval: 4_000,
  });

  const count = connected.size;
  return (
    <OnboardingShell currentStep={2} canAdvance={count > 0} allowSkip>
      <Grid connected={connected} />
      <div className="mt-3 flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground">
          {count === 0
            ? "Connect at least one to continue."
            : `${count} connected · pick more or move on.`}
        </span>
        <a
          href="/settings/connections"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline"
        >
          Open Connections
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </OnboardingShell>
  );
}

function Grid({ connected }: { connected: Set<string> }) {
  const ref = useRef<HTMLDivElement | null>(null);

  // When a new tile turns connected, fire a one-shot burst behind it
  useGSAP(
    () => {
      if (!ref.current) return;
      const bursts = ref.current.querySelectorAll("[data-burst]");
      withMotion(() => {
        bursts.forEach((b) => {
          gsap.fromTo(
            b,
            { scale: 0.6, opacity: 0.9 },
            { scale: 1.8, opacity: 0, duration: 0.7, ease: "power2.out" }
          );
        });
      });
    },
    { dependencies: [connected.size] }
  );

  return (
    <div ref={ref} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {PROVIDERS.map((p) => {
        const on = connected.has(p.key);
        return (
          <a
            key={p.key}
            href="/settings/connections"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "group relative flex aspect-square flex-col items-center justify-center rounded-xl border bg-card/60 transition-all duration-300",
              on
                ? "border-primary/60"
                : "border-border/40 hover:border-primary/40"
            )}
            style={
              on
                ? { boxShadow: `0 0 30px -4px ${p.color}, inset 0 0 0 1px ${p.color}55` }
                : undefined
            }
            title={on ? "Connected" : "Click to connect"}
          >
            {on && (
              <span
                data-burst
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 rounded-xl"
                style={{ background: `radial-gradient(closest-side, ${p.color}80, transparent 70%)`, filter: "blur(8px)" }}
              />
            )}
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold transition-all"
              style={{
                backgroundColor: on ? `${p.color}25` : "hsl(var(--secondary))",
                color: on ? p.color : "hsl(var(--muted-foreground))",
                boxShadow: on ? `inset 0 0 0 1px ${p.color}` : undefined,
              }}
            >
              {p.letter}
            </span>
            <span className={cn("mt-2 text-[11px] font-medium", on ? "text-foreground" : "text-muted-foreground")}>
              {p.label}
            </span>
            {on && (
              <span className="mt-0.5 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-primary">
                <Check className="h-2.5 w-2.5" />
                connected
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}

// Re-export Button for consistency with other steps using it (unused here but
// keeps any future inline action additions trivial).
export { Button };
