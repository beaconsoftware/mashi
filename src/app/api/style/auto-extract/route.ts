import { NextResponse } from "next/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { collectWritingSamples } from "@/lib/style/sample-collector";
import type { StyleProfile } from "@/types/style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/style/auto-extract
 *
 * Pulls representative writing samples from the user's connected Gmail
 * (sent) + Slack (their own DMs) accounts, runs Claude extraction, and
 * saves the profile to user_profile.communication_style.
 *
 * No manual paste needed — works off the live OAuth-authorized data.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  // 1) Collect samples
  const collect = await collectWritingSamples({ userId: user.id, target: 25 });

  if (collect.samples.length < 5) {
    return NextResponse.json(
      {
        error:
          "Couldn't gather enough writing samples. Make sure Gmail and/or Slack are connected and synced.",
        details: collect.perAccount,
      },
      { status: 400 }
    );
  }

  // 2) Extract — reuse the same Sonnet prompt as the paste-based extractor
  const system = `You analyze writing samples to produce a structured profile of the author's communication style.
Return ONLY a valid JSON object — no preamble, no markdown fences, no commentary.
The JSON must conform exactly to the schema described in the user message.`;

  const userMsg = `Here are ${collect.samples.length} messages written by one person (the user — Sidd, product/M&A lead at Beacon Software, a PE holdco). Analyze them and return a JSON object with this exact shape:

{
  "summary": "2–3 sentence description of how this person writes. Be concrete. ≤ 80 words.",
  "voice_traits": ["3 to 6 single adjectives like \\"direct\\", \\"dry\\", \\"warm\\""],
  "length": "very_short" | "short" | "medium" | "long",
  "formality": "casual" | "neutral" | "formal",
  "uses_bullets": boolean,
  "uses_emoji": boolean,
  "uses_dashes": boolean,
  "capitalization": "standard" | "lowercase" | "mixed",
  "typical_greeting": "exact greeting pattern if there is one (e.g. \\"Hey [name]\\"), or \\"\\" if none",
  "typical_signoff": "exact signoff pattern if there is one, or \\"\\" if none",
  "recurring_phrases": ["short phrases or vocabulary the author uses repeatedly"],
  "few_shot_examples": [
    { "context": "1-line description of the situation", "message": "verbatim or near-verbatim short excerpt" }
  ]
}

Rules:
- Pick 3–5 of the most stylistically representative samples for few_shot_examples. Under 300 chars each. Anonymize other people's names (Maya → "[colleague]") but preserve tone, punctuation, capitalization exactly.
- If samples don't show a clear pattern for greetings/signoffs, return "" or false. Don't invent.
- Slack and email may show different registers — your summary should describe the predominant style across both.

Samples (from Gmail sent + Slack DMs over the last 30 days):
${collect.samples.map((s, i) => `--- Sample ${i + 1} ---\n${s}`).join("\n\n")}`;

  let parsed: Omit<StyleProfile, "extracted_at" | "sample_count" | "model"> | null = null;
  try {
    const resp = await trackedCreate(
      {
        model: MODELS.secondary,
        system,
        messages: [{ role: "user", content: userMsg }],
        max_tokens: 1500,
      },
      "style_auto_extract"
    );
    const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Style extraction failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  const profile: StyleProfile = {
    ...parsed!,
    extracted_at: new Date().toISOString(),
    sample_count: collect.samples.length,
    model: MODELS.secondary,
  };

  // 3) Persist to user_profile
  try {
    const { data: existing } = await supabase
      .from("user_profile")
      .select("id")
      .maybeSingle();
    if (existing) {
      await supabase
        .from("user_profile")
        .update({ communication_style: profile })
        .eq("id", existing.id);
    } else {
      await supabase.from("user_profile").insert({
        email: user.email,
        communication_style: profile,
      });
    }
  } catch (err) {
    console.error("[style/auto-extract] persist failed:", err);
  }

  return NextResponse.json({
    profile,
    sources: collect.perSource,
    perAccount: collect.perAccount,
  });
}
