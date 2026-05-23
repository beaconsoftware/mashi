<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Mashi engineering conventions

Centralized doc for code conventions, gotchas, and invariants. Read before
writing code or running migrations. Ops/infra guidance lives in
[`DEPLOY.md`](DEPLOY.md); this file is for the codebase.

## Stack

- **Next.js 16** (App Router, Turbopack dev server, React 19, React Compiler lints on).
- **pnpm** — never `npm install`; lockfile is `pnpm-lock.yaml`. CI uses `--frozen-lockfile`.
- **Supabase** for DB + Auth + Storage. Production is `akpbzaivscqvaoapkdwd.supabase.co`; local is Docker (`supabase status` to verify).
- **Anthropic SDK** for all LLM calls. Always route through `trackedCreate` / `trackedStream` in `src/lib/anthropic/tracked.ts` so usage gets logged.
- **GSAP** for animation, via `@gsap/react` `useGSAP` hook.
- **TanStack Query** for client data, **Zustand** for transient UI state.
- **dnd-kit** for drag-and-drop on the S2D board.

## Multi-tenancy invariants

Every data table has a `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL DEFAULT auth.uid()`. RLS policy on every table is owner-only: `auth.uid() = user_id` for both `USING` and `WITH CHECK`.

**Hard rules**:

1. Every `INSERT` or `UPSERT` from a **service-role** code path (anywhere using `createSupabaseServiceClient`) must set `user_id` explicitly. The DB default of `auth.uid()` resolves to NULL under service-role and the `NOT NULL` will reject the write.
2. **Service-role bypasses RLS.** Audit every new service-role code path to confirm it scopes by `user_id`. Cross-user reads are intentional only for system jobs (consolidate, propagate, ai-staleness, bundle-meetings); everything else must filter by the current user.
3. Sync paths thread `conn.user_id` from `connected_accounts` into every child row (messages, meetings, calendar_events, linear_issues). See `src/lib/sync/*-sync.ts` for the pattern.

## Trigger function discipline

PG functions attached to `auth.users` triggers (or any function GoTrue might invoke) **must**:

```sql
CREATE OR REPLACE FUNCTION public.<name>()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp   -- mandatory
AS $$
BEGIN
  -- Bypass RLS if writing to a table with auth.uid()-based policy.
  -- auth.uid() is NULL inside trigger context, so WITH CHECK rejects.
  SET LOCAL row_security = off;

  INSERT INTO public.target_table (...)   -- always schema-qualify
  VALUES (...);
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.<name>() TO supabase_auth_admin, anon, authenticated, service_role;
```

Skipping any of these = "Database error saving new user" surfaced from GoTrue with no detail. We hit this. Don't again.

## Migration patterns

- **Additive only.** Never drop columns; never rewrite history. Use new sequentially-numbered migrations. The CI workflow auto-applies on push to `main`, so a destructive migration ships the moment it lands.
- **Idempotent.** Use `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP TRIGGER IF EXISTS`. Migrations may be re-applied (the CI re-runs `supabase db push` on every push, even if no new migrations — it's a no-op when there's nothing new).
- **Robust to autocommit.** Don't rely on `set_config(..., true)` (transaction-local) — the runner may autocommit each statement. Inline subqueries against `auth.users` if you need a primordial user (`SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1`).
- **Works on empty + populated DBs.** Pre-flight checks should be `RAISE NOTICE`, never `EXCEPTION`, unless truly fatal. See `012_multi_tenant_rls.sql` for the pattern.

### How migrations actually deploy

```
You add 013_foo.sql to supabase/migrations/
   ↓ git push origin main
.github/workflows/migrate.yml fires (path filter on supabase/migrations/**)
   ↓ supabase link --project-ref akpbzaivscqvaoapkdwd
   ↓ supabase db push  (checks supabase_migrations.schema_migrations,
                        applies only versions not already recorded)
   ↓ NOTIFY pgrst, 'reload schema'  (so new columns are queryable right away)
   ↓
Vercel deploys the code (gated on this workflow passing, via the
"Wait for CI" project setting)
```

