"use client";

import { useMemo, useState } from "react";
import { GitBranch, ExternalLink, User } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useLinearIssues, type LinearIssueRow } from "@/hooks/use-linear-issues";
import { useCompanies } from "@/hooks/use-s2d";

const LINEAR_PRIORITY: Record<number, { label: string; tone: string }> = {
  0: { label: "none", tone: "text-muted-foreground/60" },
  1: { label: "urgent", tone: "text-destructive" },
  2: { label: "high", tone: "text-orange-400" },
  3: { label: "medium", tone: "text-amber-400" },
  4: { label: "low", tone: "text-muted-foreground" },
};

export function LinearView() {
  const { data: issues = [], isLoading } = useLinearIssues();
  const { data: companies = [] } = useCompanies();
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [assignedToMe, setAssignedToMe] = useState(false);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    for (const it of issues) if (it.status) set.add(it.status);
    return Array.from(set).sort();
  }, [issues]);

  const filtered = useMemo(() => {
    let r = issues;
    if (companyFilter !== "all") {
      r = companyFilter === "none"
        ? r.filter((i) => !i.company_id)
        : r.filter((i) => i.company_id === companyFilter);
    }
    if (statusFilter !== "all") r = r.filter((i) => i.status === statusFilter);
    if (assignedToMe) {
      const meEmail = "sidd.sengupta@beaconsoftware.com"; // TODO: pull from user profile
      r = r.filter((i) => (i.assignee_email ?? "").toLowerCase() === meEmail);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.description ?? "").toLowerCase().includes(q) ||
          (i.assignee_name ?? "").toLowerCase().includes(q)
      );
    }
    return r;
  }, [issues, companyFilter, statusFilter, assignedToMe, search]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/40 bg-secondary/10 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {filtered.length} of {issues.length}
          </span>

          <button
            onClick={() => setAssignedToMe((v) => !v)}
            className={cn(
              "h-7 rounded border px-2 text-[11px] transition-colors",
              assignedToMe
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/40 text-muted-foreground hover:bg-accent/30"
            )}
          >
            assigned to me
          </button>

          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="h-7 rounded border border-border/40 bg-background px-2 text-[11px]"
          >
            <option value="all">All workspaces</option>
            <option value="none">No company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-7 rounded border border-border/40 bg-background px-2 text-[11px]"
          >
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, description, assignee…"
            className="ml-auto h-7 w-64 text-[12px]"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-center text-sm text-muted-foreground">
            No issues match.
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-background/95 backdrop-blur">
              <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Issue</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Priority</th>
                <th className="px-3 py-2 text-left">Assignee</th>
                <th className="px-3 py-2 text-left">Workspace</th>
                <th className="px-3 py-2 text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <IssueRow key={it.id} issue={it} company={it.company_id ? companyMap.get(it.company_id) : undefined} />
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </div>
  );
}

function IssueRow({
  issue,
  company,
}: {
  issue: LinearIssueRow;
  company?: { name: string; color_hex: string };
}) {
  const p = LINEAR_PRIORITY[issue.priority] ?? LINEAR_PRIORITY[0];
  return (
    <tr className="border-b border-border/30 transition-colors hover:bg-accent/20">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-3 w-3 shrink-0 text-indigo-300" />
          <a
            href={issue.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-1 max-w-md text-foreground/90 hover:text-foreground hover:underline"
          >
            {issue.title}
          </a>
          {issue.url && <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />}
        </div>
      </td>
      <td className="px-3 py-2 text-muted-foreground">{issue.status}</td>
      <td className={cn("px-3 py-2 capitalize", p.tone)}>{p.label}</td>
      <td className="px-3 py-2">
        {issue.assignee_name ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <User className="h-2.5 w-2.5" />
            {issue.assignee_name}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        {company ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: company.color_hex }} />
            {company.name}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[10px] text-muted-foreground">
        {fmtRel(issue.updated_at)}
      </td>
    </tr>
  );
}

function fmtRel(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 60) return `${diffMin}m`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
