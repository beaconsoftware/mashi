import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Model strategy (spec §9):
 * - primary   → S2D co-pilot, sprint planning, daily briefing, meeting prep
 * - secondary → message triage, meeting summaries, action-item extraction
 * - fast      → classification (company detection, pathway suggestion)
 */
export const MODELS = {
  primary: "claude-opus-4-7",
  secondary: "claude-sonnet-4-6",
  fast: "claude-haiku-4-5-20251001",
} as const;
