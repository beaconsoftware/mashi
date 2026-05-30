/**
 * F2 (P6.b) — Playbooks: canned, parameterized, multi-step procedures the
 * user can trigger and the agent runs step by step with the normal approval
 * gates.
 *
 * This module is PURE (no Supabase, no React) so it unit-tests cleanly
 * (`pnpm test:playbooks`) and imports into both the API route and the
 * Spotlight trigger UI. Server reads/writes live in `playbooks-server.ts`.
 *
 * Design (deliberately the "start simple" path the brief calls for, not a
 * visual builder): a playbook is a name + description + an ordered list of
 * natural-language step instructions + an optional list of parameters. A
 * step may reference a `{{param}}` placeholder. Triggering a playbook
 * interpolates the parameter values and composes a single user-turn prompt
 * (`buildPlaybookPrompt`) that instructs the agent to execute the steps in
 * order. Nothing about the loop changes: the agent uses its normal tools and
 * every ring-3 action still pauses for approval (P4). The plan is just the
 * turn's content, which keeps the run fully transparent in the thread.
 *
 * Built-in playbooks live in code (`BUILTIN_PLAYBOOKS`); user-authored ones
 * live in the owner-scoped `agent_playbooks` table. The two are merged for
 * display; built-ins are read-only.
 */

export interface PlaybookParam {
  /** Identifier referenced as `{{key}}` in step text. */
  key: string;
  /** Human label shown in the trigger form. */
  label: string;
  /** Optional input placeholder / example. */
  placeholder?: string;
  /** When true the user must fill it before the playbook can run. */
  required?: boolean;
}

export interface Playbook {
  /** Built-in slug, or the row uuid for a user playbook. */
  id: string;
  slug: string;
  name: string;
  description: string;
  params: PlaybookParam[];
  /** Ordered step instructions; may contain `{{param}}` placeholders. */
  steps: string[];
  /** Built-ins are read-only (no delete); user playbooks are editable. */
  builtin: boolean;
}

/** A user-authored draft before it is persisted (no id/slug yet). */
export interface PlaybookDraft {
  name: string;
  description: string;
  params: PlaybookParam[];
  steps: string[];
}

// Bounds keep the composed prompt small enough to stay within the loop's
// budget (A6) and the param form sane. Enforced on create AND mirrored in the
// DB-facing validation so an over-large playbook never lands.
export const MAX_NAME_CHARS = 80;
export const MAX_DESCRIPTION_CHARS = 280;
export const MAX_STEPS = 12;
export const MAX_STEP_CHARS = 500;
export const MAX_PARAMS = 8;
export const MAX_PARAM_VALUE_CHARS = 500;

const PARAM_KEY_RE = /^[a-z][a-z0-9_]*$/i;

/**
 * Replace `{{key}}` placeholders with the supplied values. Unknown
 * placeholders are left verbatim (so a typo is visible in the prompt rather
 * than silently blanked); values are trimmed. The brace syntax tolerates
 * inner whitespace (`{{ key }}`).
 */
export function interpolate(
  text: string,
  values: Record<string, string>
): string {
  return text.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi, (whole, key) => {
    const v = values[key as string];
    return v == null ? whole : v.trim();
  });
}

/**
 * Check required params are present and non-empty. Returns the list of
 * missing required keys (empty list = ok).
 */
export function validatePlaybookParams(
  playbook: Pick<Playbook, "params">,
  values: Record<string, string>
): { ok: boolean; missing: string[] } {
  const missing = playbook.params
    .filter((p) => p.required && !(values[p.key] ?? "").trim())
    .map((p) => p.key);
  return { ok: missing.length === 0, missing };
}

/**
 * Compose the single user-turn prompt that drives a playbook run. The agent
 * reads this as the user's message, so it is transparent in the thread; the
 * standing instruction reminds it to keep the normal approval gates.
 */
