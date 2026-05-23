"use client";

/**
 * Pathway-aware "context package" panel that renders inside sprint
 * active-mode for the current block. Goal: when an item enters a
 * sprint, the user shouldn't have to figure out what to do next —
 * Mashi has the right action pre-built and visible.
 *
 * Per-pathway:
 *   drafted_response / quick_reply
 *     → Pre-drafted reply (uses ai_draft if cached, else streams a
 *       fresh draft on demand). Send via Gmail/Slack button + Copy.
 *
 *   heads_down
 *     → "Open in Claude" / "Copy Claude prompt" buttons that pack
 *       every cached source (Gmail thread, Slack messages, Linear
 *       issue, Fireflies transcript) into a Markdown prompt.
 *
 *   delegated / watching
 *     → Pre-filled check-in / follow-up template ("Hi {who}, just
 *       checking in on…"). Copy button + optional send.
 *
 *   meeting_backed
 *     → Link to the upcoming meeting + a quick "what to bring" hint.
 *
 *   decision_gate
 *     → A compact "decide now" UI: a record-decision textarea.
 *
 *   other pathways
 *     → Generic fallback pointing at the item-sheet.
 */

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  MessageSquare,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateS2DItem } from "@/hooks/use-s2d";
import { useS2DStore } from "@/store/s2d-store";
import { streamPostText } from "@/lib/streaming";
import { useUserProfileStore } from "@/store/user-profile-store";
import { fetchAndRenderClaudePrompt } from "@/lib/s2d/claude-prompt";
import type { S2DItem } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  item: S2DItem;
  className?: string;
}

export function SprintContextPackage({ item, className }: Props) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
        <Sparkles className="h-3 w-3" />
        Context package
        <span className="font-mono text-[9px] opacity-70">{item.pathway}</span>
      </div>
      <Inner item={item} />
    </div>
  );
}

function Inner({ item }: { item: S2DItem }) {
  if (item.pathway === "quick_reply" || item.pathway === "drafted_response") {
    return <DraftedReplyPackage item={item} />;
  }
  if (item.pathway === "heads_down") {
    return <HeadsDownPackage item={item} />;
  }
  if (item.pathway === "delegated" || item.pathway === "watching") {
    return <CheckInPackage item={item} />;
  }
  if (item.pathway === "decision_gate") {
    return <DecisionPackage item={item} />;
  }
  if (item.pathway === "meeting_backed") {
    return <MeetingBackedPackage item={item} />;
  }
  return <FallbackPackage item={item} />;
}

// ─────────────────────────────────────────────────────────────────────────
// drafted_response / quick_reply
// ─────────────────────────────────────────────────────────────────────────

function DraftedReplyPackage({ item }: { item: S2DItem }) {
  const styleProfile = useUserProfileStore((s) => s.styleProfile);
  const updateItem = useUpdateS2DItem();

  const initialDraft = pickInitialDraft(item);
  const [draft, setDraft] = useState(initialDraft);
  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // If we don't have a draft yet, stream one when the package mounts.
  useEffect(() => {
    if (initialDraft.length > 0) return;
    void generate();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function generate() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    let acc = "";
    try {
      const full = await streamPostText(
        `/api/s2d/${item.id}/suggest`,
        { item, styleProfile },
        (delta) => {
          acc += delta;
          // Best-effort live extraction of just the DRAFT body.
          const m = acc.match(/DRAFT:\s*([\s\S]*?)(?:\n\s*VERIFY:|$)/i);
          if (m) setDraft(m[1].trim());
          else setDraft(acc);
        },
        ctrl.signal
      );
      const m = full.match(/DRAFT:\s*([\s\S]*?)(?:\n\s*VERIFY:|$)/i);
      const finalDraft = m ? m[1].trim() : full;
      setDraft(finalDraft);
      updateItem.mutate({
        id: item.id,
        patch: {
          ai_suggestion: full,
          ai_suggestion_generated_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setToast(err instanceof Error ? err.message : "stream failed");
      }
    } finally {
      setStreaming(false);
    }
  }

  async function send() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/s2d/${item.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error ?? `Send failed (${res.status})`);
        return;
      }
      setToast(data.message ?? "Sent");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setToast("Couldn't copy");
    }
  }

  const supportsSend = item.source_type === "gmail" || item.source_type === "slack";
  const sendLabel = item.source_type === "slack" ? "Send via Slack" : "Send via Gmail";

  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-card/60 p-3">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        placeholder={streaming ? "Drafting…" : "Draft a reply…"}
        className="text-[12px] leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {supportsSend && (
          <Button
            size="sm"
            onClick={send}
            disabled={sending || !draft.trim()}
            className="gap-1.5"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {sending ? "Sending…" : sendLabel}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={copy} className="gap-1.5">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={generate}
          disabled={streaming}
          className="gap-1.5"
        >
          <RotateCw className={cn("h-3.5 w-3.5", streaming && "animate-spin")} />
          {streaming ? "Streaming…" : "Regen"}
        </Button>
        {item.source_url && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Source
          </a>
        )}
      </div>
      {toast && <div className="text-[10px] text-muted-foreground">{toast}</div>}
    </div>
  );
}

