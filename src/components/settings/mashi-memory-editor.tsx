"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, NotebookPen, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const MAX_CHARS = 8000;

export function MashiMemoryEditor() {
  const [value, setValue] = useState("");
  const [initial, setInitial] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user/mashi-md");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? `${res.status}`);
        const md = typeof data.mashi_md === "string" ? data.mashi_md : "";
        setValue(md);
        setInitial(md);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = value !== initial;
  const overLimit = value.length > MAX_CHARS;

  async function save() {
    if (overLimit || !dirty || saving) return;
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch("/api/user/mashi-md", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mashi_md: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${res.status}`);
      const md = typeof data.mashi_md === "string" ? data.mashi_md : value;
      setValue(md);
      setInitial(md);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <NotebookPen className="h-3.5 w-3.5 text-primary" />
              Mashi memory
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Free-form notes about how Mashi should work with you. Examples: &ldquo;I
              manage three portcos, MPP, Snailworks, Beacon SW.&rdquo; &ldquo;Always
              reference items by MASH-N.&rdquo; &ldquo;I prefer concise replies; expand
              only if I ask.&rdquo; This text is sent to Mashi at the start of every
              conversation.
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 font-mono text-[10px]",
              overLimit ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {value.length} / {MAX_CHARS}
          </span>
        </div>

        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={loading ? "Loading…" : EXAMPLE_PLACEHOLDER}
          className="min-h-48 font-mono text-[12px] leading-relaxed"
          disabled={loading || saving}
        />

        <div className="flex items-center gap-2">
          <Button
            onClick={save}
            disabled={!dirty || overLimit || saving || loading}
            className="gap-1.5"
          >
            <Save className={cn("h-3.5 w-3.5", saving && "animate-pulse")} />
            {saving ? "Saving…" : "Save"}
          </Button>
          {savedAt && !dirty && !error && (
            <span className="flex items-center gap-1 text-[11px] text-primary">
              <Check className="h-3 w-3" />
              Saved
            </span>
          )}
          {dirty && !overLimit && !saving && (
            <span className="text-[11px] text-muted-foreground">Unsaved</span>
          )}
          {overLimit && (
            <span className="text-[11px] text-destructive">
              Over {MAX_CHARS}-char limit
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/15 p-2 text-[12px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const EXAMPLE_PLACEHOLDER = `# About me
I'm Sidd, at Beacon Software. Current portcos: MAP Policy Partners (MPP), Snailworks, Beacon SW.

# Preferences
- Be concise. One paragraph max unless I ask for more.
- Reference items by MASH-N.
- No em-dashes.
`;
