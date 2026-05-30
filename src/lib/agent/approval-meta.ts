/**
 * P4.a (Epic E2 + E3) — pure, presentation-only metadata for the ring-3
 * approval card.
 *
 * This module is deliberately free of any server / Supabase / React import
 * so it is safe to pull into the client card AND unit-test in isolation
 * (`pnpm test:approval-meta`). It answers three questions for a given
 * ring-3 tool call:
 *
 *   1. How weighty is this action? (`weight`) — an irreversible external
 *      SEND is not the same gesture as creating a Gmail draft, and the card
 *      should not dress them the same. Drives colour + whether the primary
 *      gets the `.mashi-glow-focus` emphasis.
 *   2. What words describe it? (`verb` / `noun` / `consequence` /
 *      `primaryLabel`) — so the card reads "Send email · goes out now, can't
 *      be recalled" instead of a generic "approval needed".
 *   3. Is it an update we can diff? (`isUpdate`) — update tools ship a
 *      before-snapshot in the approval context (E2); the card renders a
 *      before/after diff over the patched fields.
 *
 * Plus two pure helpers the card leans on: a deep-but-bounded editable-leaf
 * flattener (so nested objects / arrays are editable, not dropped as
 * "non-editable") and a before/after diff builder.
 */

/**
 * `send`       — an irreversible external send (email, Slack post, Linear
 *                comment). Highest weight: destructive-style primary + glow.
 * `external`   — creates or mutates an external object (calendar event,
 *                Linear issue). Real but not a one-way message to a human.
 * `reversible` — leaves a reversible / low-stakes artifact (Gmail draft,
 *                emoji reaction, mark-read, archive). Lightest weight.
 */
export type ApprovalWeight = "send" | "external" | "reversible";

export interface ApprovalMeta {
  weight: ApprovalWeight;
  /** Header verb, e.g. "Send", "Create draft", "Update". */
  verb: string;
  /** What the action acts on, e.g. "email", "Slack message". */
  noun: string;
  /** One-line plain-English stakes line shown under the header. */
  consequence: string;
  /** True for actions that leave a reversible / removable artifact. */
  reversible: boolean;
  /** True for update-type calls — the card renders a before/after diff from
   * the approval context's `before` snapshot against the call's `patch`. */
  isUpdate: boolean;
  /** Primary-button label, e.g. "Send email", "Create draft", "Apply
   * changes". */
  primaryLabel: string;
}

const META: Record<string, ApprovalMeta> = {
  send_email: {
    weight: "send",
    verb: "Send",
    noun: "email",
    consequence: "Goes out now. It can't be recalled.",
    reversible: false,
    isUpdate: false,
    primaryLabel: "Send email",
  },
  send_slack_message: {
    weight: "send",
    verb: "Send",
    noun: "Slack message",
    consequence: "Posts now. It can't be recalled.",
    reversible: false,
    isUpdate: false,
    primaryLabel: "Send message",
  },
  comment_on_linear_issue: {
    weight: "send",
    verb: "Post",
    noun: "Linear comment",
    consequence: "Posts the comment to the issue now.",
    reversible: false,
    isUpdate: false,
    primaryLabel: "Post comment",
  },
  draft_email: {
    weight: "reversible",
    verb: "Create draft",
    noun: "email draft",
    consequence: "Saves a draft in Gmail. Nothing is sent.",
    reversible: true,
    isUpdate: false,
    primaryLabel: "Create draft",
  },
  react_with_emoji: {
    weight: "reversible",
    verb: "React",
    noun: "emoji reaction",
    consequence: "Adds a reaction. You can remove it later.",
    reversible: true,
    isUpdate: false,
    primaryLabel: "Add reaction",
  },
  mark_email_read: {
    weight: "reversible",
    verb: "Mark read",
    noun: "email",
    consequence: "Marks the email as read.",
    reversible: true,
    isUpdate: false,
    primaryLabel: "Mark read",
  },
  archive_email: {
    weight: "reversible",
    verb: "Archive",
    noun: "email",
    consequence: "Archives the email. You can restore it from Gmail.",
    reversible: true,
    isUpdate: false,
    primaryLabel: "Archive",
  },
  create_calendar_event: {
    weight: "external",
    verb: "Create",
    noun: "calendar event",
    consequence: "Creates the event on your calendar.",
    reversible: false,
    isUpdate: false,
    primaryLabel: "Create event",
  },
  create_linear_issue: {
    weight: "external",
    verb: "Create",
    noun: "Linear issue",
    consequence: "Creates the issue in Linear.",
    reversible: false,
    isUpdate: false,
    primaryLabel: "Create issue",
  },
  update_calendar_event: {
    weight: "external",
    verb: "Update",
    noun: "calendar event",
    consequence: "Changes the event for everyone invited.",
    reversible: false,
    isUpdate: true,
    primaryLabel: "Apply changes",
  },
  update_linear_issue: {
    weight: "external",
    verb: "Update",
    noun: "Linear issue",
    consequence: "Changes the issue in Linear.",
    reversible: false,
    isUpdate: true,
    primaryLabel: "Apply changes",
  },
  staged_to_meeting: {
    weight: "external",
    verb: "Move",
    noun: "item to a meeting",
    consequence: "Moves the item onto a meeting agenda.",
    reversible: false,
    isUpdate: false,
    primaryLabel: "Move",
  },
};

/**
 * Metadata for a ring-3 tool. Unknown tools fall back to a generic
 * `external` weight so a newly-added ring-3 tool still gets a sane,
 * non-trivialising card until it earns a dedicated row.
 */
export function approvalMetaFor(toolName: string): ApprovalMeta {
  return (
    META[toolName] ?? {
      weight: "external",
      verb: "Run",
      noun: toolName,
      consequence: "Acts on an external system.",
      reversible: false,
      isUpdate: false,
      primaryLabel: "Approve",
    }
  );
}

