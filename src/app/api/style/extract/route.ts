import { NextRequest } from "next/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StyleProfile } from "@/types/style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExtractBody {
  samples: string[];
}

/**
 * POST /api/style/extract
 *
 * Given a list of the user's own sent messages, return a structured
 * StyleProfile that downstream prompts can inject as voice guidance.
 *
 * Phase 3 will run this automatically against a Gmail/Slack sync of the
 * user's last 90 days of sent messages. For now the user pastes samples
 * into /settings/style.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as ExtractBody;
  const samples = (body.samples ?? []).map((s) => s.trim()).filter(Boolean);

  if (samples.length < 3) {
    return new Response(
      JSON.stringify({ error: "Need at least 3 sample messages to extract a profile." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const system = `You analyze writing samples to produce a structured profile of the author's communication style.
Return ONLY a valid JSON object — no preamble, no markdown fences, no commentary.
The JSON must conform exactly to the schema described in the user message.`;

  const userMsg = `Here are ${samples.length} messages written by one person (the user). Analyze them and return a JSON object with this exact shape:

{
  "summary": "2–3 sentence description of how this person writes. Be concrete. ≤ 80 words.",
  "voice_traits": ["3 to 6 single adjectives like \\"direct\\", \\"dry\\", \\"warm\\""],
  "length": "very_short" | "short" | "medium" | "long",
  "formality": "casual" | "neutral" | "formal",
  "uses_bullets": boolean,
  "uses_emoji": boolean,
  "uses_dashes": boolean,
  "capitalization": "standard" | "lowercase" | "mixed",
  "typical_greeting": "exact greeting if there's a pattern (e.g. \\"Hey [name]\\", \\"\\" if no greeting)",
  "typical_signoff": "exact signoff if there's a pattern (e.g. \\"thanks\\", first-name signature, \\"\\" if no signoff)",
  "recurring_phrases": ["short phrases or words the author uses repeatedly"],
  "few_shot_examples": [
    { "context": "1-line description of the situation", "message": "verbatim or near-verbatim short excerpt" }
  ]
}

Rules:
- For few_shot_examples, pick 3–5 of the most stylistically representative samples. Keep them under 300 chars each. Anonymize names of people who aren't the author (e.g. "Maya" → "[colleague]") but keep tone, punctuation, capitalization intact.
- Be honest: if the samples don't show a clear pattern for greetings/signoffs/etc., return "" or false.
- Do not invent traits that aren't in the samples.

Samples:
${samples.map((s, i) => `--- Sample ${i + 1} ---\n${s}`).join("\n\n")}`;

  try {
    const resp = await trackedCreate(
      {
        model: MODELS.secondary, // sonnet — fast and plenty good for this
        system,
        messages: [{ role: "user", content: userMsg }],
        max_tokens: 1400,
      },
      "style_extract"
    );

    const text =
      resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";

    // Be defensive — strip code fences if Claude added them despite the rule
    const jsonText = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: Omit<StyleProfile, "extracted_at" | "sample_count" | "model">;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return new Response(
        JSON.stringify({
          error: "Model returned non-JSON output.",
          raw: text.slice(0, 500),
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const profile: StyleProfile = {
      ...parsed,
      extracted_at: new Date().toISOString(),
      sample_count: samples.length,
      model: MODELS.secondary,
    };

    // Persist to user_profile.communication_style. Upsert so multiple
    // extractions in the same user account overwrite cleanly.
    try {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
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
      }
    } catch (err) {
      console.error("[style/extract] persist failed:", err);
      // Non-fatal: client localStorage will still hold the profile.
    }

    return Response.json({ profile });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "extraction failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
