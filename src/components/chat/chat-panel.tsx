"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUp, Sparkles, PanelRightClose, AlertTriangle, Square } from "lucide-react";
import { useGSAP } from "@gsap/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/store/app-store";
import { useUserProfileStore } from "@/store/user-profile-store";
import { useS2DItems, useCompanies } from "@/hooks/use-s2d";
import { streamPostText } from "@/lib/streaming";
import { cn } from "@/lib/utils";
import { gsap, withMotion, EASE, DUR } from "@/lib/animation";
import type { S2DItem, Company } from "@/types";

type Msg = { id: string; role: "user" | "assistant"; content: string };

const SEED: Msg[] = [
  {
    id: "m0",
    role: "assistant",
    content: "Hey — what do you want to move on first?",
  },
];

/**
 * Derive starter prompts from the user's actual board state. No more
 * "Summarize the Acuity thread" hallucinations when Acuity isn't a portco.
 *
 * Rules:
 *  - If urgent items exist → propose acting on them
 *  - If decision_gate items exist → propose deciding
 *  - Pick the company with the most open items → mention by name
 *  - Always include the universal "what should I do next"
 */
function deriveStarters(items: S2DItem[], companies: Company[]): string[] {
  const open = items.filter((i) => i.status !== "done");
  const starters: string[] = [];

  starters.push("What should I do next?");

  const urgent = open.filter((i) => i.priority === "urgent");
  if (urgent.length > 0) {
    starters.push(`Walk me through my ${urgent.length} urgent item${urgent.length === 1 ? "" : "s"}`);
  }

  const decisions = open.filter((i) => i.pathway === "decision_gate");
  if (decisions.length > 0) {
    starters.push("Help me decide on the open decision gates");
  }

  // Most-active portco by open count
  const counts = new Map<string, number>();
  for (const i of open) {
    if (!i.company_id) continue;
    counts.set(i.company_id, (counts.get(i.company_id) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const c = companies.find((x) => x.id === top[0]);
    if (c) starters.push(`Summarize what's open for ${c.name}`);
  }

  if (starters.length < 4) {
    starters.push("Plan my morning sprint");
  }

  return starters.slice(0, 4);
}

export function ChatPanel() {
  const chatOpen = useAppStore((s) => s.chatOpen);
  const toggleChat = useAppStore((s) => s.toggleChat);
  const styleProfile = useUserProfileStore((s) => s.styleProfile);
  const pathname = usePathname();

  const { data: items = [] } = useS2DItems();
  const { data: companies = [] } = useCompanies();
  const starters = useMemo(
    () => deriveStarters(items, companies),
    [items, companies]
  );

  const [messages, setMessages] = useState<Msg[]>(SEED);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);

  // Cinematic entry: panel slides in from the right while a halo of
  // primary-color light fades in behind it. The glow self-decays after
  // the entry — we want it to feel like the panel was *summoned*, not
  // permanently backlit. The hover-summon pill outside still uses its
  // own pulse to advertise itself.
  useGSAP(
    () => {
      if (!chatOpen) return;
      withMotion(() => {
        if (panelRef.current) {
          gsap.fromTo(
            panelRef.current,
            { xPercent: 100, opacity: 0.4 },
            {
              xPercent: 0,
              opacity: 1,
              duration: DUR.short,
              ease: EASE.back,
              clearProps: "xPercent,opacity",
            }
          );
        }
        if (glowRef.current) {
          gsap
            .timeline()
            .fromTo(
              glowRef.current,
              { opacity: 0, scale: 0.7 },
              { opacity: 1, scale: 1, duration: DUR.short, ease: EASE.out }
            )
            .to(glowRef.current, {
              opacity: 0,
              duration: 1.2,
              ease: "power2.out",
            });
        }
      });
    },
    { dependencies: [chatOpen] }
  );

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Other parts of the app (Sprint bar "Plan sprint", briefing quick actions, etc.)
  // can drop a prompt into the chat panel by dispatching this CustomEvent.
  useEffect(() => {
    function onSeed(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string") setDraft(detail);
    }
    window.addEventListener("mashi:seed-chat", onSeed);
    return () => window.removeEventListener("mashi:seed-chat", onSeed);
  }, []);

  if (!chatOpen) return null;

  async function send() {
    const text = draft.trim();
    if (!text || streaming) return;

    setError(null);
    const userMsg: Msg = { id: `u-${Date.now()}`, role: "user", content: text };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg: Msg = { id: assistantId, role: "assistant", content: "" };
    const history = [...messages, userMsg, assistantMsg];
    setMessages(history);
    setDraft("");
    setStreaming(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Send full history (minus the empty assistant placeholder we just added)
    const payloadMessages = history
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      let accumulated = "";
      await streamPostText(
        "/api/chat",
        { messages: payloadMessages, currentPage: pathname, styleProfile },
        (delta) => {
          accumulated += delta;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m))
          );
        },
        ctrl.signal
      );
    } catch (err) {
      if (!ctrl.signal.aborted) {
        const msg = err instanceof Error ? err.message : "stream failed";
        setError(msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && !m.content
              ? { ...m, content: `[error] ${msg}` }
              : m
          )
        );
      }
    } finally {
      setStreaming(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  return (
    <div className="relative flex h-full shrink-0">
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/2 -z-10 h-[80vh] w-[420px] -translate-y-1/2 rounded-full opacity-0"
        style={{
          background:
            "radial-gradient(closest-side, hsl(var(--primary) / 0.45), transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <aside
        ref={panelRef}
        className="relative flex h-full w-[340px] flex-col border-l border-border/40 bg-background shadow-[0_0_40px_-10px_hsl(var(--primary)/0.25)]"
      >
      <header className="flex h-12 items-center justify-between border-b border-border/40 px-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>Mashi</span>
          <span className="font-mono text-[10px] text-muted-foreground">claude-opus-4-7</span>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleChat} aria-label="Close chat">
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </header>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-3 p-3">
            {messages.map((m) => (
              <ChatBubble key={m.id} msg={m} streaming={streaming && m.role === "assistant" && m.id === messages.at(-1)?.id} />
            ))}
            {error && (
              <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {messages.length <= 1 && !streaming && starters.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 px-3 pb-2">
          {starters.map((s) => (
            <button
              key={s}
              onClick={() => setDraft(s)}
              className="rounded-md border border-border/50 bg-card px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-border/40 p-2">
        <div className="relative">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask Mashi…"
            rows={2}
            className="min-h-16 resize-none pr-9 text-sm"
            disabled={streaming}
          />
          {streaming ? (
            <Button
              variant="default"
              size="icon"
              onClick={stop}
              className="absolute bottom-2 right-2 h-7 w-7"
              aria-label="Stop"
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon"
              onClick={send}
              disabled={!draft.trim()}
              className="absolute bottom-2 right-2 h-7 w-7"
              aria-label="Send"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
          <span>⏎ to send · shift ⏎ for newline</span>
          <span className="font-mono">{streaming ? "streaming…" : "ready"}</span>
        </div>
      </div>
      </aside>
    </div>
  );
}

function ChatBubble({ msg, streaming }: { msg: Msg; streaming?: boolean }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {isUser ? "You" : "Mashi"}
      </div>
      <div
        className={cn(
          "max-w-[90%] whitespace-pre-wrap rounded-md border border-border/50 px-3 py-2 text-sm leading-relaxed",
          isUser ? "bg-secondary text-foreground" : "bg-card border-l-2 border-l-primary/60"
        )}
      >
        {msg.content || (streaming ? <span className="text-muted-foreground">…</span> : null)}
        {streaming && msg.content && (
          <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-primary/80 animate-pulse" />
        )}
      </div>
    </div>
  );
}

export function ChatToggleButton() {
  const { chatOpen, toggleChat } = useAppStore();
  if (chatOpen) return null;
  return (
    <Button variant="outline" size="sm" onClick={toggleChat} className="gap-1.5">
      <Sparkles className="h-3.5 w-3.5 text-primary" />
      <span>Mashi</span>
      <span className="font-mono text-[10px] text-muted-foreground">⌘ /</span>
    </Button>
  );
}

/**
 * Floating summon pill anchored bottom-right. Always present when chat
 * is closed; ambient halo pulses softly so the user knows Mashi is there
 * without it being shouty. Hover ramps the glow + the pill lifts. Click
 * triggers the chat panel's slide-in tween.
 *
 * Sits at the widget layer (same as SprintWidget). Visually they're
 * different size classes (pill vs full widget) and positioned far
 * enough apart that they coexist without a stacking conflict. Below
 * focus overlays so a sprint takeover covers them.
 */
export function ChatSummonPill() {
  const { chatOpen, toggleChat } = useAppStore();
  const haloRef = useRef<HTMLSpanElement | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);

  // Ambient halo loop — runs whenever the pill is mounted (i.e. chat is
  // closed). Subtle enough to live in your peripheral vision without
  // demanding attention.
  useGSAP(
    () => {
      if (chatOpen || !haloRef.current) return;
      withMotion(() => {
        gsap.fromTo(
          haloRef.current,
          { scale: 0.85, opacity: 0.45 },
          {
            scale: 1.4,
            opacity: 0,
            duration: 2.2,
            ease: "sine.out",
            repeat: -1,
          }
        );
      });
    },
    { dependencies: [chatOpen] }
  );

  if (chatOpen) return null;

  // boxShadow with CSS vars can't be tweened by gsap (parser chokes on
  // hsl(var(--*))). Apply shadow via CSS transition + the transform via gsap.
  function onEnter() {
    withMotion(() => {
      if (!pillRef.current) return;
      pillRef.current.style.transition = "box-shadow 0.2s ease-out";
      pillRef.current.style.boxShadow = "0 0 32px -4px hsl(var(--primary) / 0.6)";
      gsap.to(pillRef.current, { y: -2, duration: 0.2, ease: "power2.out" });
    });
  }
  function onLeave() {
    withMotion(() => {
      if (!pillRef.current) return;
      pillRef.current.style.boxShadow = "0 0 16px -6px hsl(var(--primary) / 0.35)";
      gsap.to(pillRef.current, { y: 0, duration: 0.25, ease: "power2.out" });
    });
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-widget flex justify-end p-4">
      <button
        ref={pillRef}
        onClick={toggleChat}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="pointer-events-auto group relative inline-flex h-10 items-center gap-2 overflow-visible rounded-full border border-primary/40 bg-card/95 px-4 text-[12px] font-medium backdrop-blur-sm transition-colors hover:bg-card"
        style={{ boxShadow: "0 0 16px -6px hsl(var(--primary) / 0.35)" }}
        aria-label="Summon Mashi"
      >
        <span
          ref={haloRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-primary/35 blur-md"
        />
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span>Summon Mashi</span>
        <span className="ml-1 rounded border border-border/40 bg-secondary/60 px-1 font-mono text-[9px] text-muted-foreground">
          ⌘ /
        </span>
      </button>
    </div>
  );
}