The `schema_migrations` table is the source of truth for what's applied where. If you ever need to know whether prod has a specific migration, query it directly.

### Manual override
You can always still apply by hand: `supabase db push --linked` from this dir, or paste SQL into the Dashboard editor. The CI is the default path; manual works for emergencies or one-offs.

## Don't touch lightly

- **`012_multi_tenant_rls.sql`** — the trigger functions and grants are load-bearing for sign-up. Layer changes via new migrations.
- **`src/middleware.ts`** — auth gate + onboarding gate + path whitelist live here. Order matters.
- **`src/lib/triage/orchestrator.ts`** — `applyOperation` runs the dedup gate, mutation, and audit log atomically. The order of checks (close → update → create) is intentional.

## GSAP gotchas

**GSAP cannot interpolate boxShadow values containing CSS custom properties.** A tween like:

```ts
// ❌ FAILS with "a is null" — gsap parser chokes on hsl(var(--*))
gsap.to(el, { boxShadow: "0 0 32px hsl(var(--primary) / 0.6)" });
```

Workaround: apply the shadow imperatively via the DOM style, animate only transform properties through GSAP:

```ts
// ✅ Works
el.style.transition = "box-shadow 0.2s ease-out";
el.style.boxShadow = "0 0 32px hsl(var(--primary) / 0.6)";
gsap.to(el, { y: -2, scale: 1.01, duration: 0.2 });
```

See `src/lib/animation/interactions.ts` for the canonical `useMagneticHover` pattern.

Other rules:
- Always wrap with `withMotion(() => ...)` from `src/lib/animation/index.ts` so users with `prefers-reduced-motion: reduce` get no animation.
- Use `useGSAP` from `@gsap/react` with a `scope` ref for auto-cleanup.

## Layout doctrine

We had ~6 layout regressions in a single session, all from the same shape:
fresh feature picks a fresh z-index, collides with another surface nobody
remembered was there. Fix is structural: one z-scale, named utilities,
shared primitives, single overlay portal. Reach for the primitives FIRST
before hand-rolling chrome / overlay / background CSS.

### Z-scale (src/lib/layers.ts)

| Layer          | Value | Tailwind class | Meaning |
|----------------|------:|----------------|---------|
| GROUND         |     0 | `z-ground`     | Ambient bg, vignettes, decorative blur |
| SHELL          |    10 | `z-shell`      | The AppShell wrapper, creates the main positioned context |
| PAGE_CHROME    |    40 | `z-chrome`     | TopBar, SprintBar, S2DFilters, BoardToolbar |
| DROPDOWN       |    50 | `z-dropdown`   | Popovers, tooltips, select menus, queue dropdown |
| WIDGET         |    90 | `z-widget`     | SprintWidget chip, chat summon pill |
| FOCUS_OVERLAY  |   100 | `z-focus`      | Sprint takeover, planner review deck, future focus modes |
| SIDEBAR        |   110 | `z-sidebar`    | Sidebar — ALWAYS above focus overlays |
| MODAL          |   150 | `z-modal`      | Spotlight, confirms, sheets (Dialog overlays) |
| TOAST          |   200 | `z-toast`      | Notifications, error banners — highest |

Use the utility class (`className="... z-chrome"`). The numeric constant
is also exported as `Z.PAGE_CHROME` for `style={{ zIndex: Z.PAGE_CHROME }}`
when you can't reach a class (rare). DO NOT hand-pick `z-[103]` etc.;
`pnpm audit:layers` will fail.

Local sub-component micro-stacks (sticky calendar headers, swipe-deck
card depth, decorative rings inside an onboarding step) use bare Tailwind
`z-10` / `z-20` / `-z-10` against their OWN stacking context. Those don't
collide with the global doctrine and don't need migrating. The audit
script carves out the few files that legitimately do this.

### Stacking-context gotchas

These properties create a new stacking context — child z-indexes are
local to it, not absolute:

