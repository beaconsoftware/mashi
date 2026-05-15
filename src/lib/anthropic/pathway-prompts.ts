import type { Pathway, S2DItem } from "@/types";

/**
 * Per-pathway prompt templates (spec §9). The S2D co-pilot uses these
 * to produce a tight, pathway-specific suggestion for each item.
 */
export function getPathwayPrompt(
  item: S2DItem,
  pathway: Pathway,
  relatedContext = ""
): string {
  const base = `S2D Task: "${item.title}"
Company: ${item.company?.name ?? "Unknown"}
Source: ${item.source_label ?? "Manual"}
Context: ${item.description ?? "None provided"}
${relatedContext ? `Related context:\n${relatedContext}` : ""}`;

  const prompts: Record<Pathway, string> = {
    quick_reply: `${base}

This is a QUICK REPLY task. Provide:
1. The exact reply to send (2–3 sentences, direct and clear, no preamble)
2. One critical thing to know before sending (1 line only)
Do not use greetings or sign-offs. Be direct.`,
    drafted_response: `${base}

This requires a FULL DRAFTED RESPONSE. Provide:
1. A complete draft reply, professional but not stiff. Sound like a busy product executive.
2. One thing to verify before sending
Format:
DRAFT:
[draft text]
VERIFY: [one line]`,
    meeting_backed: `${base}

This needs to be ADDRESSED IN A MEETING. Provide:
1. Exactly which meeting it belongs in, or when to schedule one (specific day/time)
2. Three sharp talking points to raise (specific, not vague)
3. The concrete decision or outcome to aim for
Be specific. No filler.`,
    heads_down: `${base}

This requires FOCUSED WORK. Provide:
1. Recommended time block (when + exact duration)
2. The very first action to take in the first 15 minutes
3. Top 2 documents/files to open before starting (specific names if known)`,
    decision_gate: `${base}

This is a DECISION GATE. Provide:
1. The precise decision to make (one sentence)
2. Your recommendation with one-line rationale
3. Who to notify of the outcome, and how (Slack/email)
Be direct. Give a real recommendation.`,
    delegated: `${base}

This should be DELEGATED. Provide:
1. Who to delegate to (name or role)
2. A concise delegation message (3 sentences: what, why them, deadline)
3. Follow-up trigger: when to check in if no response`,
    watching: `${base}

This is in WATCH MODE — you've acted, now waiting. Provide:
1. What exactly you're waiting for
2. When to escalate (specific date/trigger)
3. Any action to take right now to speed resolution`,
  };

  return prompts[pathway];
}
