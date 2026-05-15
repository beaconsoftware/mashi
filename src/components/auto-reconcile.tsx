"use client";

import { useEffect } from "react";

/**
 * Background reconcile heartbeat.
 *
 * Fires POST /api/reconcile on dashboard mount and every 30 minutes after,
 * but no more than once per hour overall (tracked in localStorage). So:
 *   - Tab open all day → reconcile every ~30 min, but the throttle keeps it
 *     to once per hour even across reloads.
 *   - Tab closed for 4 hours → next mount fires reconcile within seconds.
 *   - Multiple tabs open → the throttle key makes only one tab actually run.
 *
 * Why client-side (and not a cron job): we're local-only right now. When we
 * deploy this becomes a Vercel Cron / Inngest schedule, and this component
 * gets deleted. Until then, "browser tab + setInterval" is the cheapest
 * possible scheduler.
 *
 * Fire-and-forget: errors are swallowed silently. The Reconcile button in
 * Settings is always the explicit recovery path.
 */
const STORAGE_KEY = "mashi.lastReconcileAt";
const MIN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const TICK_MS = 30 * 60 * 1000; // 30 minutes

export function AutoReconcile() {
  useEffect(() => {
    function maybeFire() {
      try {
        const last = parseInt(localStorage.getItem(STORAGE_KEY) ?? "0", 10);
        if (Date.now() - last < MIN_INTERVAL_MS) return;
        // Stamp BEFORE the request so concurrent tabs don't double-fire.
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
        fetch("/api/reconcile", { method: "POST" }).catch(() => {
          // Reset stamp so a real retry can happen sooner.
          localStorage.removeItem(STORAGE_KEY);
        });
      } catch {
        // localStorage disabled in private mode, etc. — skip silently.
      }
    }

    // Fire on mount, then every 30 min (throttle still gates to 1/hr).
    maybeFire();
    const id = setInterval(maybeFire, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return null;
}
