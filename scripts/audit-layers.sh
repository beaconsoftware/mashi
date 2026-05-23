#!/usr/bin/env bash
# audit-layers.sh — scan src/ for hand-picked z-index values that should
# be using the doctrine instead (Tailwind utilities z-ground / z-shell /
# z-chrome / z-dropdown / z-widget / z-focus / z-sidebar / z-modal /
# z-toast, backed by src/lib/layers.ts).
#
# Flags:
#   - className "z-[<number>]" arbitrary-value classes
#   - inline style={{ zIndex: <number> }}
#
# Carve-outs (legitimate local usages — NOT flagged):
#   - src/lib/layers.ts        — the doctrine itself
#   - src/app/globals.css      — utility class definitions
#   - z-(0|10|20|...) Tailwind preset classes when scoped to a local
#     stacking context (sticky headers, sub-component decoration). We
#     don't flag bare z-10 etc. since they're heavily used as local
#     z-index values. The high-blast-radius surfaces (fixed inset-0
#     overlays) all use arbitrary z-[N] or named utilities, so flagging
#     arbitrary values catches the real bugs.
#
# Exit codes:
#   0 — clean
#   1 — violations found
#
# Run via `pnpm run audit:layers`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# rg is faster + ignores .gitignore automatically. Fall back to grep -R
# if rg isn't available (CI containers without ripgrep).
if command -v rg >/dev/null 2>&1; then
  FINDER=(rg --no-heading --line-number --color never -nP)
else
  FINDER=(grep -RnE)
fi

EXCLUDE_FILES=(
  "src/lib/layers.ts"
  "src/app/globals.css"
  "scripts/audit-layers.sh"
  # Carve-outs: components that maintain a SELF-CONTAINED local stack
  # (decorative rings, swipe-deck card stacking). These z values are
  # scoped inside their own stacking context and never collide with the
  # global doctrine. Keep this list short — if a file ends up here just
  # because someone reached for a magic number, fix the file instead.
  "src/components/onboard/sync-step.tsx"
  "src/components/sprint/planner-prioritize-swipe.tsx"
  "src/components/s2d/review-deck.tsx"
  # shadcn-doctrine TODO: this file has a hand-rolled <aside role=dialog>
  # that should be a shadcn <Sheet>. Migration is non-trivial because
  # the side panel lives INSIDE the FocusOverlay portal — shadcn Sheet
  # portals to body by default. Tracked at the callsite. Grandfathered
  # here so the audit can land and catch new violations elsewhere.
  "src/components/sprint/sprint-active-mode-multi.tsx"
  # shadcn-doctrine TODO: one remaining raw <select> for the
  # connection-row company-picker (line ~468). The APIKeyDialog was
  # migrated to shadcn <Dialog> in PR #16; the remaining <select> uses
  # native styling that the bulk Select migration didn't catch (likely
  # rendered inside a row-click container where the Radix Select popover
  # would conflict). Migrate when touching this file again.
  "src/components/settings/connections-manager.tsx"
)

build_exclude_grep() {
  local out=""
  for f in "${EXCLUDE_FILES[@]}"; do
    out+="${f}|"
  done
  echo "${out%|}"
}

EXCLUDE_RE="$(build_exclude_grep)"

violations=0

scan() {
  local pattern="$1"
  local label="$2"
  local hits
  hits=$("${FINDER[@]}" "$pattern" src/ 2>/dev/null \
    | grep -vE "(${EXCLUDE_RE})" || true)
  if [ -n "$hits" ]; then
    echo "=== $label ==="
    echo "$hits"
    echo
    violations=$((violations + 1))
  fi
}

# 1. Arbitrary z-[N] classes anywhere in src/.
scan 'z-\[\d+\]' "Arbitrary z-[N] classes — use z-ground/z-chrome/.../z-toast"

# 2. Inline style with numeric zIndex.
scan 'zIndex\s*:\s*\d+' "Inline numeric zIndex — import Z from @/lib/layers"