function pickInitialDraft(item: S2DItem): string {
  if (item.ai_draft) return item.ai_draft;
  const suggestion = item.ai_suggestion ?? "";
  const m = suggestion.match(/DRAFT:\s*([\s\S]*?)(?:\n\s*VERIFY:|$)/i);
  if (m) return m[1].trim();
  return "";
}

// ─────────────────────────────────────────────────────────────────────────
// heads_down
// ─────────────────────────────────────────────────────────────────────────

function HeadsDownPackage({ item }: { item: S2DItem }) {
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function packAndCopy(opt: "web" | "code") {
    setWorking(true);
    try {
      const text = await fetchAndRenderClaudePrompt(item);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      if (opt === "web") {
        window.open("https://claude.ai/new", "_blank", "noopener,noreferrer");
        setToast("Prompt copied — paste into the new Claude tab.");
      } else {
        setToast("Prompt copied — paste into Claude Code.");
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Couldn't build prompt");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-card/60 p-3">
      <p className="text-[11px] text-muted-foreground">
        Start with full context loaded. The prompt packs every cached source
        for this item (Gmail / Slack / Linear / Fireflies / Calendar) into a
        single markdown blob ready to paste.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          onClick={() => packAndCopy("web")}
          disabled={working}
          className="gap-1.5"
        >
          {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : copied ? <Check className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
          {working ? "Packing…" : copied ? "Copied" : "Start in Claude"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => packAndCopy("code")}
          disabled={working}
          className="gap-1.5"
        >
          <Copy className="h-3.5 w-3.5" />
          For Claude Code
        </Button>
      </div>
      {toast && <div className="text-[10px] text-muted-foreground">{toast}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// delegated / watching
// ─────────────────────────────────────────────────────────────────────────

function CheckInPackage({ item }: { item: S2DItem }) {
  const recipient = item.delegated_to || "(whoever you're tracking)";
  const titleStub = item.title.length > 80 ? item.title.slice(0, 80) + "…" : item.title;
  const defaultMessage = `Hi ${recipient.split(/[ ,]/)[0]} — quick check-in on "${titleStub}". Any blockers or movement I can help with?`;
  const [message, setMessage] = useState(defaultMessage);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-card/60 p-3">
      <p className="text-[11px] text-muted-foreground">
        Drafted check-in for {item.delegated_to ? <strong>{item.delegated_to}</strong> : "the person you're tracking"}.
        Edit and paste into Slack/Gmail.
      </p>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        className="text-[12px] leading-relaxed"
      />
      <Button size="sm" variant="outline" onClick={copy} className="gap-1.5">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy check-in"}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// decision_gate
// ─────────────────────────────────────────────────────────────────────────

function DecisionPackage({ item }: { item: S2DItem }) {
  const updateItem = useUpdateS2DItem();
  const [decision, setDecision] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function record() {
    if (!decision.trim()) return;
    setSaving(true);
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: { status: "done", outcome: decision, resolved_via: "manual" },
      });
      setToast("Decision recorded.");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-card/60 p-3">
      <p className="text-[11px] text-muted-foreground">
        Decide now. Recording the outcome closes the item.
      </p>
      <Textarea
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
        rows={3}
        placeholder="What did you decide?"
        className="text-[12px] leading-relaxed"
      />
      <Button
        size="sm"
        onClick={record}
        disabled={saving || !decision.trim()}
        className="gap-1.5"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Record decision
      </Button>
      {toast && <div className="text-[10px] text-muted-foreground">{toast}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// meeting_backed
// ─────────────────────────────────────────────────────────────────────────

function MeetingBackedPackage({ item }: { item: S2DItem }) {
  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-card/60 p-3">
      <p className="text-[11px] text-muted-foreground">
        This will be addressed in an upcoming meeting. Use this block to prep
        what you want to bring — agenda, questions, decisions to push for.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {item.source_url && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[11px] hover:bg-accent"
          >
            <ExternalLink className="h-3 w-3" />
            Open meeting source
          </a>
        )}
        <a
          href="https://calendar.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[11px] hover:bg-accent"
        >
          <ExternalLink className="h-3 w-3" />
          Open Calendar
        </a>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// fallback (any other pathway, including pathways we haven't tuned yet)
// ─────────────────────────────────────────────────────────────────────────

function FallbackPackage({ item }: { item: S2DItem }) {
  const setSelected = useS2DStore((s) => s.setSelectedItem);
  return (
    <div className="rounded-lg border border-border/40 bg-card/60 p-3 text-[11px] text-muted-foreground">
      No pre-built package for this pathway yet.{" "}
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => setSelected(item.id)}
        className="inline-flex h-auto items-center gap-1 px-0 py-0 text-[11px] font-normal text-foreground/80 underline-offset-2 hover:underline"
      >
        <MessageSquare className="h-3 w-3" />
        Open detail panel
      </Button>{" "}
      for the full context + actions.
    </div>
  );
}
