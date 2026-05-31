/**
 * Output-trust derivations for the agent thread surface (Epic C: C1 + C2).
 *
 * Pure, dependency-free, and unit-tested (`pnpm test:provenance`). The React
 * layer (thread-view, tool card) renders the structures returned here; all the
 * shape-knowledge lives in this one module so it can be tested without a DOM.
 *
 *   - `deriveSources(toolName, output)` (C1): extracts lightweight, linkable
 *     source descriptors from a read tool's result, so a turn can show "where
 *     did this come from" provenance chips.
 *   - `summarizeToolResult(toolName, output)` (C2): turns a known tool's result
 *     into a compact, readable summary (headline + rows) instead of a raw JSON
 *     blob. Returns null for shapes we don't have a typed summary for — the
 *     caller falls back to (wrap-fixed, copyable) raw JSON.
 *   - `deriveActionableItems(toolName, output)` (L1): extracts the board items
 *     from a read result with enough identity (id, title, status) for the
 *     interactive tool-result view to render rows the user can act on inline
 *     (open / snooze / add to sprint) without retyping.
 *   - `derivePlanSteps(toolName, output)` (L1): pulls the ordered, checkable
 *     plan steps out of a set_plan result so the view renders a live checklist
 *     reflecting each step's stored done-state.
 */

export type SourceKind =
  | "item"
  | "message"
  | "meeting"
  | "linear"
  | "calendar";

export interface SourceDescriptor {
  kind: SourceKind;
  /** Human label for the chip (ticket number + title, subject, etc.). */
  title: string;
  /** External deep link, when the row carries one. Omitted for sources with
   * no addressable URL (Gmail/Slack messages, Fireflies meetings); those
   * render as a non-link chip. */
  href?: string;
}

export interface SummaryRow {
  title: string;
  /** Secondary metadata (status, date, sender). */
  meta?: string;
}

export interface ToolSummary {
  /** One-line count/scope, e.g. "5 board items" or "No matches". */
  headline: string;
  rows: SummaryRow[];
}

// --- small, defensive accessors --------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

/** Board item → "MASH-1234 · Title" (ticket number when present). */
function itemTitle(row: Record<string, unknown>): string {
  const ticket = str(row.ticket_number);
  const title = str(row.title) ?? "Untitled item";
  return ticket ? `${ticket} · ${title}` : title;
}

