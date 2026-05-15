"use client";

import { Check, X, Edit3, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ApprovalActionType =
  | "send_email"
  | "send_slack"
  | "create_linear_issue"
  | "update_linear_issue"
  | "create_calendar_event"
  | "delegate"
  | "schedule_followup";

export interface ApprovalPreview {
  to?: string;
  channel?: string;
  subject?: string;
  body?: string;
  fields?: Array<{ label: string; value: string }>;
}

const TYPE_LABEL: Record<ApprovalActionType, string> = {
  send_email: "Send email",
  send_slack: "Send Slack message",
  create_linear_issue: "Create Linear issue",
  update_linear_issue: "Update Linear issue",
  create_calendar_event: "Create calendar event",
  delegate: "Send delegation message",
  schedule_followup: "Schedule follow-up",
};

interface Props {
  type: ApprovalActionType;
  preview: ApprovalPreview;
  onApprove?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  className?: string;
}

/**
 * Approval Card — rendered any time the assistant proposes a write action.
 * The action must never auto-execute. The user clicks Approve to commit.
 * Spec §5 + §15.2.
 */
export function ApprovalCard({ type, preview, onApprove, onEdit, onCancel, className }: Props) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border-l-2 border-l-primary border border-border/60 bg-card",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/40 bg-secondary/40 px-3 py-1.5">
        <ShieldAlert className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          Approval required
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">{TYPE_LABEL[type]}</span>
      </div>

      <div className="space-y-2 p-3">
        {preview.to && (
          <FieldRow label="To" value={preview.to} />
        )}
        {preview.channel && (
          <FieldRow label="Channel" value={preview.channel} />
        )}
        {preview.subject && (
          <FieldRow label="Subject" value={preview.subject} />
        )}
        {preview.fields?.map((f) => (
          <FieldRow key={f.label} label={f.label} value={f.value} />
        ))}
        {preview.body && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Body
            </div>
            <div className="whitespace-pre-wrap rounded border border-border/40 bg-background/40 p-2 text-[13px] leading-relaxed text-foreground/90">
              {preview.body}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2">
        <Button size="sm" onClick={onApprove} className="gap-1">
          <Check className="h-3.5 w-3.5" />
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit} className="gap-1">
          <Edit3 className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="gap-1 ml-auto">
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-[13px] text-foreground/90">{value}</span>
    </div>
  );
}
