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
  # that should be a shadcn <Sheet>. Blocker: the side panel is
  # ABSOLUTE-positioned inside the FocusOverlay portal so it only covers
  # the focus area, not the sidebar. shadcn Sheet uses `fixed` + portals
  # to body, which would cover the sidebar (MODAL=150 > SIDEBAR=110) and
  # break the "sidebar always reachable" rule. Migration needs a new
  # <InOverlaySheet> primitive that wraps Radix Dialog with container=
  # focusOverlayRef + absolute positioning. Tracked at the callsite.
  "src/components/sprint/sprint-active-mode-multi.tsx"
  # shadcn-doctrine TODO (PR 2 of 3 — Select migration): every entry
  # below has at least one raw <select> styled with Tailwind. Migrating
  # to shadcn <Select> is non-trivial (different API: onValueChange not
  # onChange, requires SelectTrigger/SelectContent/SelectItem children,
  # popover-based instead of native dropdown — visual + interaction
  # change per page). Tracked as a follow-up PR. Each entry leaves the
  # audit clean today so the regex fix can land and catch any NEW raw
  # primitives going forward.
  "src/components/inbox/inbox-view.tsx"
  "src/components/linear/linear-view.tsx"
  "src/components/notes/notes-view.tsx"
  # Note: ApiKeyDialog already migrated to shadcn <Dialog>. The remaining
  # violation is a raw <select> in the company-picker (line ~468) —
  # tracked as part of the Select migration above.
  "src/components/settings/connections-manager.tsx"
  "src/components/sprint/planner-prioritize-list.tsx"
  "src/components/sprint/planner-review.tsx"
  "src/components/sprint/sprint-complete.tsx"
  "src/components/s2d/s2d-column.tsx"
  "src/components/s2d/review-column.tsx"
  # shadcn-doctrine TODO (also PR 2): hand-rolled checkbox <input
  # type="checkbox"> and range <input type="range">. shadcn <Checkbox>
  # and <Slider> aren't in ui/ yet — needs `npx shadcn add checkbox
  # slider`. Migrations:
  #   - <input type="checkbox"> → <Checkbox> (onChange → onCheckedChange,
  #     click-stopPropagation interaction needs verification per callsite)
  #   - <input type="range"> → <Slider> (value is an array, onValueChange
  #     not onChange; visual is a different control)
  "src/components/s2d/s2d-board.tsx"
  "src/components/sprint/spotify-player.tsx"
  "src/components/sprint/planner-prioritize.tsx"
  "src/components/sprint/planner-prioritize-board.tsx"
  # shadcn-doctrine TODO (PR 2): two collapsible-disclosure <button>s
  # for expandable sections. Right primitive is shadcn <Collapsible> +
  # CollapsibleTrigger (`npx shadcn add collapsible`). Migration is a
  # structural change — Trigger handles state via Radix, not local
  # useState. Worth doing as part of the Select/Checkbox PR.
  "src/components/s2d/item-context-panel.tsx"
  # shadcn-doctrine TODO (PR 2): bulk legacy raw <button> grandfather.
  # All these files have multi-line JSX buttons that the previous audit
  # regex missed. They generally fall into a few categories:
  #   - Icon-only / ghost buttons → should be <Button variant="ghost">
  #     with size="icon" and an aria-label.
  #   - Collapsible disclosure triggers → shadcn <Collapsible>.
  #   - Custom dropdown / popover triggers → shadcn <Popover> /
  #     <DropdownMenu>.
  #   - Tab-strip buttons → shadcn <Tabs>.
  # Plan: PR 2 migrates these file-by-file, removing entries from this
  # list as each lands clean. Grandfathered here so the new regex can
  # enforce against NEW violations going forward.
  "src/components/calendar/calendar-view.tsx"
  "src/components/chat/chat-panel.tsx"
  "src/components/home/home-cockpit.tsx"
  "src/components/home/home-tiles.tsx"
  "src/components/layout/notification-hub.tsx"
  "src/components/layout/sidebar.tsx"
  "src/components/layout/sync-status-bar.tsx"
  "src/components/layout/sync-status-chip.tsx"
  "src/components/onboard/onboarding-shell.tsx"
  "src/components/onboard/portcos-step.tsx"
  "src/components/s2d/s2d-filters.tsx"
  "src/components/s2d/s2d-item-sheet.tsx"
  "src/components/settings/api-tokens-manager.tsx"
  "src/components/settings/slack-channel-picker.tsx"
  "src/components/settings/usage-view.tsx"
  "src/components/spotlight/spotlight-trigger.tsx"
  "src/components/sprint/planner-prioritize-shell.tsx"
  "src/components/sprint/planner-schedule.tsx"
  "src/components/sprint/sprint-active-mode.tsx"
  "src/components/sprint/sprint-context-package.tsx"
  "src/components/sprint/sprint-item-context.tsx"
  "src/components/sprint/sprint-toolkit.tsx"
  "src/components/sprint/sprint-widget.tsx"
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
