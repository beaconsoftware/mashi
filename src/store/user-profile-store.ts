"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StyleProfile } from "@/types/style";

interface UserProfileState {
  styleProfile: StyleProfile | null;
  setStyleProfile: (p: StyleProfile | null) => void;
}

/**
 * Persists the user's communication-style profile to localStorage so the
 * chat panel and S2D co-pilot can attach it to every request. Phase 2 will
 * sync this to user_profile.communication_style in Supabase.
 */
export const useUserProfileStore = create<UserProfileState>()(
  persist(
    (set) => ({
      styleProfile: null,
      setStyleProfile: (p) => set({ styleProfile: p }),
    }),
    { name: "mashi:user-profile" }
  )
);
