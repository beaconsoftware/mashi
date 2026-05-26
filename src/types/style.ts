/**
 * StyleProfile — the structured shape Claude extracts from a batch of the
 * user's own sent messages. We inject the summary text + a few examples
 * into the system prompt for every draft / chat call so output sounds like
 * the user, not a generic exec voice.
 *
 * When Supabase is wired (Phase 2), this goes into user_profile.communication_style.
 */
export interface StyleProfile {
  /** Short paragraph describing the voice (≤ 80 words). */
  summary: string;

  /** Three to six adjectives — "direct", "dry", "warm", "blunt"… */
  voice_traits: string[];

  length: "very_short" | "short" | "medium" | "long";
  formality: "casual" | "neutral" | "formal";

  /** Behavior signals (presence/absence). */
  uses_bullets: boolean;
  uses_emoji: boolean;
  /**
   * @deprecated The em / en dash ban is unconditional — we never produce
   * dashes regardless of what the user's profile shows. Field stays on the
   * type so existing extracted rows continue to deserialize, but it is no
   * longer surfaced to any system prompt and should not be read by new code.
   */
  uses_dashes: boolean;
  capitalization: "standard" | "lowercase" | "mixed";

  typical_greeting: string;
  typical_signoff: string;

  /** Words / phrases the user reaches for repeatedly. */
  recurring_phrases: string[];

  /** Three to five short anonymized samples Claude can imitate as few-shots. */
  few_shot_examples: Array<{ context: string; message: string }>;

  /** Provenance. */
  extracted_at: string; // ISO timestamp
  sample_count: number;
  model: string;
}