- `backdrop-filter` (any value, including `backdrop-blur-sm`)
- `filter`, `mix-blend-mode`, `transform`, `opacity` `< 1`
- explicit `position: relative` + an explicit `z-index`

This is WHY TopBar's `backdrop-blur-sm` originally broke its dropdown's
`z-50`: the bar created a context, child z values resolved within it,
and the next sibling row painted on top regardless. Fix: give the
parent an explicit z-class (`z-chrome`) so its whole stacking context
is lifted, not just its inline contents. The `<ChromeBar>` primitive
bakes this in — use it instead of hand-rolling.

### Stacking buckets — z-index is not enough

The doctrine declares `GROUND = 0 < SHELL = 10 < PAGE_CHROME = 40` etc.
True on paper, but CSS painting order doesn't compare z-index numbers
first — it compares **stacking buckets**, defined by the CSS 2.1
painting-order spec:

  1. The stacking context root background
  2. Negative-z descendants
  3. **Non-positioned block-level descendants** (in DOM order)
  4. Non-positioned floats
  5. Non-positioned inlines
  6. **Positioned descendants with `z-index: 0` / `auto`** (in DOM order)
  7. Positioned descendants with positive z-index (sorted by z)

Bucket 6 paints AFTER bucket 3. So an `<AmbientGround>`
(`fixed inset-0 z-ground`, z:0 — positioned, bucket 6) WILL paint on
top of an unpositioned `<main>` (bucket 3) even though z-ground numerically
equals what `<main>` would resolve to. This bit us on /sprint
(and every dashboard route once Spotify ambient mounted): page content
was rendered, then album art painted over it.

**Rule: every shell-level container that sibling-stacks with the ambient
must be `position: relative` (no z-index needed — DOM order wins inside
bucket 6).** Today that means `<header>`, `<aside>` (sidebar), `<main>`,
ChatPanel root, and any future fullscreen sibling of `<AmbientGround>`.
`<header>` and Sidebar were already positioned via `z-chrome` /
`z-sidebar`; `<main>` was the one missing it.

`pnpm audit:layers` greps for unpositioned `<main>` / `<aside>` /
`<article>` to catch new offenders. If you legitimately want an inline
`<section>` that doesn't need positioning, it's not flagged — only the
shell-level semantic containers are.

### Single overlay portal

AppShell mounts `<OverlayRoot />` once. Anything that wants to be a
full-screen takeover (sprint focus mode, sprint complete recap when
shown from a non-/sprint route) renders via `<FocusOverlay>` which
`createPortal`s into that anchor.

Why: previously the `/sprint` page renderer AND the `SprintGlobalMount`
both rendered `<SprintComplete />` when a sprint ended on /sprint.
Both copies fired the `POST /api/sprint/session` + `exitSprint()`
side-effects and raced — the recap flashed and disappeared. The portal
+ "global mount never renders an overlay on /sprint" rule structurally
prevents the dup. SprintGlobalMount is a router; it never renders an
overlay directly on a page that already owns one.

Rule: if you add a new fullscreen focus surface, use `<FocusOverlay>`.
If you find yourself rendering the same component from both a per-page
location and `SprintGlobalMount` (or a future global mount), STOP — one
owner.

### Sidebar is always-on-top of focus

`<Sidebar>` lives at `z-sidebar` (110), ABOVE focus overlays (100).
This is intentional: a sprint takeover should cover page content, but
the user must still be able to bail to another nav target without
keyboard-shortcut acrobatics. Never override `z-sidebar` to a lower
value. If you need something above the sidebar, it should be at
`z-modal` (150) or higher.

### Primitives (src/components/layout/primitives.tsx)

- `<ChromeBar>` — translucent edge bar with the canonical bg + blur +
  z-chrome + relative. Use for TopBar, SprintBar, S2DFilters, board
  toolbar. Optional `as` prop for semantic element (`header`, `nav`).
- `<AmbientGround>` — fixed inset-0 ground layer with GPU compositing
  hints. Must live INSIDE AppShell's wrapper or backdrop-filter from
  translucent surfaces above won't be able to sample it.
