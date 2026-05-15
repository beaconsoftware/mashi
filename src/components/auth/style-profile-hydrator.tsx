"use client";

import { useEffect } from "react";
import { useUserProfileStore } from "@/store/user-profile-store";
import type { StyleProfile } from "@/types/style";

/**
 * Hydrate the client-side style profile store from the server-fetched
 * row (user_profile.communication_style). Runs once on dashboard mount.
 *
 * Server is the source of truth — localStorage is a cache.
 */
export function StyleProfileHydrator({ initial }: { initial: StyleProfile | null }) {
  const setStyleProfile = useUserProfileStore((s) => s.setStyleProfile);

  useEffect(() => {
    setStyleProfile(initial);
  }, [initial, setStyleProfile]);

  return null;
}
