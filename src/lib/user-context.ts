import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Shared user-identity helper. Fetches the row in `user_profile` for
 * the given auth user id and returns just the bits LLM prompts /
 * UI strings need.
 *
 * Falls back to defaults when no row is found OR fields are missing
 * so prompts still build, just without personalization. NEVER hardcodes
 * "Sidd" or any single user's identity into a default.
 *
 * Call this server-side (in API routes) before building any LLM prompt
 * that addresses the user by name, and pass the result into prompt
 * builders via PromptContext.
 */
export interface UserContext {
  /** First-name display label (e.g. "Vivek"). */
  firstName: string;
  /** Full display name from user_profile.name. */
  fullName: string;
  /** IANA timezone, e.g. "America/Toronto". */
  timezone: string;
  email: string | null;
}

const FALLBACK: UserContext = {
  firstName: "there",
  fullName: "there",
  timezone: "America/Toronto",
  email: null,
};

export async function getUserContext(userId: string): Promise<UserContext> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("user_profile")
    .select("name, email, timezone")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return FALLBACK;

  const fullName = data.name?.trim() || "there";
  // First word of "First Last" or "First", whichever is shorter.
  const firstName = fullName.split(/\s+/)[0] || fullName;

  return {
    firstName,
    fullName,
    timezone: data.timezone || FALLBACK.timezone,
    email: data.email,
  };
}
