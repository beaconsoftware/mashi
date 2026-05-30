#!/usr/bin/env bash
# audit-motion.sh: guard the "interactive surfaces are alive by default"
# invariant (AGENTS.md Foundation invariant #6).
#
# Mashi has a motion system: .mashi-magnetic / .mashi-lift / .mashi-press /
# .mashi-glow-focus / .mashi-icon-* utilities, <NavIcon>, and GSAP via
# withMotion() / useMagneticHover() / useGSAP(). The doctrine says a clickable
# thing built with NONE of that is a defect, not a style choice. We shipped the
# agent surface once without it and it read flat next to the rest of the app.
#
# This is a COARSE heuristic gate, in the same spirit as audit-layers and
# audit-translucency: a grep cannot prove smoothness. It catches two concrete,
# low-false-positive things, and the real bar remains the K5 feel-parity review
# (see AGENT_IMPROVEMENT_FINDINGS.md). What it checks:
#
#   1. Banned anti-patterns the doctrine explicitly calls out ("What NOT to
#      do"): hand-rolled hover:scale-* / hover:-translate-* on cards (use
#      .mashi-magnetic / .mashi-lift) and group-hover:rotate-* on icon
#      triggers (use <NavIcon> / .mashi-icon-hover).
#
#   2. Dead interactive files: a file with a clickable handler (onClick= or
#      role="button") that uses NONE of the Mashi motion utilities at all.
#      Incidental motion (animate-spin on a loader, a Radix data-[state]
#      transition, a group-hover: color change) does NOT count, those are
#      free or decorative, not the Mashi liveness system.
#
# Scope: today this enforces on the AGENT SURFACE (src/components/agent +
# src/components/ai-elements), which is the active buildout target. The
# invariant applies app-wide and is reviewer-enforced elsewhere; widen
# SCAN_DIRS as other surfaces adopt the system.
#
# Carve-outs:
#   - A `motion-audit-ok: <reason>` comment (same line, the line above, or a
#     file-wide `motion-audit-ok: file` marker) skips a hit.
#   - EXCLUDE_FILES below grandfathers the pre-buildout dead files. Each entry
#     names the ledger item that will make it alive; remove the entry in that
#     PR once the file adopts the motion system.
#
# Exit codes:
#   0: clean
#   1: violations found
#
# Run via `pnpm run audit:motion`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if command -v rg >/dev/null 2>&1; then
  FINDER=(rg --no-heading --line-number --color never -nP)
  LISTER=(rg --files-with-matches --color never -P)
else
  FINDER=(grep -RnE)
  LISTER=(grep -RlE)
fi

# Surfaces under enforcement. Widen as other areas adopt the system.
SCAN_DIRS=(src/components/agent src/components/ai-elements)

# The Mashi motion system. Incidental motion (animate-spin, data-[state],
# group-hover: color, bare transition-colors) is intentionally NOT here, a
# file must reach for the real system, not a free loader or Radix default.
MOTION_RE='mashi-magnetic|mashi-lift|mashi-press|mashi-glow|mashi-icon|NavIcon|withMotion|useMagneticHover|useDeckCardHover|useSelectBurst|heroEntry|useGSAP'

# A clickable handler. Raw <button>/<input> etc. are already caught by
# audit-layers (shadcn-first doctrine); here we care about onClick on divs /
# rows / cards and explicit role="button".
INTERACTIVE_RE='onClick=|role="button"'

