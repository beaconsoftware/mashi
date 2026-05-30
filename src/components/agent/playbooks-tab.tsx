"use client";

/**
 * F2 (P6.b) — the Spotlight "Playbooks" tab.
 *
 * Lists built-in and user-authored playbooks. Picking one (filling any
 * required parameters) composes a plan prompt via `buildPlaybookPrompt` and
 * hands it to `onRun`, which opens an orphan thread seeded with that prompt —
 * the agent then executes the steps with the normal approval gates (no loop
 * changes). A small "New playbook" form persists custom playbooks to the
 * owner-scoped `agent_playbooks` table through `/api/agent/playbooks`.
 *
 * Trigger-surface only by design (the brief's "start simple", not a visual
 * builder): steps and params are plain text.
 */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  BUILTIN_PLAYBOOKS,
  buildPlaybookPrompt,
  validatePlaybookParams,
  type Playbook,
  type PlaybookParam,
} from "@/lib/agent/playbooks";

interface PlaybooksResponse {
  builtins: Playbook[];
  playbooks: Playbook[];
}

export function PlaybooksTab({
  onRun,
  running,
}: {
  /** Compose-and-go: parent opens an orphan thread seeded with this prompt. */
  onRun: (prompt: string) => void;
  /** True while the parent is opening the seeded thread. */
  running: boolean;
}) {
  const qc = useQueryClient();
  // null = list, "new" = create form, a Playbook = the run/param view.
  const [view, setView] = useState<"list" | "new" | Playbook>("list");

  const query = useQuery<PlaybooksResponse>({
    queryKey: ["agent-playbooks"],
    queryFn: async () => {
      const res = await fetch("/api/agent/playbooks", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`playbooks ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    // Built-ins are known client-side; show them instantly while the user's
    // own load.
    placeholderData: { builtins: BUILTIN_PLAYBOOKS, playbooks: [] },
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["agent-playbooks"] });
  }, [qc]);

  if (view === "new") {
    return (
      <NewPlaybookForm
        onCancel={() => setView("list")}
        onCreated={() => {
          invalidate();
          setView("list");
        }}
      />
    );
  }

  if (view !== "list") {
    return (
      <RunPlaybookView
        playbook={view}
        running={running}
        onBack={() => setView("list")}
        onRun={onRun}
      />
    );
  }

  const builtins = query.data?.builtins ?? BUILTIN_PLAYBOOKS;
  const userPlaybooks = query.data?.playbooks ?? [];

  return (
    <div className="mashi-enter flex h-full flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between">
        <p className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          Playbooks
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setView("new")}
          className="h-6 gap-1 text-[11px]"
        >
          <Plus className="h-3 w-3" />
          New
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <PlaybookGroup
          label="Starter"
          playbooks={builtins}
          onPick={setView}
          onDeleted={invalidate}
        />
        {userPlaybooks.length > 0 && (
          <PlaybookGroup
            label="Yours"
            playbooks={userPlaybooks}
            onPick={setView}
            onDeleted={invalidate}
          />
        )}
      </div>
    </div>
  );
}

function PlaybookGroup({
  label,
  playbooks,
  onPick,
  onDeleted,
}: {
  label: string;
  playbooks: Playbook[];
  onPick: (p: Playbook) => void;
  onDeleted: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="space-y-1">
        {playbooks.map((p) => (
          <PlaybookRow
            key={p.id}
            playbook={p}
            onClick={() => onPick(p)}
            onDeleted={onDeleted}
          />
        ))}
      </div>
    </div>
  );
}

function PlaybookRow({
  playbook,
  onClick,
  onDeleted,
}: {
  playbook: Playbook;
  onClick: () => void;
  onDeleted: () => void;
}) {
  const del = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/agent/playbooks", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: playbook.id }),
      });
      if (!res.ok) throw new Error(`delete ${res.status}`);
    },
    onSuccess: onDeleted,
  });

  return (
    <div className="mashi-magnetic group flex items-center gap-2 rounded-md border border-border/40 bg-card/60 px-2.5 py-2">
      <Button
        type="button"
        variant="ghost"
        onClick={onClick}
        className="h-auto min-w-0 flex-1 flex-col items-start justify-start gap-0.5 whitespace-normal p-0 text-left font-normal hover:bg-transparent"
      >
        <span className="flex w-full items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">
            {playbook.name}
          </span>
          {playbook.params.length > 0 && (
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              {playbook.params.length} param
              {playbook.params.length > 1 ? "s" : ""}
            </Badge>
          )}
        </span>
        {playbook.description && (
          <span className="w-full truncate text-[11px] font-normal text-muted-foreground">
            {playbook.description}
          </span>
        )}
      </Button>
      {!playbook.builtin && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Delete ${playbook.name}`}
          disabled={del.isPending}
          onClick={() => del.mutate()}
          className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
        >
          {del.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
        </Button>
      )}
    </div>
  );
}

function RunPlaybookView({
  playbook,
  running,
  onBack,
  onRun,
}: {
  playbook: Playbook;
  running: boolean;
  onBack: () => void;
  onRun: (prompt: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const check = validatePlaybookParams(playbook, values);

  return (
    <div className="mashi-enter flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Back to playbooks"
          onClick={onBack}
          className="h-6 w-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="truncate text-sm font-medium text-foreground">
          {playbook.name}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {playbook.description && (
          <p className="text-[11px] text-muted-foreground">
            {playbook.description}
          </p>
        )}

        {playbook.params.length > 0 && (
          <div className="space-y-2">
            {playbook.params.map((param) => (
              <ParamField
                key={param.key}
                param={param}
                value={values[param.key] ?? ""}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, [param.key]: v }))
                }
              />
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Steps
          </div>
          <ol className="space-y-1 text-[11px] text-foreground/90">
            {playbook.steps.map((step, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="shrink-0 font-mono text-muted-foreground">
                  {i + 1}.
                </span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <Button
        type="button"
        disabled={!check.ok || running}
        onClick={() => onRun(buildPlaybookPrompt(playbook, values))}
        className="mashi-press w-full gap-1.5"
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        Run playbook
      </Button>
    </div>
  );
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: PlaybookParam;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">
        {param.label}
        {param.required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.placeholder}
        className="mashi-glow-focus h-8 text-sm"
      />
    </div>
  );
}

function NewPlaybookForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [paramsText, setParamsText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      // Steps: one per line. Params: "key | Label" per line (all required).
      const steps = stepsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const params = paramsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [key, ...labelParts] = line.split("|");
          const label = labelParts.join("|").trim();
          return {
            key: (key ?? "").trim(),
            label: label || (key ?? "").trim(),
            required: true,
          };
        });
      const res = await fetch("/api/agent/playbooks", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, steps, params }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Couldn't save playbook.");
      }
    },
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't save."),
  });

  return (
    <div className="mashi-enter flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Back to playbooks"
          onClick={onCancel}
          className="h-6 w-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-sm font-medium text-foreground">New playbook</span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly investor update"
            className="mashi-glow-focus h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            Description
          </Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line on what this does"
            className="mashi-glow-focus h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            Steps (one per line)
          </Label>
          <Textarea
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
            placeholder={"Pull last week's metrics\nDraft the update in my voice\nList what's blocked"}
            rows={5}
            className="mashi-glow-focus text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            Parameters (optional, one per line as{" "}
            <span className="font-mono">key | Label</span>)
          </Label>
          <Textarea
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            placeholder={"subject | Company or person\nweek | Which week"}
            rows={2}
            className="mashi-glow-focus text-sm"
          />
          <p className="text-[10px] text-muted-foreground/80">
            Reference a parameter in a step with{" "}
            <span className="font-mono">{"{{key}}"}</span>.
          </p>
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>

      <Button
        type="button"
        disabled={!name.trim() || !stepsText.trim() || create.isPending}
        onClick={() => {
          setError(null);
          create.mutate();
        }}
        className="mashi-press w-full gap-1.5"
      >
        {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Save playbook
      </Button>
    </div>
  );
}
