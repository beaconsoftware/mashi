/**
 * Mashi layout doctrine — the single source of truth for z-index.
 *
 * Use these constants whenever you need to set a stacking order. Do NOT
 * hand-pick numbers like `z-[103]` inline. Every layer collision we've
 * shipped came from someone reaching for a fresh number and clashing
 * with another surface that nobody remembered was there.
 *
 * Layer order (low → high):
 *
 *   GROUND (0)         — ambient album-art bg, vignettes, decorative blur.
 *                        Anything that paints behind every UI surface.
 *   SHELL (10)         — the AppShell wrapper. Creates the app's main
 *                        positioned context so child stacking is sane.
 *   PAGE_CHROME (40)   — TopBar, SprintBar, S2DFilters chip row,
 *                        BoardToolbar. Translucent strips at the edges
 *                        of pages that need their own stacking context
 *                        (because backdrop-blur creates one) AND need to
 *                        sit above page content.
 *   DROPDOWN (50)      — queue dropdown on the Spotify player,
 *                        popovers, tooltips, select menus.
 *   WIDGET (90)        — SprintWidget floating chip and other always-on
 *                        floating affordances. Below focus overlays so
 *                        a sprint takeover can cover them.
 *   FOCUS_OVERLAY (100) — sprint takeover and future focus modes. Pure
 *                        translucent fullscreen surfaces.
 *   SIDEBAR (110)      — sidebar. ALWAYS above focus overlays so the
 *                        global nav stays usable even mid-sprint. Never
 *                        override this; the nav has to remain reachable.
 *   MODAL (150)        — SpotlightModal, confirm dialogs, sheet
 *                        backdrops. Above everything except toasts.
 *   TOAST (200)        — notifications and error banners. Highest layer
 *                        so a critical error can always reach the user.
 *
 * Pair this with the surface primitives in
 * `src/components/layout/primitives.tsx`. If you find yourself reaching
 * for a constant directly in a component, check whether one of those
 * primitives already wraps the pattern you need (`<ChromeBar>` for
 * translucent edge bars, `<FocusOverlay>` for fullscreen takeovers,
 * `<AmbientGround>` for the ambient layer).
 */
export const Z = {
  GROUND: 0,
  SHELL: 10,
  PAGE_CHROME: 40,
  DROPDOWN: 50,
  WIDGET: 90,
  FOCUS_OVERLAY: 100,
  SIDEBAR: 110,
  MODAL: 150,
  TOAST: 200,
} as const;

export type ZLayer = (typeof Z)[keyof typeof Z];