- `<FocusOverlay>` — fullscreen takeover. Portals to `#mashi-overlay-root`.
  Bakes in z-focus + the translucent dim + backdrop-blur shell.
- `<OverlayRoot>` — the single portal anchor. Mounted once in AppShell.

### Audit

`pnpm audit:layers` greps for arbitrary `z-[N]` classes and inline
numeric `zIndex` outside the doctrine. Runs as part of `pnpm verify`.
If you have a legitimate carve-out (a self-contained local stack), add
the file to the EXCLUDE list in `scripts/audit-layers.sh` and document
why.

## Design tokens

The layout doctrine controls z-ordering and surface primitives. Design
tokens control everything else — spacing, radius, opacity, type, motion.
Same intent: one sanctioned scale per dimension so future features can't
quietly drift into "every page looks subtly different".

### Spacing

| Token  | When                                                  |
|--------|-------------------------------------------------------|
| `gap-1`   | Icon next to its label (≈ 4px).                    |
| `gap-1.5` | Tight chip / pill clusters.                        |
| `gap-2`   | Default control-row spacing (buttons in a footer). |
| `gap-3`   | Card-section spacing (heading + body).             |
| `gap-4`   | Column / row spacing inside a Surface.             |
| `gap-6`   | Page-level section gaps.                           |

Page padding: `p-3` for compact dashboards (S2D, sprint), `p-4` for
content-dense pages (inbox, calendar), `p-6` only for hero / onboarding.

### Radius

| Token         | When                                                  |
|---------------|-------------------------------------------------------|
| `rounded`     | Inline chips, badges, controls under 24px tall.       |
| `rounded-md`  | Default for cards, inputs, buttons.                   |
| `rounded-lg`  | Larger surfaces, modal bodies.                        |
| `rounded-xl`  | `<Surface>` default — top-level dashboard cards.      |
| `rounded-2xl` | Backdrop-blurred empty states, hero CTAs.             |

Don't reach for arbitrary radii (`rounded-[7px]`). If a radius doesn't
match one of these, the design conversation is probably wrong.

### Opacity (translucent surfaces)

Sanctioned steps on `bg-*/<N>` tokens:

| Step  | When                                                            |
|-------|-----------------------------------------------------------------|
| `/15` | Faint tinted overlays inside an opaque parent (focus overlay).  |
| `/40` | Backdrop on a `<FocusOverlay>` body in light variant.           |
| `/55` | `<ChromeBar>` / `<SectionHeader>` strip — translucent edge bars.|
| `/60` | `<EmptyState>` card body — backdrop-blurred empty placeholder.  |
| `/80` | Cards over a busy ambient layer that need to read as solid.     |
| `/95` | Headers / overlays that must read as fully solid but keep a tint.|

Anything off-scale (`/5`, `/10`, `/20`, `/25`, `/30`, `/35`, `/50`,
`/70`, `/90`) triggers `pnpm audit:translucency`. Carve-outs:

```tsx
// translucency-audit-ok: hover state — visual designer signed off
"hover:bg-accent/30"
```

A file-wide marker (`translucency-audit-ok: file`) skips the entire
file. It's used today on the ~30 legacy modules pre-existing the
doctrine — they'll be migrated case-by-case as components are touched.
Don't add new files to that grandfather list.

### Text size

| Token         | When                                                  |
|---------------|-------------------------------------------------------|
| `text-[10px]` | Inline metadata (timestamps, counts).                 |
| `text-[11px]` | Section headers, badges (uppercase).                  |
| `text-xs`     | Default body in dense lists.                          |
| `text-sm`     | Standard paragraph copy.                              |
| `text-base`   | Headlines, key labels.                                |

Use Tailwind tokens (`text-xs`, `text-sm`) over arbitrary
(`text-[12px]`) unless you specifically need a non-standard step (the
10/11px scales below `text-xs` justify the arbitrary syntax).

### Motion

All motion goes through `DUR` and `EASE` from
`src/lib/animation/index.ts`:

