"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/layout/primitives";
import { useUpdateS2DItem } from "@/hooks/use-s2d";
import { cn } from "@/lib/utils";
import type { PlanStep, S2DItem } from "@/types";

/**
 * Plan tab — ordered checklist editor backed by `s2d_items.plan` JSONB.
 * Adds via the "Add a step…" input (Enter), toggles via Checkbox,
 * inline-edits via Input save-on-blur, drags-to-reorder via dnd-kit,
 * deletes via the trash button.
 *
 * The Focus card chat agent can also write here via the `set_plan`
 * ring-2 tool; this UI re-renders from the item cache whenever it lands.
 */
export function PlanTab({ item }: { item: S2DItem }) {
  const updateItem = useUpdateS2DItem();
  const stored = useMemo<PlanStep[]>(
    () => (Array.isArray(item.plan) ? item.plan : []),
    [item.plan]
  );
  const [steps, setSteps] = useState<PlanStep[]>(stored);

  // Sync local steps with the item cache whenever it changes (agent
  // writes, undo strip rollback, etc).
  useEffect(() => {
    setSteps(stored);
  }, [stored]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function persist(next: PlanStep[]) {
    setSteps(next);
    updateItem.mutate({ id: item.id, patch: { plan: next } });
  }

  function toggle(stepId: string) {
    persist(
      steps.map((s) =>
        s.id === stepId ? { ...s, checked: !s.checked } : s
      )
    );
  }

  function rename(stepId: string, text: string) {
    persist(
      steps.map((s) => (s.id === stepId ? { ...s, text } : s))
    );
  }

  function remove(stepId: string) {
    persist(steps.filter((s) => s.id !== stepId));
  }

  function add(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const step: PlanStep = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      checked: false,
      created_at: new Date().toISOString(),
    };
    persist([...steps, step]);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = steps.findIndex((s) => s.id === active.id);
    const to = steps.findIndex((s) => s.id === over.id);
    if (from === -1 || to === -1) return;
    persist(arrayMove(steps, from, to));
  }

  const completed = steps.filter((s) => s.checked).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {steps.length === 0 ? (
        <EmptyState
          title="No plan yet"
          subtitle="Add a step below, or ask Mashi to draft one for you in the Chat tab."
          icon={<Plus className="h-5 w-5" />}
        />
      ) : (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {completed}/{steps.length} done
          </span>
        </div>
      )}

      {steps.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={steps.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="space-y-1.5">
              {steps.map((step, i) => (
                <PlanRow
                  key={step.id}
                  index={i}
                  step={step}
                  onToggle={() => toggle(step.id)}
                  onRename={(text) => rename(step.id, text)}
                  onDelete={() => remove(step.id)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <AddStepInput onAdd={add} />
    </div>
  );
}

function PlanRow({
  index,
  step,
  onToggle,
  onRename,
  onDelete,
}: {
  index: number;
  step: PlanStep;
  onToggle: () => void;
  onRename: (text: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: step.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const [text, setText] = useState(step.text);
  useEffect(() => {
    setText(step.text);
  }, [step.text]);

  function commit() {
    const trimmed = text.trim();
    if (!trimmed) {
      setText(step.text);
      return;
    }
    if (trimmed !== step.text) onRename(trimmed);
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1.5 rounded border border-border/40 bg-card/80 px-1.5 py-1.5 text-[11px] leading-snug",
        isDragging && "opacity-60"
      )}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        className="mashi-press h-5 w-5 shrink-0 cursor-grab p-0 text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3 w-3" />
      </Button>
      <Checkbox
        checked={step.checked}
        onCheckedChange={onToggle}
        aria-label={`Step ${index + 1}`}
      />
      <span className="font-mono text-[10px] text-primary">
        {String(index + 1).padStart(2, "0")}
      </span>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "h-6 flex-1 border-transparent bg-transparent px-1 text-[11px] focus-visible:border-border focus-visible:bg-card/80",
          step.checked && "text-muted-foreground line-through"
        )}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDelete}
        aria-label="Delete step"
        title="Delete step"
        className="mashi-press h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </li>
  );
}

function AddStepInput({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex items-center gap-1.5">
      <Plus className="h-3 w-3 text-muted-foreground" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) {
            e.preventDefault();
            onAdd(text);
            setText("");
          }
        }}
        placeholder="Add a step…"
        className="h-7 flex-1 border-border/40 bg-card/60 px-2 text-[11px] placeholder:text-muted-foreground/60"
      />
    </div>
  );
}
