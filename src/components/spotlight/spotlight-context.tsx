"use client";

/**
 * Global open/close state for the ⌘K spotlight modal, plus the
 * keyboard listener that intercepts ⌘K / Ctrl+K from anywhere in
 * the app. Mounted once at the app-shell level.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface SpotlightCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

const Ctx = createContext<SpotlightCtx | null>(null);

export function SpotlightProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K (mac) / Ctrl+K (everyone else). Don't fire when the user is
      // already in an input that uses it (browser address bar handles
      // its own key — we only see the event if focus is in the app).
      const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isModK) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <Ctx.Provider value={{ open, setOpen, toggle }}>{children}</Ctx.Provider>;
}

export function useSpotlightModal() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSpotlightModal must be used inside SpotlightProvider");
  return v;
}
