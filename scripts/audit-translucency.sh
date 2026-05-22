#!/usr/bin/env bash
# audit-translucency.sh — guard the sanctioned opacity scale.
#
# Every translucent surface in Mashi MUST use one of the doctrine steps
# (/15, /40, /55, /60, /80, /95). Off-scale values quickly accumulate
# until "translucent" stops meaning anything visually — a `bg-card/30`
# next to a `bg-card/25` next to a `bg-card/35` is just noise and
# guarantees that some surface will be invisible against the ambient
# album-art layer.
#
# Flags:
#   - bg-(background|card|secondary|primary|accent|muted)/<N> where N
#     is not in the sanctioned set
#
# Carve-outs:
#   - Lines containing `translucency-audit-ok` are skipped. Add a
#     one-line JSDoc / inline comment when you have a legitimate
#     off-scale value (e.g. a one-off effect that can't be expressed
#     within the scale).
#
# Exit codes:
#   0 — clean
#   1 — violations found
#
# Run via `pnpm run audit:translucency`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if command -v rg >/dev/null 2>&1; then
  FINDER=(rg --no-heading --line-number --color never -nP)
else
  FINDER=(grep -RnE)
fi

# Sanctioned opacity steps. Keep in sync with AGENTS.md "Design tokens".
ALLOWED="15|40|55|60|80|95"

# Find every `bg-(token)/N` usage in src/. Output format from rg / grep is
# `path:lineno:linetext`. We need to also peek at the IMMEDIATELY PRECEDING
# line of source — JSX className strings can't contain inline JS comments,
# so the canonical carve-out for an off-scale color is a `// translucency-
# audit-ok: <reason>` comment on the line ABOVE the className.
#
# A file-wide carve-out is also supported: any file that contains
# `translucency-audit-ok: file` (e.g. as a top-of-file JSDoc comment) is
# skipped entirely. Reserve this for legacy modules that are slated for
# migration but shouldn't block PRs in the meantime.
hits="$("${FINDER[@]}" 'bg-(background|card|secondary|primary|accent|muted)/(\d+)' src/ 2>/dev/null || true)"

# Filter:
#   - drop lines containing the marker
#   - drop lines whose preceding line contains the marker
#   - drop lines where every match's denominator is in ALLOWED
violations=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  # Skip explicit same-line carve-outs.
  if echo "$line" | grep -q "translucency-audit-ok"; then
    continue
  fi
  # Skip if the preceding source line carries the marker. The match has
  # the format `path:N:linetext` — we read the file and check line N-1.
  path="${line%%:*}"
  rest="${line#*:}"
  lineno="${rest%%:*}"
  # File-wide skip: top-of-file marker covers every match in the file.
  if grep -q "translucency-audit-ok: file" "$path" 2>/dev/null; then
    continue
  fi
  if [ -n "$lineno" ] && [ "$lineno" -gt 1 ] 2>/dev/null; then
    prev=$((lineno - 1))
    prevline="$(sed -n "${prev}p" "$path" 2>/dev/null || true)"
    if echo "$prevline" | grep -q "translucency-audit-ok"; then
      continue
    fi
  fi
  # Extract every bg-*/N denominator on the line; if any are not in the
  # allow-list, the line is a violation.
  bad=0
  while IFS= read -r n; do
    [ -z "$n" ] && continue
    if ! echo "$n" | grep -qE "^(${ALLOWED})$"; then
      bad=1
      break
    fi
  done < <(echo "$line" | grep -oE 'bg-(background|card|secondary|primary|accent|muted)/[0-9]+' | sed -E 's|.*/||')
  if [ "$bad" -eq 1 ]; then
    violations="${violations}${line}
"
  fi
done <<< "$hits"

if [ -n "${violations:-}" ]; then
  echo "=== Off-scale translucent surfaces — allowed steps: /${ALLOWED//|//}, or tag the line with // translucency-audit-ok: reason ==="
  printf "%s" "$violations"
  echo
  echo "Translucency doctrine violations found. See AGENTS.md 'Design tokens'." >&2
  exit 1
fi

echo "audit-translucency: clean."
