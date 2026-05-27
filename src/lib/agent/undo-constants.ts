/**
 * Client-safe undo constants. Lives separately from `undo.ts` (which
 * imports the Supabase service client and therefore `next/headers`) so
 * the UndoStrip client component can read the window length without
 * pulling server-only code into the browser bundle.
 */
export const UNDO_WINDOW_MS = 30_000;