| Token         | Approx | When                                          |
|---------------|--------|-----------------------------------------------|
| `DUR.micro`   | 180ms  | Tiny icon / button reactions.                 |
| `DUR.short`   | 280ms  | Hover / focus / dropdown.                     |
| `DUR.base`    | 420ms  | Entry tweens, route transitions.              |
| `DUR.hero`    | 700ms  | Sprint takeover, sprint-complete recap.       |
| `EASE.out`    | —      | General-purpose entry / drift.                |
| `EASE.outQuick`| —     | Snappier button / icon reactions.             |
| `EASE.elastic`| —      | Hero moments only (sprint launch).            |
| `EASE.back`   | —      | Sheets / panels with a slight overshoot.      |

Wrap every tween in `withMotion(() => ...)` so users with
`prefers-reduced-motion: reduce` get no animation. Hand-rolled
`gsap.to(el, { duration: 0.5 })` without the helper is a smell.

## Foundation invariants

These rules are load-bearing. Every PR that fails one of them is
guaranteed to regress something:

1. **Every translucent surface uses a primitive OR a `// translucency-
   audit-ok: <reason>` carve-out.** `pnpm audit:translucency` enforces.
   If you reach for `bg-card/30` ad-hoc, the audit will fail. Choose a
   sanctioned step or wrap in `<ChromeBar>` / `<SectionHeader>` /
   `<Surface>` / `<EmptyState>`.
2. **Every fullscreen overlay portals through `#mashi-overlay-root` via
   `<FocusOverlay>`.** Two owners rendering an overlay double-fires
   side-effects and produces the SprintComplete-flash bug. One owner per
   overlay.
3. **Every Spotify-state-dependent component subscribes via
   `useSpotifyState({ enabled: ... })`.** Hand-rolled polling drifts.
4. **Visual tests must pass.** PRs that change a dashboard page must
   regenerate baselines (`pnpm test:visual:update`) and commit the new
   PNGs. PRs that fail the pixel-diff without a baseline update get
   bounced.
5. **Z-index goes through `Z.*` constants / `z-*` utility classes only.**
   `pnpm audit:layers` enforces. No `z-[103]`.

### Component decision tree

Reach for the primitive FIRST, hand-rolled JSX never. The mapping:

| I need to render…                                          | Use…                                  |
|------------------------------------------------------------|---------------------------------------|
| Top-of-page edge bar (toolbar, filter row, tab strip)      | `<ChromeBar>`                         |
| Strip-bar at the top of a column / list / card section     | `<SectionHeader>`                     |
| A card / panel sitting over the ambient ground             | `<Surface>`                           |
| Ambient bg layer (album art, gradient, vignette)           | `<AmbientGround>`                     |
| Full-screen takeover (sprint mode, future focus modes)     | `<FocusOverlay>`                      |
| The portal anchor for overlays (one of, in AppShell)       | `<OverlayRoot>`                       |
| "No items yet" placeholder over the ambient layer          | `<EmptyState>`                        |
| Anything else translucent                                  | A sanctioned `/N` step + audit comment|

If you find yourself wanting a primitive that doesn't exist, add it to
`src/components/layout/primitives.tsx` rather than hand-rolling. Other
features will benefit from the same surface.

## Component library doctrine — shadcn first, always

**Hard rule: every interactive primitive comes from `src/components/ui/`.**
That folder is shadcn/ui. Buttons, inputs, dialogs, dropdowns, popovers,
toasts, selects — all of it. Never hand-roll a primitive when a shadcn
version exists. Never replace shadcn with a custom equivalent.

This doctrine exists because we shipped without it once and ended up
with hand-rolled modals (`SpotlightModal`), bespoke dropdown menus
(`slack-channel-picker`), custom toast systems (`notification-hub`)
that all do roughly the same thing in subtly different, less-accessible
ways. shadcn primitives are accessibility-correct, keyboard-correct,
and visually consistent. Hand-rolled ones aren't.