# 3. Raw <button> / <input> / <select> / <textarea> outside ui/. The
# shadcn doctrine (AGENTS.md "Component library doctrine") says every
# interactive primitive must come from src/components/ui/. If the
# shadcn version doesn't exist yet, add it via `npx shadcn add`. This
# scan flags the easy escapes — hand-rolled raw HTML buttons styled
# with Tailwind that should be <Button> instead.
shadcn_raw_html() {
  local label="$1"
  local pattern="$2"
  local hits
  hits=$("${FINDER[@]}" "$pattern" src/components 2>/dev/null \
    | grep -v 'src/components/ui/' \
    | grep -vE "(${EXCLUDE_RE})" \
    || true)
  if [ -n "$hits" ]; then
    echo "=== $label — use src/components/ui/* (AGENTS.md: Component library doctrine) ==="
    echo "$hits"
    echo
    violations=$((violations + 1))
  fi
}
# Pattern note: `<tag` must be followed by whitespace, `>`, or
# end-of-line (since JSX commonly writes the tag on its own line
# with attrs on subsequent lines). `[[:space:]>]` alone misses the
# EOL case because POSIX grep doesn't include the line terminator
# in the line content. Group-alternation `([[:space:]>]|$)` covers
# all three. Works in both POSIX grep -E and ripgrep -P.
shadcn_raw_html 'Raw <button> outside ui/' '<button([[:space:]>]|$)'
shadcn_raw_html 'Raw <input> outside ui/' '<input([[:space:]>]|$)'
shadcn_raw_html 'Raw <select> outside ui/' '<select([[:space:]>]|$)'
shadcn_raw_html 'Raw <textarea> outside ui/' '<textarea([[:space:]>]|$)'

# 4. Hand-rolled modal patterns. Anything with `role="dialog"` outside
# ui/ is almost certainly a hand-rolled Dialog/AlertDialog/Sheet/Drawer.
hand_rolled_modal() {
  local hits
  hits=$("${FINDER[@]}" 'role="dialog"' src/components 2>/dev/null \
    | grep -v 'src/components/ui/' \
    | grep -vE "(${EXCLUDE_RE})" \
    || true)
  if [ -n "$hits" ]; then
    echo "=== Hand-rolled modal (role=\"dialog\") outside ui/ — use shadcn Dialog/AlertDialog/Sheet/Drawer ==="
    echo "$hits"
    echo
    violations=$((violations + 1))
  fi
}
hand_rolled_modal

# 5. Unpositioned semantic shell containers. Per the CSS paint-order
# spec, positioned descendants with z-index:0 (e.g. <AmbientGround>'s
# `fixed inset-0 z-ground`) paint AFTER non-positioned block-level
# descendants — so an unpositioned <main>, <aside>, <article> or
# <section> sibling of the ambient layer renders BEHIND it. The fix is
# always `relative` (no z-index needed; DOM order wins). See AGENTS.md
# "Stacking buckets". This catches the regression that bit the sprint
# album-art-over-foreground bug.
#
# False positives: rare. Inline-flow <section>s inside text content
# usually don't matter. If you hit one that's intentional, add the
# file to EXCLUDE_FILES with a comment justifying it.
shell_unpositioned() {
  local hits
  hits=$("${FINDER[@]}" '<(main|aside|article)\s+className="[^"]*"' src/ 2>/dev/null \
    | grep -vE "(${EXCLUDE_RE})" \
    | grep -vE 'className="[^"]*\b(relative|absolute|fixed|sticky)\b' \
    || true)
  if [ -n "$hits" ]; then
    echo "=== Unpositioned <main>/<aside>/<article> — add 'relative' (AGENTS.md: Stacking buckets) ==="
    echo "$hits"
    echo
    violations=$((violations + 1))
  fi
}
shell_unpositioned

if [ "$violations" -gt 0 ]; then
  echo "Layer doctrine violations found. See AGENTS.md 'Layout doctrine'." >&2
  exit 1
fi

echo "audit-layers: clean."