/**
 * Before-state captured by an update tool's `approvalContext` and carried
 * on the approval so the card can diff it against the proposed patch (E2).
 * Best-effort: a tool fills in whatever fields it can cheaply read from its
 * local mirror; missing keys simply render as "(empty)" on the before side.
 */
export interface ApprovalContext {
  /** Current values, keyed by the same field names the tool's `patch` uses. */
  before: Record<string, unknown>;
}

/** Field names whose values are long-form prose and should edit / preview in
 * a multi-line surface rather than a single-line input. */
const LONG_FIELDS = new Set([
  "body",
  "text",
  "message",
  "description",
  "comment",
  "content",
]);

export function isLongField(name: string): boolean {
  return LONG_FIELDS.has(name.toLowerCase());
}

export interface DiffRow {
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

/**
 * Build before/after rows for an update card. Iterates the proposed `patch`
 * (the fields actually changing) and pairs each with its `before` value.
 * Pure + stable: values are rendered through `formatValue` so objects /
 * arrays compare and display deterministically.
 */
export function buildDiffRows(
  before: Record<string, unknown> | undefined,
  patch: Record<string, unknown>
): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const [field, next] of Object.entries(patch)) {
    const prev = before?.[field];
    const beforeStr = prev === undefined ? "" : formatValue(prev);
    const afterStr = formatValue(next);
    rows.push({
      field,
      before: beforeStr,
      after: afterStr,
      changed: beforeStr !== afterStr,
    });
  }
  return rows;
}

/** Human-readable, stable rendering of an arg value for preview / diff. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return value.join(", ");
    }
    return JSON.stringify(value, null, 2);
  }
  return JSON.stringify(value, null, 2);
}

/**
 * A single editable scalar inside the (possibly nested) args tree. `path` is
 * the chain of keys/indices to the leaf; `key` is the stringified path used
 * as a draft map key and the unflatten target.
 */
export interface EditableLeaf {
  /** Path key, e.g. "subject", "patch.title", "attendees.0". */
  key: string;
  /** Display label — the last path segment, or the dotted path for nested. */
  label: string;
  /** Current string value to seed the editor. */
  value: string;
  /** "long" → multi-line Textarea, "text" → single-line Input. */
  kind: "long" | "text";
  /** Original primitive type, so `applyEdits` can coerce on save. */
  type: "string" | "number" | "boolean";
}

/**
 * Flatten args into an ordered list of editable scalar leaves, recursing
 * objects and array elements. Booleans/numbers/strings become leaves;
 * everything reconstructs via `applyEdits`. This is what lets the editor
 * touch nested `patch.*` fields and `attendees.0` array elements instead of
 * dropping them as "non-editable" (the E3 gap).
 *
 * Depth is bounded to avoid pathological nesting; beyond the cap a node is
 * skipped (it still round-trips untouched through `applyEdits`).
 */
export function flattenEditable(
  value: unknown,
  path: string[] = [],
  depth = 0
): EditableLeaf[] {
  if (depth > 4) return [];
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const last = path[path.length - 1] ?? "";
    const longByName = isLongField(last);
    const longByLen = typeof value === "string" && value.length > 80;
    return [
      {
        key: path.join("."),
        label: path.length > 1 ? path.join(".") : last,
        value: typeof value === "string" ? value : String(value),
        kind: longByName || longByLen ? "long" : "text",
        type:
          typeof value === "number"
            ? "number"
            : typeof value === "boolean"
              ? "boolean"
              : "string",
      },
    ];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) =>
      flattenEditable(v, [...path, String(i)], depth + 1)
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flattenEditable(v, [...path, k], depth + 1)
    );
  }
  // null / undefined → not editable as a leaf; round-trips untouched.
  return [];
}

/**
 * Reconstruct an args object from the original plus a map of edited leaf
 * values (keyed by `EditableLeaf.key`). Deep-clones, walks each path, and
 * coerces the edited string back to the leaf's original primitive type so a
 * numeric `priority` stays a number, not "1". Paths not present in `edits`
 * are left exactly as they were.
 */
export function applyEdits(
  original: Record<string, unknown>,
  edits: Record<string, string>,
  leaves: EditableLeaf[]
): Record<string, unknown> {
  const clone = structuredClone(original);
  const typeByKey = new Map(leaves.map((l) => [l.key, l.type]));
  for (const [key, raw] of Object.entries(edits)) {
    const segments = key.split(".");
    const type = typeByKey.get(key) ?? "string";
    setDeep(clone, segments, coerce(raw, type));
  }
  return clone;
}

function coerce(
  raw: string,
  type: "string" | "number" | "boolean"
): string | number | boolean {
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === "boolean") return raw === "true";
  return raw;
}

function setDeep(
  target: Record<string, unknown> | unknown[],
  segments: string[],
  value: unknown
): void {
  let node: unknown = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    if (Array.isArray(node)) {
      node = node[Number(seg)];
    } else if (node && typeof node === "object") {
      node = (node as Record<string, unknown>)[seg];
    } else {
      return;
    }
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(node)) {
    node[Number(last)] = value;
  } else if (node && typeof node === "object") {
    (node as Record<string, unknown>)[last] = value;
  }
}

/**
 * A cancelled (or expired) ring-3 call surfaces a synthetic `is_error`
 * tool_result so the model knows the action did NOT run — but the UI should
 * read it as a neutral "cancelled", not an alarming red error (the E3 gap).
 * These detect the markers the ring-3 hook stamps onto the synthetic result.
 */
export function isCancelledResult(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    (result as Record<string, unknown>).cancelled === true
  );
}

export function isExpiredResult(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    (result as Record<string, unknown>).expired === true
  );
}