### When you need a primitive that isn't in `src/components/ui/` yet

shadcn's catalog is comprehensive. Almost everything you'd want exists.
Before adding ANYTHING:

1. **Survey shadcn first.** Open https://ui.shadcn.com/docs/components
   (or use the shadcn MCP server) and look at the full list. Don't pick
   the first match — pick the one whose visual + UX shape fits the use
   case. Many primitives overlap:
   - **Modal-ish surfaces:** `Dialog` (centered modal), `AlertDialog`
     (destructive confirmation, blocks dismissal), `Sheet`
     (slide-from-edge panel), `Drawer` (mobile-bottom-up sheet).
   - **List-of-choices:** `Select` (single value, native-feeling),
     `Combobox` (typeable, filterable), `Command` (cmd-K search),
     `DropdownMenu` (action menu), `RadioGroup` (visible exclusive
     choice), `Menubar` (multi-tier menu like a desktop app's).
   - **Notifications:** `Sonner` (preferred — toast lib), `Toast`
     (legacy — only if Sonner doesn't fit).
   - **Layout:** `Resizable` (panels), `ScrollArea` (custom scrollbar),
     `Separator`, `Sidebar`.
   - **Disclosure:** `Accordion` (vertical), `Collapsible` (single),
     `Tabs`, `HoverCard`, `Tooltip`, `Popover`.
   - **Inputs:** `Input`, `Textarea`, `Checkbox`, `Switch`, `Slider`,
     `Toggle`, `ToggleGroup`, `InputOTP`, `DatePicker`, `Calendar`.
   - **Data:** `Table`, `DataTable`, `Pagination`, `Progress`, `Chart`,
     `Skeleton`.

2. **Install via the CLI** so it follows our `components.json` config:
   ```bash
   npx shadcn@latest add <name>
   ```
   This drops the source into `src/components/ui/<name>.tsx`, picks
   up our `cn` alias, our `lucide` icon library, and our `globals.css`
   tokens automatically.

3. **Use it as-is, or compose on top** in a Mashi-specific wrapper
   somewhere outside `ui/`. Never edit the shadcn source to add
   product-specific logic — wrap it instead.

### What stays Mashi-specific (built on top, not replacing)

- **Layout primitives** in `src/components/layout/primitives.tsx`
  (`ChromeBar`, `Surface`, `EmptyState`, `FocusOverlay`, `AmbientGround`,
  `OverlayRoot`, `SectionHeader`). These compose Tailwind + the
  doctrine — they're not primitives, they're product chrome.
- **Feature views** (`SprintPage`, `S2DBoard`, `CalendarView`,
  `LinearView`, `NotesView`, etc.).
- **Animation orchestration** via GSAP. Animation is behavior, not a
  primitive — it operates ON shadcn components, doesn't replace them.

### Hand-rolled-primitive checklist (when reviewing a PR)

Audit pings if you see:
- `<button>` with onClick + Tailwind styling outside `ui/`. Use `<Button>`.
- `<input>`, `<textarea>`, `<select>` raw outside `ui/`. Use the
  shadcn version (add it via the CLI if it doesn't exist).
- `position: fixed`/`absolute` + `inset-0` + `role="dialog"` patterns.
  Use `Dialog` / `AlertDialog` / `Sheet` / `Drawer`.
- Custom popover that calls `useRef` + `useState(open)` to position
  itself. Use `Popover` / `DropdownMenu` / `HoverCard`.
- Custom toast / notification queue. Use `Sonner`.

`pnpm audit:layers` enforces the raw-button + hand-rolled-modal checks.
The rest is reviewer discipline.

## React Compiler / lint quirks

The React Compiler ESLint plugin is strict. Patterns that look fine but error:

| Pattern | Fix |
|---|---|
| Hook returns a ref → caller assigns into it | Rename caller's variable to end in `Ref` (e.g. `hoverRef`, `burstRef`) — the rule whitelists `*Ref` names |
| `setState` directly inside `useEffect` body | Convert to `useQuery` + `setQueryData`, or move into an event handler. See `src/components/onboard/portcos-step.tsx` for the canonical fix |
| `Date.now()` inside `useMemo` / render | Pass the current time as state or as a dependency you already have. See `src/components/calendar/calendar-view.tsx` |
| Hooks after early return | Hoist all hooks to the top of the component, then early-return |

Run `pnpm verify` (= `tsc --noEmit && eslint`) before pushing. CI runs the same.

## AI tell sanitization

`src/lib/anthropic/stream.ts` strips em-dashes, en-dashes, and "double-hyphen" patterns from every delta of every streaming response. This is intentional — em-dashes are the single most reliable LLM tell and we don't want any user-facing copy to look AI-generated. Don't undo this. If you need a long-form dash, use `,` or rephrase.

## Auth + onboarding flow

1. User hits `/auth/sign-in` → Google OAuth via Supabase
2. `auth.users` INSERT fires two triggers:
   - `enforce_signup_allowlist_trigger` (BEFORE) — checks email domain is in `signup_allowlist`
   - `create_user_profile_trigger` (AFTER) — auto-creates `user_profile` row with `onboarding_step = 0`
3. `src/middleware.ts` checks `user_profile.onboarding_step`:
   - If `< 6` and `onboarded_at IS NULL` → redirect to `/onboard`
   - Exceptions (whitelisted during onboarding): `/onboard/*`, `/settings/connections`, `/settings/style`, `/companies`, `/api/*`
4. `/onboard/welcome` → 6 steps → `/onboard/tour` sets `onboarded_at` and lets them into `/cockpit`

To allow a new email domain: `INSERT INTO public.signup_allowlist (domain, note) VALUES ('newdomain.com', ...) ON CONFLICT DO NOTHING;`

## Local dev quirks

- **Dev server runs on port 3456**, not 3000. Set in `package.json` start script. Local Supabase `config.toml` `site_url` matches.
- **Local Supabase**: `supabase start` brings up the Docker stack. `supabase_db_mashi` is the postgres container.
- **`unset ANTHROPIC_API_KEY`** in `dev`/`build`/`start` scripts because the shell often has a stale empty key from elsewhere that overrides `.env.local`. Don't remove these `unset` calls.
- **`.env.local`** has the real secrets. Never commit. `.env*` is in `.gitignore`.
- **`pnpm verify`** = typecheck + lint. Run before pushing. No Husky/lint-staged because this directory lives inside `~/.git` (Sidd's home is one big git repo), so pre-commit hooks would fire on every home-dir commit.

## OAuth provider conventions

| Provider | Auth method | Notes |
|---|---|---|
| Google (Gmail, GCal, sign-in) | OAuth via Supabase Auth | App is in "Testing" — add each user as Test User in OAuth consent screen |
| Slack | Direct OAuth (via `/api/connect/slack/callback`) | Uses **User tokens** (`xoxp-`), not Bot tokens. Public Distribution active so other workspaces can install |
| Linear | Per-user **Personal API Key**, no OAuth | Linear OAuth tokens are limited. UI in `connections-manager.tsx` surfaces the workspace admin override path |
| Fireflies | API key only | Paste-and-go |
| Outlook / Microsoft Calendar | OAuth (Azure AD) | Wired but rarely used. Add prod redirect URI if a user needs it |
| Spotify | Direct OAuth | Powers the sprint-mode media player + ambient album-art background + per-task song logging. Refresh tokens never expire (no reauth maintenance). Redirect URI for local dev **must** be `http://127.0.0.1:3456/...` — Spotify rejects `localhost` as not-secure. Premium-only for transport controls (skip/pause/volume); read endpoints still work for free accounts. |

All OAuth tokens are encrypted at rest using `ENCRYPTION_KEY` (32-byte hex). See `src/lib/oauth/flow.ts`.

### Adding a new OAuth provider

Three places to touch, in this order — skipping any of them produces silent-ish failures:

1. **`src/lib/oauth/providers/<name>.ts`** — implements `OAuthProvider` (buildAuthorizeUrl, exchangeCode, refresh, fetchAccountInfo).
2. **`src/lib/oauth/registry.ts`** + **`src/lib/oauth/types.ts`** — add to `ProviderKey` union, register in `PROVIDERS`, append to `listVisibleProviders()`.
3. **NEW MIGRATION** — `connected_accounts.provider` has a `CHECK` constraint enumerating allowed values (originally set in `002_connected_accounts.sql`). Adding a new key without extending the constraint causes OAuth callback INSERTs to be rejected with a Postgres `PostgrestError`. Because `PostgrestError` is NOT `instanceof Error`, the catch in `src/app/api/connect/[provider]/callback/route.ts` falls back to the generic "OAuth callback failed" — there's no clue in the UI what went wrong. See `021_provider_spotify.sql` for the canonical "extend the CHECK" pattern.
4. **`src/components/settings/connections-manager.tsx`** — add the provider meta to `PROVIDER_META` so it shows up in Settings.
5. **`.env.example`** — `<UPPER_NAME>_CLIENT_ID` and `<UPPER_NAME>_CLIENT_SECRET`, plus a comment with the dashboard URL + required redirect URI.

### OAuth callback error opacity

`completeOAuthFlow` rethrows Supabase errors via `throw error;`. Supabase errors (`PostgrestError`) are plain objects, not Error instances, so `err instanceof Error ? err.message : "..."` in the callback route shows the fallback string. If you see "OAuth callback failed" with no detail in the UI, the underlying failure is almost always a DB constraint violation — check the runtime logs (`vercel logs <url> --json`) and look for the actual Postgres response. Don't replace the fallback with `String(err)` blindly; that leaks raw DB errors into the URL. Better fix is to handle the Supabase error explicitly in `flow.ts` before rethrowing.

### Env var fallbacks: use `||`, not `??`

Vercel can persist an env var as an empty string (the CLI's `vercel env add` with piped stdin produces this; the dashboard occasionally does too). `process.env.X ?? "default"` only catches null/undefined — an empty string passes through and breaks URL construction (e.g. `flow.ts`'s `APP_URL`, producing relative redirect_uris that OAuth providers silently reject). Use `||` for env var fallbacks where empty-string is functionally equivalent to "unset".

### Vercel env vars: prefer the dashboard for first-time setup

`vercel env add` piping a value via `printf` / `echo` is unreliable — values can land as empty strings while the CLI cheerfully reports "Added Environment Variable". For new provider credentials, set via the dashboard at https://vercel.com/beacon-sw/mashi/settings/environment-variables and verify via the API:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v9/projects/$PROJECT_ID/env?teamId=$TEAM_ID" \
  | jq '.envs[] | select(.key=="YOUR_VAR") | {key, target, type, value_len: (.value | length)}'
```

Project has "Sensitive Environment Variables" on, so secret-type vars are write-only and can't be decrypted back via API — verify by triggering a build and seeing the feature work, not by reading the value.

## Where docs live

- **`DEPLOY.md`** — ops/infra: provisioning, OAuth callbacks, inviting users, gotchas-by-provider, rollback. Update after any production change.
- **`AGENTS.md`** (this file) — code conventions, architectural invariants, "don't touch" warnings.
- **`CLAUDE.md`** — one-liner that imports this file so Claude Code picks it up.
- **`.env.example`** — full list of every env var. Keep in sync with code.
- **`supabase/migrations/`** — schema source of truth. Filename is the runbook order.
- **`scripts/setup-production.sh`** + **`scripts/post-domain-setup.sh`** — one-shot scripts. Read before running.

## Pull request hygiene

- CI must be green before merge (typecheck + lint + build).
- Migrations: include a smoke test or describe the verification in the PR body.
- New env vars: add to `.env.example` + Vercel project + this doc if it's a new external service.
- Touching `middleware.ts` or any trigger function: call it out in the PR description; these are easy to break.

## When in doubt

Search this codebase first — every gotcha here came from a real bug. If you can't find an example, ask, don't guess.
