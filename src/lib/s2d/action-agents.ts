/**
 * Layer 2 of the action toolkit: per-action prompt builders.
 *
 * Each entry maps an action key to a prompt builder that reads the
 * ItemBrief (and the underlying ContextResp when more detail is needed)
 * and returns the messages to send to Claude. Stateless and composable.
 *
 * The caller (POST /api/s2d/:id/action) decides which model tier to use
 * and how to stream / return the response.
 */

import { renderBriefForPrompt, type ItemBrief } from "./item-brief";
import { renderClaudePrompt, type ContextResp } from "./claude-prompt";
import type { S2DItem } from "@/types";

export type ActionKey =
  // quick_reply
  | "quick_reply_draft"
  | "quick_reply_variants"
  | "quick_reply_forward"
  // drafted_response
  | "drafted_response_outline"
  | "drafted_response_prose"
  | "drafted_response_who_waiting"
  // delegated
  | "delegated_status_pull"
  | "delegated_check_in"
  // heads_down
  | "heads_down_strawman"
  | "heads_down_subtasks"
  // decision_gate
  | "decision_options"
  | "decision_tradeoffs"
  // watching
  | "watching_nudge"
  // cross-pathway
  | "retriage";

export interface ActionPrompt {
  model: "primary" | "secondary" | "fast";
  system: string;
  userPrompt: string;
  maxTokens: number;
}

interface BuildArgs {
  item: S2DItem;
  brief: ItemBrief;
  ctx: ContextResp;
  /** Free-form params passed from the UI (e.g. variant tone). */
  params?: Record<string, unknown>;
}

const VOICE_GUARDRAILS = `Output ONLY the requested content. No preamble, no explanation, no sign-off unless Sidd's style profile shows one. No em dashes (—) or en dashes (–) ever. No "Let me know", "Happy to discuss", "I'd be happy to". Plain English, direct, sounds like Sidd actually said it.`;