export function buildPlaybookPrompt(
  playbook: Pick<Playbook, "name" | "steps" | "params">,
  values: Record<string, string>
): string {
  const lines: string[] = [];
  lines.push(`Run the "${playbook.name}" playbook.`);

  const filledParams = playbook.params
    .map((p) => {
      const v = (values[p.key] ?? "").trim();
      return v ? `- ${p.label}: ${v}` : null;
    })
    .filter((l): l is string => l !== null);
  if (filledParams.length > 0) {
    lines.push("", "Parameters:", ...filledParams);
  }

  lines.push(
    "",
    "Work through these steps in order, using your tools. Pause for my approval on any external action (sending an email or Slack message, creating a calendar event or Linear issue) exactly as you normally would. If a step can't be completed, tell me why and continue with the rest."
  );
  lines.push("");
  playbook.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${interpolate(step, values).trim()}`);
  });

  return lines.join("\n");
}

/** Lowercase, hyphenated, ascii slug for a playbook name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Validate + normalize a user-authored draft. Returns the cleaned draft on
 * success, or a human-readable error. Pure — both the API route and the test
 * call this; the route never trusts the client-supplied shape past it.
 */
export function validatePlaybookDraft(
  input: unknown
):
  | { ok: true; draft: PlaybookDraft }
  | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Playbook is required." };
  }
  const raw = input as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > MAX_NAME_CHARS) {
    return { ok: false, error: `Name must be ${MAX_NAME_CHARS} characters or fewer.` };
  }

  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return {
      ok: false,
      error: `Description must be ${MAX_DESCRIPTION_CHARS} characters or fewer.`,
    };
  }

  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  const steps = stepsRaw
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
  if (steps.length === 0) {
    return { ok: false, error: "Add at least one step." };
  }
  if (steps.length > MAX_STEPS) {
    return { ok: false, error: `A playbook can have at most ${MAX_STEPS} steps.` };
  }
  if (steps.some((s) => s.length > MAX_STEP_CHARS)) {
    return {
      ok: false,
      error: `Each step must be ${MAX_STEP_CHARS} characters or fewer.`,
    };
  }

  const paramsRaw = Array.isArray(raw.params) ? raw.params : [];
  if (paramsRaw.length > MAX_PARAMS) {
    return { ok: false, error: `A playbook can have at most ${MAX_PARAMS} parameters.` };
  }
  const params: PlaybookParam[] = [];
  const seen = new Set<string>();
  for (const p of paramsRaw) {
    if (typeof p !== "object" || p === null) {
      return { ok: false, error: "Each parameter must have a key and label." };
    }
    const pr = p as Record<string, unknown>;
    const key = typeof pr.key === "string" ? pr.key.trim() : "";
    const label = typeof pr.label === "string" ? pr.label.trim() : "";
    if (!key || !label) {
      return { ok: false, error: "Each parameter needs a key and a label." };
    }
    if (!PARAM_KEY_RE.test(key)) {
      return {
        ok: false,
        error: `Parameter key "${key}" must start with a letter and use only letters, digits, or underscores.`,
      };
    }
    if (seen.has(key.toLowerCase())) {
      return { ok: false, error: `Duplicate parameter key "${key}".` };
    }
    seen.add(key.toLowerCase());
    params.push({
      key,
      label,
      placeholder:
        typeof pr.placeholder === "string" && pr.placeholder.trim()
          ? pr.placeholder.trim().slice(0, 120)
          : undefined,
      required: pr.required === true,
    });
  }

  return { ok: true, draft: { name, description, params, steps } };
}

/**
 * Built-in starter playbooks. Read-only; merged ahead of the user's own.
 * Kept short and approval-safe — each is a sequence of reads + drafts the
 * agent runs, leaving any irreversible send behind the normal gate.
 */
export const BUILTIN_PLAYBOOKS: Playbook[] = [
  {
    id: "monday-pulse",
    slug: "monday-pulse",
    name: "Monday pulse",
    description:
      "A start-of-week briefing: what's due, what slipped, and what's waiting on me.",
    params: [],
    builtin: true,
    steps: [
      "List everything planned for today and anything overdue on the board.",
      "Summarize my unread Slack and email since Friday, grouped by who's waiting on a reply.",
      "Check my calendar for today and tomorrow and flag any meeting I have no prep for.",
      "Draft a short bulleted pulse summarizing the week ahead and the top three things that need my attention.",
    ],
  },
  {
    id: "inbox-triage",
    slug: "inbox-triage",
    name: "Inbox triage",
    description:
      "Sweep unread email and Slack, surface what needs a reply, and draft the easy ones.",
    params: [],
    builtin: true,
    steps: [
      "Find unread email and Slack messages that look like they need a response from me.",
      "Group them by urgency and tell me which can wait.",
      "For the two or three most routine ones, draft a reply in my voice for me to review.",
    ],
  },
  {
    id: "deal-prep",
    slug: "deal-prep",
    name: "Deal / meeting prep",
    description:
      "Pull everything relevant to an upcoming meeting or company into one brief.",
    params: [
      {
        key: "subject",
        label: "Company or meeting",
        placeholder: "e.g. Acme, or my 2pm with Maya",
        required: true,
      },
    ],
    builtin: true,
    steps: [
      "Find recent meetings, emails, Slack threads, and board items related to {{subject}}.",
      "Summarize the current state: open threads, last contact, and any commitments made.",
      "Draft a one-page prep brief with the key facts and three questions I should be ready for.",
    ],
  },
];

/** Look up a built-in by its slug/id. */
export function getBuiltinPlaybook(idOrSlug: string): Playbook | undefined {
  return BUILTIN_PLAYBOOKS.find(
    (p) => p.id === idOrSlug || p.slug === idOrSlug
  );
}
