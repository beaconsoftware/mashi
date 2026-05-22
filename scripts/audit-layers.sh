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

if [ "$violations" -gt 0 ]; then
  echo "Layer doctrine violations found. See AGENTS.md 'Layout doctrine'." >&2
  exit 1
fi

echo "audit-layers: clean."