const ACTION_BUILDERS: Record<ActionKey, (a: BuildArgs) => ActionPrompt> = {
  // ─── quick_reply ──────────────────────────────────────────────────
  quick_reply_draft: ({ item, brief, ctx }) => ({
    model: "primary",
    maxTokens: 500,
    system: `You are drafting a quick reply for Sidd. Sidd is the SENDER. Match his voice. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}

# Brief
${renderBriefForPrompt(brief)}

# Most recent inbound message thread
${renderClaudePrompt(item, ctx).slice(0, 4000)}

Draft Sidd's reply. Address the most recent ask. Keep it tight.`,
  }),

  quick_reply_variants: ({ item, brief, ctx }) => ({
    model: "primary",
    maxTokens: 800,
    system: `You are drafting three reply variants for Sidd. Same content, three different tones. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}

# Brief
${renderBriefForPrompt(brief)}

# Source thread
${renderClaudePrompt(item, ctx).slice(0, 4000)}

Produce THREE variants, each prefixed exactly as shown:

DIRECT:
[2-3 sentences, no softening]

WARM:
[2-3 sentences, friendly but still tight]

DEFLECTING:
[2-3 sentences, postpones or hands off without committing]`,
  }),

  quick_reply_forward: ({ item, brief, params }) => {
    const delegate =
      params && typeof params.delegate === "string" && params.delegate.trim()
        ? (params.delegate as string)
        : item.delegated_to || "the right person";
    return {
      model: "secondary",
      maxTokens: 300,
      system: `You are drafting a one-line forward note for Sidd. ${VOICE_GUARDRAILS}`,
      userPrompt: `Sidd is forwarding this to ${delegate} and adding a brief note.

# Task
${item.title}

# Brief
${renderBriefForPrompt(brief)}

Write the forward note. One or two sentences. State what Sidd wants ${delegate} to do.`,
    };
  },

  // ─── drafted_response ────────────────────────────────────────────
  drafted_response_outline: ({ item, brief, ctx }) => ({
    model: "primary",
    maxTokens: 600,
    system: `You are drafting an outline for a longer response Sidd will iterate on. Bullets only at this stage. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}

# Brief
${renderBriefForPrompt(brief)}

# Source thread
${renderClaudePrompt(item, ctx).slice(0, 4000)}

Produce a 3-6 bullet outline of the response. Each bullet is one thought Sidd wants to land.`,
  }),

  drafted_response_prose: ({ item, brief, ctx }) => ({
    model: "primary",
    maxTokens: 1200,
    system: `You are drafting Sidd's full response. Strawman, not final. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}

# Brief
${renderBriefForPrompt(brief)}

# Source thread
${renderClaudePrompt(item, ctx).slice(0, 5000)}

Draft Sidd's full response. Cover the outstanding questions. Don't sign off.`,
  }),

  drafted_response_who_waiting: ({ item, brief }) => ({
    model: "fast",
    maxTokens: 300,
    system: `You analyze a brief and surface who's been waiting on Sidd and for how long. Plain bullets. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}

# Brief
${renderBriefForPrompt(brief)}

Today is ${new Date().toISOString().slice(0, 10)}.

List the people waiting on Sidd, oldest wait first. Format each line:
- [days waiting] Name, what they're waiting for.`,
  }),

  // ─── delegated ────────────────────────────────────────────────────
  delegated_status_pull: ({ item, brief, ctx }) => ({
    model: "secondary",
    maxTokens: 600,
    system: `You assess actual movement on a delegated item across all linked sources. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}
Delegated to: ${item.delegated_to ?? "(unknown)"}

# Brief
${renderBriefForPrompt(brief)}

# Source content
${renderClaudePrompt(item, ctx).slice(0, 5000)}

Today is ${new Date().toISOString().slice(0, 10)}.

Output in this exact format:

MOVEMENT:
[1-2 sentences on what has or hasn't moved since handoff]

LAST_TOUCH:
[Most recent activity, date + actor + what happened]

RISK:
[on_track / drifting / stuck / unknown — one word, then a clause]`,
  }),

  delegated_check_in: ({ item, brief }) => ({
    model: "primary",
    maxTokens: 400,
    system: `You draft a state-aware check-in from Sidd to the delegate. Acknowledges what's happened since handoff. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}
Delegated to: ${item.delegated_to ?? "(unknown)"}

# Brief
${renderBriefForPrompt(brief)}

Draft Sidd's check-in message to ${item.delegated_to ?? "the delegate"}. Acknowledge anything that has visibly progressed; ask about anything that hasn't. 2-4 sentences.`,
  }),

  // ─── heads_down ──────────────────────────────────────────────────
  heads_down_strawman: ({ item, brief, ctx }) => ({
    model: "primary",
    maxTokens: 1500,
    system: `You produce a strawman deliverable Sidd can edit instead of starting from blank. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}
${item.description ?? ""}

# Brief
${renderBriefForPrompt(brief)}

# Source content
${renderClaudePrompt(item, ctx).slice(0, 5000)}

Produce a strawman first draft of whatever this task is asking for. Use the right shape (memo / PRD / plan / outline / message). Tight. Sidd will edit.`,
  }),

  heads_down_subtasks: ({ item, brief }) => ({
    model: "secondary",
    maxTokens: 500,
    system: `You break a heads-down task into 3-6 concrete subtasks, each small enough to fit in a single sprint slot. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}
${item.description ?? ""}

# Brief
${renderBriefForPrompt(brief)}

Produce 3-6 subtasks. Each line is one subtask, format:
- [est_minutes] Title, one-line description.`,
  }),

  // ─── decision_gate ───────────────────────────────────────────────
  decision_options: ({ item, brief, ctx }) => ({
    model: "primary",
    maxTokens: 600,
    system: `You extract the actual decision options being debated. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}

# Brief
${renderBriefForPrompt(brief)}

# Source content
${renderClaudePrompt(item, ctx).slice(0, 4000)}

List the options on the table. One per line:
- Option name: 1-sentence description.

If only one option has been proposed, surface it and note what alternatives Sidd should consider.`,
  }),

  decision_tradeoffs: ({ item, brief, ctx }) => ({
    model: "primary",
    maxTokens: 900,
    system: `You produce a tight tradeoff table for a decision. Markdown table. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}

# Brief
${renderBriefForPrompt(brief)}

# Source content
${renderClaudePrompt(item, ctx).slice(0, 4000)}

Produce a markdown table:
| Option | Cost | Risk | Reversibility | Sidd's lean |

Fill it with what you actually know. Use "unknown" for blanks. End with one line stating which option you'd lean toward and why.`,
  }),

  // ─── watching ─────────────────────────────────────────────────────
  watching_nudge: ({ item, brief }) => ({
    model: "primary",
    maxTokens: 300,
    system: `You draft a light-touch nudge Sidd can send to revive a stalled thread. ${VOICE_GUARDRAILS}`,
    userPrompt: `# Task
${item.title}

# Brief
${renderBriefForPrompt(brief)}

Draft Sidd's nudge. 1-2 sentences. Reference what's outstanding. Don't apologize for following up.`,
  }),

  // ─── cross-pathway ────────────────────────────────────────────────
  retriage: ({ item, brief }) => ({
    model: "secondary",
    maxTokens: 400,
    system: `You re-triage a task that has been on the board a while. Output a recommendation Sidd can accept or reject.`,
    userPrompt: `# Task
${item.title}
current pathway: ${item.pathway}
current priority: ${item.priority}

# Brief
${renderBriefForPrompt(brief)}

Output in this format:

RECOMMEND:
pathway=<one of quick_reply, drafted_response, meeting_backed, heads_down, decision_gate, delegated, watching>
priority=<one of urgent, high, medium, low>

JUSTIFICATION:
[one sentence]`,
  }),
};

