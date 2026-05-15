"use client";

import { useMemo, useState } from "react";
import { Sparkles, Check, AlertTriangle, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useUserProfileStore } from "@/store/user-profile-store";
import type { StyleProfile } from "@/types/style";
import { cn } from "@/lib/utils";

const SEPARATOR = /\n\s*---+\s*\n|\n\s*\n\s*\n/g;

const PLACEHOLDER = `Paste 10–20 messages you've sent recently (emails, Slack DMs, replies). Separate each with a blank line or a line of "---".

Example:

Maya — defer the loyalty rewrite and partner-portal v2. Loyalty has no clear funnel impact this quarter and partner-portal is blocked on the data deal. Keep the other four.

---

yep that's the new RAG pipeline. pull the per-customer attribution before approving more spend.

---

Quick one: can you confirm the cutover date? I want to flag it to the board.`;

export function StyleProfileEditor() {
  const profile = useUserProfileStore((s) => s.styleProfile);
  const setProfile = useUserProfileStore((s) => s.setStyleProfile);

  const [raw, setRaw] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [autoExtracting, setAutoExtracting] = useState(false);
  const [autoResult, setAutoResult] = useState<{
    sources: { gmail: number; slack: number };
    perAccount: Array<{ provider: string; account_label: string; count: number }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const samples = useMemo(() => splitSamples(raw), [raw]);
  const charCount = raw.trim().length;

  async function autoExtract() {
    setAutoExtracting(true);
    setError(null);
    setAutoResult(null);
    try {
      const res = await fetch("/api/style/auto-extract", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
      setProfile(data.profile as StyleProfile);
      setAutoResult({ sources: data.sources, perAccount: data.perAccount });
    } catch (err) {
      setError(err instanceof Error ? err.message : "auto-extraction failed");
    } finally {
      setAutoExtracting(false);
    }
  }

  async function extract() {
    if (samples.length < 3) return;
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch("/api/style/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
      setProfile(data.profile as StyleProfile);
      setRaw("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">How this works</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste recent messages you've written — emails, Slack replies, anything
          that sounds like you. Mashi extracts your voice into a profile and
          injects it into every draft. Your samples are sent to Claude once for
          extraction and never stored on disk; the resulting profile lives in
          your browser&apos;s localStorage until Supabase is wired.
        </p>
      </div>

      {profile && <ProfileCard profile={profile} onClear={() => setProfile(null)} />}

      {/* Auto-extract from connected Gmail + Slack */}
      <Card className="border-primary/30">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Auto-extract from my data</div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">
                Pull recent sent emails and your own Slack messages from
                connected accounts, sample ~25, and extract your style. No
                paste needed.
              </div>
            </div>
            <Button
              onClick={autoExtract}
              disabled={autoExtracting || extracting}
              className="gap-1.5"
            >
              <Wand2 className={cn("h-3.5 w-3.5", autoExtracting && "animate-pulse")} />
              {autoExtracting ? "Pulling samples & extracting…" : "Auto-extract"}
            </Button>
          </div>

          {autoResult && (
            <div className="rounded border border-primary/30 bg-primary/5 p-2.5 text-[12px]">
              <div className="font-medium">
                Extracted from {autoResult.sources.gmail} Gmail + {autoResult.sources.slack} Slack samples
              </div>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {autoResult.perAccount.map((a, i) => (
                  <li key={i} className="font-mono text-[11px]">
                    {a.provider} · {a.account_label}: {a.count}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">
              {profile ? "Or paste more samples to refine" : "Or paste samples manually"}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {samples.length} sample{samples.length === 1 ? "" : "s"} · {charCount} chars
            </span>
          </div>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={PLACEHOLDER}
            className="min-h-64 font-mono text-[12px] leading-relaxed"
            disabled={extracting}
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={extract}
              disabled={extracting || samples.length < 3}
              className="gap-1.5"
            >
              <Sparkles className={cn("h-3.5 w-3.5", extracting && "animate-pulse")} />
              {extracting ? "Extracting…" : "Extract my style"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Needs ≥ 3 samples. 10–20 is the sweet spot.
            </span>
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[12px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileCard({
  profile,
  onClear,
}: {
  profile: StyleProfile;
  onClear: () => void;
}) {
  return (
    <Card className="border-l-2 border-l-primary">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Check className="h-3 w-3 text-primary" />
              Active style profile
            </div>
            <p className="mt-2 text-sm text-foreground/90">{profile.summary}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClear} className="gap-1 text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 text-[12px]">
          <KV label="Voice" value={profile.voice_traits.join(", ")} />
          <KV label="Length" value={profile.length} />
          <KV label="Formality" value={profile.formality} />
          <KV label="Capitalization" value={profile.capitalization} />
          <KV
            label="Habits"
            value={[
              profile.uses_bullets ? "bullets" : null,
              profile.uses_emoji ? "emoji" : null,
              profile.uses_dashes ? "em-dashes" : null,
            ]
              .filter(Boolean)
              .join(", ") || "none"}
          />
          <KV label="Greeting" value={profile.typical_greeting || "(none)"} />
          <KV label="Sign-off" value={profile.typical_signoff || "(none)"} />
          {profile.recurring_phrases.length > 0 && (
            <KV label="Recurring" value={profile.recurring_phrases.join(" · ")} />
          )}
        </div>

        <details className="text-[12px]">
          <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
            {profile.few_shot_examples.length} voice example{profile.few_shot_examples.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 space-y-2">
            {profile.few_shot_examples.map((ex, i) => (
              <div key={i} className="rounded border border-border/40 bg-secondary/30 p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {ex.context}
                </div>
                <div className="mt-1 whitespace-pre-wrap font-mono text-[12px] text-foreground/85">
                  {ex.message}
                </div>
              </div>
            ))}
          </div>
        </details>

        <div className="flex items-center justify-between border-t border-border/40 pt-3 text-[10px] font-mono text-muted-foreground">
          <span>extracted {new Date(profile.extracted_at).toLocaleString()}</span>
          <span>
            {profile.sample_count} samples · {profile.model}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 rounded border border-border/40 px-2 py-1.5">
      <span className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-foreground/85">{value}</span>
    </div>
  );
}

function splitSamples(raw: string): string[] {
  return raw
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