# Pre-buildout dead files. Each is slated to gain real motion in the listed
# ledger item; drop the entry in that PR.
EXCLUDE_FILES=(
  "scripts/audit-motion.sh"
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

# Returns 0 (skip) if the hit `path:lineno:...` is covered by a motion-audit-ok
# marker on the same or preceding line, or a file-wide marker.
is_carved_out() {
  local line="$1"
  echo "$line" | grep -q "motion-audit-ok" && return 0
  local path="${line%%:*}"
  local rest="${line#*:}"
  local lineno="${rest%%:*}"
  grep -q "motion-audit-ok: file" "$path" 2>/dev/null && return 0
  if [ -n "$lineno" ] && [ "$lineno" -gt 1 ] 2>/dev/null; then
    local prev=$((lineno - 1))
    local prevline
    prevline="$(sed -n "${prev}p" "$path" 2>/dev/null || true)"
    echo "$prevline" | grep -q "motion-audit-ok" && return 0
  fi
  return 1
}

# --- Check 1: banned anti-patterns -----------------------------------------
banned() {
  local pattern="$1"
  local label="$2"
  local raw filtered=""
  raw=$("${FINDER[@]}" "$pattern" "${SCAN_DIRS[@]}" 2>/dev/null \
    | grep -vE "(${EXCLUDE_RE})" || true)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    is_carved_out "$line" && continue
    filtered+="${line}
"
  done <<< "$raw"
  if [ -n "${filtered// /}" ] && [ -n "$(printf '%s' "$filtered" | tr -d '[:space:]')" ]; then
    echo "=== $label ==="
    printf "%s" "$filtered"
    echo
    violations=$((violations + 1))
  fi
}

banned 'hover:scale-' \
  'Hand-rolled hover:scale-*, use .mashi-magnetic (rows) or .mashi-lift (cards). AGENTS.md Polish patterns "What NOT to do".'
banned 'hover:-?translate-' \
  'Hand-rolled hover translate, use .mashi-magnetic / .mashi-lift.'
banned 'group-hover:rotate-' \
  'Hand-rolled group-hover:rotate-* on an icon, use <NavIcon> or .mashi-icon-hover.'

# K3 performance budget: agent-surface motion is transform/opacity only (and
# the grid-rows / clip technique for expand). Animating a layout-triggering
# property (height/width/box-offsets/margin/padding) forces per-frame layout
# and janks; use translate/scale or grid-template-rows instead. This catches
# the Tailwind arbitrary-transition idiom (transition-[height], etc.) and the
# tailwindcss-animate height-collapse keyframes. Carve out with
# `// motion-audit-ok: <reason>` if a one-off truly needs it.
banned 'transition-\[(height|width|top|bottom|left|right|inset|margin|padding|max-height|max-width)' \
  'Animated layout property (K3 performance budget), use transform (translate/scale) or the grid-template-rows expand trick, never animate layout. AGENTS.md Motion doctrine.'
banned 'animate-collapsible-' \
  'tailwindcss-animate height collapse (K3 performance budget), expand via transform/opacity or grid-template-rows, not animated height.'

# --- Check 2: dead interactive files ---------------------------------------
# A file with a clickable handler that uses none of the Mashi motion system.
dead_interactive() {
  local candidates
  candidates=$("${LISTER[@]}" "$INTERACTIVE_RE" "${SCAN_DIRS[@]}" 2>/dev/null \
    | grep -vE "(${EXCLUDE_RE})" || true)
  local hits=""
  for f in $candidates; do
    grep -qE "$MOTION_RE" "$f" && continue            # uses the system: fine
    grep -q "motion-audit-ok" "$f" && continue        # file-level carve-out
    hits+="$f"$'\n'
  done
  if [ -n "${hits// /}" ] && [ -n "$(printf '%s' "$hits" | tr -d '[:space:]')" ]; then
    echo "=== Dead interactive file: has onClick/role=button but no Mashi motion utility (.mashi-*, <NavIcon>, withMotion, useGSAP). Make it alive or add // motion-audit-ok: <reason>. ==="
    printf "%s" "$hits"
    echo
    violations=$((violations + 1))
  fi
}
dead_interactive

if [ "$violations" -gt 0 ]; then
  echo "Motion/liveness doctrine violations found. See AGENTS.md Foundation invariant #6 + 'Polish patterns'. A grep can't prove smoothness; the real bar is the K5 feel-parity review." >&2
  exit 1
fi

echo "audit-motion: clean."