function dedupeSources(sources: SourceDescriptor[]): SourceDescriptor[] {
  const seen = new Set<string>();
  const out: SourceDescriptor[] = [];
  for (const s of sources) {
    const key = `${s.kind}:${s.href ?? s.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// --- C1: source descriptors -------------------------------------------------

const ITEM_LIST_KEYS = [
  "items",
  "urgent_items",
  "sprint_items",
  "resurfacing_items",
];

function itemSource(row: Record<string, unknown>): SourceDescriptor {
  const href = isHttpUrl(row.source_url) ? row.source_url : undefined;
  return { kind: "item", title: itemTitle(row), href };
}

function meetingSource(row: Record<string, unknown>): SourceDescriptor {
  return {
    kind: "meeting",
    title: str(row.title) ?? "Meeting",
    href: isHttpUrl(row.meeting_url) ? row.meeting_url : undefined,
  };
}

function messageSource(row: Record<string, unknown>): SourceDescriptor {
  const subject = str(row.subject);
  const sender = str(row.sender_name) ?? str(row.sender_email);
  const title = subject ?? (sender ? `Message from ${sender}` : "Message");
  return {
    kind: "message",
    title,
    href: isHttpUrl(row.permalink) ? row.permalink : undefined,
  };
}

function linearSource(row: Record<string, unknown>): SourceDescriptor {
  return {
    kind: "linear",
    title: str(row.title) ?? "Linear issue",
    href: isHttpUrl(row.url) ? row.url : undefined,
  };
}

function calendarSource(row: Record<string, unknown>): SourceDescriptor {
  return {
    kind: "calendar",
    title: str(row.title) ?? "Calendar event",
    href: isHttpUrl(row.meeting_url) ? row.meeting_url : undefined,
  };
}

/**
 * Extract source descriptors from one read tool's parsed result. Returns []
 * for write tools, errors, or shapes with nothing addressable.
 */
export function deriveSources(
  toolName: string,
  output: unknown
): SourceDescriptor[] {
  const rec = asRecord(output);
  if (!rec) return [];
  const out: SourceDescriptor[] = [];

  switch (toolName) {
    case "search_board": {
      for (const r of asArray(rec.items)) {
        const row = asRecord(r);
        if (row) out.push(itemSource(row));
      }
      break;
    }
    case "get_item": {
      const row = asRecord(rec.item);
      if (row) out.push(itemSource(row));
      break;
    }
    case "list_today":
    case "get_today": {
      for (const key of ITEM_LIST_KEYS) {
        for (const r of asArray(rec[key])) {
          const row = asRecord(r);
          if (row) out.push(itemSource(row));
        }
      }
      for (const r of asArray(rec.calendar)) {
        const row = asRecord(r);
        if (row) out.push(calendarSource(row));
      }
      break;
    }
    case "search_messages":
    case "get_message_thread": {
      for (const r of asArray(rec.messages)) {
        const row = asRecord(r);
        if (row) out.push(messageSource(row));
      }
      break;
    }
    case "search_meetings": {
      for (const r of asArray(rec.meetings)) {
        const row = asRecord(r);
        if (row) out.push(meetingSource(row));
      }
      break;
    }
    case "get_meeting": {
      const row = asRecord(rec.meeting);
      if (row) out.push(meetingSource(row));
      break;
    }
    case "search_linear": {
      for (const r of asArray(rec.issues)) {
        const row = asRecord(r);
        if (row) out.push(linearSource(row));
      }
      break;
    }
    case "get_linear_issue": {
      const row = asRecord(rec.issue);
      if (row) out.push(linearSource(row));
      break;
    }
    case "get_calendar_event": {
      const row = asRecord(rec.event) ?? rec;
      out.push(calendarSource(row));
      break;
    }
    case "search_everything": {
      for (const r of asArray(rec.results)) {
        const row = asRecord(r);
        if (!row) continue;
        switch (row.kind) {
          case "s2d_item":
            out.push(itemSource(row));
            break;
          case "meeting":
            out.push(meetingSource(row));
            break;
          case "message":
            out.push(messageSource(row));
            break;
          case "linear_issue":
            out.push(linearSource(row));
            break;
        }
      }
      break;
    }
    default:
      return [];
  }

  return dedupeSources(out);
}

// --- C2: readable summaries -------------------------------------------------

function rowsFromItems(
  arr: unknown[],
  limit = 8
): SummaryRow[] {
  return arr.slice(0, limit).flatMap((r) => {
    const row = asRecord(r);
    if (!row) return [];
    const status = str(row.status);
    const priority = str(row.priority);
    const meta = [priority, status].filter(Boolean).join(" · ") || undefined;
    return [{ title: itemTitle(row), meta }];
  });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Build a compact summary for a known tool result. Returns null when we don't
 * have a typed shape for the tool (caller renders raw JSON instead).
 */
export function summarizeToolResult(
  toolName: string,
  output: unknown
): ToolSummary | null {
  const rec = asRecord(output);
  if (!rec) return null;

  switch (toolName) {
    case "search_board": {
      const items = asArray(rec.items);
      return {
        headline: items.length === 0 ? "No board items" : plural(items.length, "board item"),
        rows: rowsFromItems(items),
      };
    }
    case "search_messages": {
      const messages = asArray(rec.messages);
      return {
        headline:
          messages.length === 0 ? "No messages" : plural(messages.length, "message"),
        rows: messages.slice(0, 8).flatMap((r) => {
          const row = asRecord(r);
          if (!row) return [];
          const sender = str(row.sender_name) ?? str(row.sender_email);
          const source = str(row.source);
          const title =
            str(row.subject) ?? str(row.preview)?.slice(0, 80) ?? "(no subject)";
          const meta = [source, sender].filter(Boolean).join(" · ") || undefined;
          return [{ title, meta }];
        }),
      };
    }
    case "get_message_thread": {
      const messages = asArray(rec.messages);
      return {
        headline:
          messages.length === 0
            ? "Empty thread"
            : `Thread · ${plural(messages.length, "message")}`,
        rows: messages.slice(0, 8).flatMap((r) => {
          const row = asRecord(r);
          if (!row) return [];
          const sender = str(row.sender_name) ?? str(row.sender_email) ?? "?";
          const preview = str(row.preview) ?? str(row.full_content)?.slice(0, 80);
          return [{ title: sender, meta: preview }];
        }),
      };
    }
    case "search_meetings": {
      const meetings = asArray(rec.meetings);
      return {
        headline:
          meetings.length === 0 ? "No meetings" : plural(meetings.length, "meeting"),
        rows: meetings.slice(0, 8).flatMap((r) => {
          const row = asRecord(r);
          if (!row) return [];
          return [{ title: str(row.title) ?? "Meeting", meta: str(row.date) }];
        }),
      };
    }
    case "search_linear": {
      const issues = asArray(rec.issues);
      return {
        headline:
          issues.length === 0 ? "No Linear issues" : plural(issues.length, "Linear issue"),
        rows: issues.slice(0, 8).flatMap((r) => {
          const row = asRecord(r);
          if (!row) return [];
          const meta = [str(row.status), str(row.assignee_name)]
            .filter(Boolean)
            .join(" · ") || undefined;
          return [{ title: str(row.title) ?? "Issue", meta }];
        }),
      };
    }
    case "list_today":
    case "get_today": {
      const calendar = asArray(rec.calendar).length;
      const urgent = asArray(rec.urgent_items).length;
      const sprint = asArray(rec.sprint_items).length;
      const resurfacing = asArray(rec.resurfacing_items).length;
      const rows: SummaryRow[] = [];
      if (calendar) rows.push({ title: "Calendar", meta: plural(calendar, "event") });
      if (urgent) rows.push({ title: "Urgent", meta: plural(urgent, "item") });
      if (sprint) rows.push({ title: "In sprint", meta: plural(sprint, "item") });
      if (resurfacing)
        rows.push({ title: "Resurfacing", meta: plural(resurfacing, "item") });
      return {
        headline: rows.length === 0 ? "Nothing on today" : "Today",
        rows,
      };
    }
    case "search_everything": {
      const results = asArray(rec.results);
      return {
        headline:
          results.length === 0 ? "No matches" : plural(results.length, "result"),
        rows: results.slice(0, 8).flatMap((r) => {
          const row = asRecord(r);
          if (!row) return [];
          return [
            { title: str(row.title) ?? "(untitled)", meta: str(row.kind) },
          ];
        }),
      };
    }
    default:
      return null;
  }
}

// --- L1: interactive tool-result extractors --------------------------------

/** A board item with enough identity for the interactive view to render an
 * actionable row (open in the board, snooze, add to sprint) without the user
 * retyping a reference. `ref` is the human handle the agent resolves when an
 * inline action dispatches a turn ("Snooze MASH-1234 …"). */
export interface ActionableItem {
  id: string;
  title: string;
  /** "MASH-1234" when the row carries a ticket number, else the title. The
   * inline-action prompt names the item by this so the agent resolves it. */
  ref: string;
  status?: string;
  priority?: string;
  /** External deep link when present (used as the "Open" fallback off-board). */
  href?: string;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function actionableFromRow(row: Record<string, unknown>): ActionableItem | null {
  const id = str(row.id);
  if (!id) return null;
  const title = str(row.title) ?? "Untitled item";
  const ticketNum = num(row.ticket_number) ?? str(row.ticket_number);
  const ref = ticketNum != null ? `MASH-${ticketNum}` : title;
  return {
    id,
    title,
    ref,
    status: str(row.status),
    priority: str(row.priority),
    href: isHttpUrl(row.source_url) ? row.source_url : undefined,
  };
}

/**
 * Board items from a read result, with identity, for the L1 interactive view.
 * Covers the item-bearing read tools (search_board, list_today/get_today).
 * Returns [] for everything else — the caller falls back to the readable I9
 * card. Capped so a huge result can't render an unbounded action list.
 */
export function deriveActionableItems(
  toolName: string,
  output: unknown,
  limit = 8
): ActionableItem[] {
  const rec = asRecord(output);
  if (!rec) return [];
  const rows: unknown[] = [];
  switch (toolName) {
    case "search_board":
      rows.push(...asArray(rec.items));
      break;
    case "list_today":
    case "get_today":
      for (const key of ITEM_LIST_KEYS) rows.push(...asArray(rec[key]));
      break;
    default:
      return [];
  }
  const out: ActionableItem[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const row = asRecord(r);
    if (!row) continue;
    const item = actionableFromRow(row);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** One step of a Focus-card plan, for the L1 live checklist. */
export interface PlanStepView {
  text: string;
  checked: boolean;
}

/**
 * Ordered, checkable plan steps from a set_plan result, so the view renders a
 * live checklist reflecting each step's stored done-state (it re-renders as the
 * agent updates the plan across turns). Returns [] for any other tool / shape.
 */
export function derivePlanSteps(
  toolName: string,
  output: unknown
): PlanStepView[] {
  if (toolName !== "set_plan") return [];
  const rec = asRecord(output);
  if (!rec || rec.ok === false) return [];
  return asArray(rec.plan).flatMap((s) => {
    const row = asRecord(s);
    const text = row && str(row.text);
    if (!text) return [];
    return [{ text, checked: row?.checked === true }];
  });
}