export function buildActionPrompt(key: ActionKey, args: BuildArgs): ActionPrompt {
  const fn = ACTION_BUILDERS[key];
  if (!fn) {
    throw new Error(`unknown action key: ${key}`);
  }
  return fn(args);
}

/** Display metadata per action for the toolkit chips + drawer. */
export interface ActionMeta {
  key: ActionKey;
  label: string;
  /** Pathway this action lives under, or "any" for cross-pathway. */
  pathway: S2DItem["pathway"] | "any";
  /** True if this should appear as a default chip on the slot card. */
  primary: boolean;
  /** Short hint shown under the chip. */
  hint?: string;
}

export const ACTION_CATALOG: ActionMeta[] = [
  // quick_reply
  { key: "quick_reply_draft", label: "Draft reply", pathway: "quick_reply", primary: true, hint: "One-shot reply in Sidd's voice" },
  { key: "quick_reply_variants", label: "3 variants", pathway: "quick_reply", primary: true, hint: "Direct / warm / deflecting" },
  { key: "quick_reply_forward", label: "Forward note", pathway: "quick_reply", primary: false },
  // drafted_response
  { key: "drafted_response_outline", label: "Outline first", pathway: "drafted_response", primary: true },
  { key: "drafted_response_prose", label: "Full strawman", pathway: "drafted_response", primary: true },
  { key: "drafted_response_who_waiting", label: "Who's waiting?", pathway: "drafted_response", primary: false },
  // delegated
  { key: "delegated_status_pull", label: "What's moved?", pathway: "delegated", primary: true, hint: "Reads linked sources for movement since handoff" },
  { key: "delegated_check_in", label: "Draft check-in", pathway: "delegated", primary: true },
  // heads_down
  { key: "heads_down_strawman", label: "Strawman draft", pathway: "heads_down", primary: true, hint: "Type-aware first draft" },
  { key: "heads_down_subtasks", label: "Break into subtasks", pathway: "heads_down", primary: true },
  // decision_gate
  { key: "decision_options", label: "Extract options", pathway: "decision_gate", primary: true },
  { key: "decision_tradeoffs", label: "Tradeoff table", pathway: "decision_gate", primary: true },
  // watching
  { key: "watching_nudge", label: "Draft nudge", pathway: "watching", primary: true },
  // cross-pathway
  { key: "retriage", label: "Re-triage", pathway: "any", primary: false, hint: "Suggest a fresh action type + priority" },
];

export function actionsForPathway(pathway: S2DItem["pathway"]): ActionMeta[] {
  return ACTION_CATALOG.filter((a) => a.pathway === pathway || a.pathway === "any");
}
