---
target: src/app/(main)/admin/sharing
total_score: 11
p0_count: 2
p1_count: 3
timestamp: 2026-08-14T12-54-18Z
slug: src-app-main-admin-sharing-page-tsx
---
Method: dual-agent (A: design review · B: detector + evidence, run in parallel isolation)

# Critique — Admin › Sharing & Permissions

`src/app/(main)/admin/sharing/page.tsx` · `PermissionTable.tsx` · `EffectivePermissionsPreview.tsx` · `useAdminData.ts`

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | `opacity: 0.6` on the row is the only save signal (`PermissionTable.tsx:160`). No toast, no `aria-busy`. Success and no-op are pixel-identical |
| 2 | Match System / Real World | 2 | Columns render raw slugs `CA` / `SMM` / `OFAM` (`:141`) while `GROUP_DISPLAY_NAMES` sits unused in the sibling component |
| 3 | User Control and Freedom | 1 | Every toggle is instant, unconfirmed, irreversible. The error screen has no retry despite the hook exposing `refetch` |
| 4 | Consistency and Standards | 1 | Two dropdown implementations in one feature, inline SVG vs lucide, literal `z-50`, three greys for one role |
| 5 | Error Prevention | 0 | Nothing stands between a mis-click and revoking a whole group's access. No confirm, no affected-user count, no self-lockout guard |
| 6 | Recognition Rather Than Recall | 1 | Non-sticky header + slug labels + individuals hidden behind a count. Decode, hold, scroll, re-derive |
| 7 | Flexibility and Efficiency | 1 | Dropdown closes on every pick, each toggle triggers a full admin-payload refetch. No search, no bulk, no select-all |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely restrained and dense — correct posture for this console |
| 9 | Error Recovery | 0 | Failures go to `console.error`. The checkbox silently snaps back, which reads as "the app randomly undid my change" |
| 10 | Help and Documentation | 1 | Nothing explains group-vs-individual precedence, or that admins bypass the grid entirely |
| **Total** | | **11/40** | **Poor / Critical boundary** |

That total sits on the 12–19 "Poor" / 0–11 "Critical" line, and the distinction matters: the **concept is not broken**. The information architecture is sound and the data layer is deliberate. The score is dragged down by a cluster of *unbuilt states* — no success feedback, no failure feedback, no confirmation, no undo, no accessible names — on a surface where each of those absences has a security consequence. This is a finishing problem, not a redesign.

## Anti-Patterns Verdict

**LLM assessment:** Not AI slop in the visual sense — no gradient heroes, no eyebrow scaffolding, no identical card grid, no hero-metric template. It passes every shared absolute ban, and the restraint is real.

It fails the **product-register** slop test, which is a different bar: would someone fluent in Linear/Notion/Stripe trust this, or pause at every subtly-off component? They wouldn't pause at the look. They'd pause at the behaviour. Product UI's failure mode is *strangeness without purpose*, and there is one glaring instance:

> `PermissionTable.tsx:188-254` hand-rolls a popover — a `.form-input`-styled button opening an absolutely-positioned div, dismissed by a `mousedown` listener. `EffectivePermissionsPreview.tsx:111-134`, **the component directly below it on the same page**, uses shadcn `DropdownMenu` for the same "pick a user" task.

Both assessments independently identified this as the origin point. B traced the blast radius precisely: that single divergence causes the inline SVG icons, the three hardcoded Action Blue values, the literal `z-50`, the overflow-clipping risk, the missing `aria-expanded`, and the keyboard-undismissable panel. **Six findings, one root cause.** Deleting that component in favour of the one next door closes all of them.

**Deterministic scan:** `detect.mjs --json` over both directories → `[]`, **exit 0**. Clean — and worth almost nothing here. The detector reads HTML/CSS; this target is three `.tsx` files where every colour, z-index, and spacing decision lives in JSX inline `style={{}}` objects and Tailwind strings. `[]` means "found no files it understands," not "the code is clean." Treat it as **no signal**. Everything below is hand-verified with computed colour math.

**Visual overlays:** none. `/admin/sharing` sits behind `AuthProvider` inside the Electron shell, and `src/middleware.ts` rewrites all non-Electron page traffic to `/desktop-only`. No live server was started, no browser launched. Every rendering claim below is computed alpha-blending against tokens read from `globals.css`, not sampled pixels.

### Where the two assessments converged, diverged, and corrected each other

**Converged** (independently, from different angles): the two-dropdown split; silent mutation failure; unnamed checkboxes; `--foreground-muted` as body text; props mutated during render; the raw group slugs; one-click revoke with no undo.

**B caught what A missed** — all mechanical, all verified:
- `useAdminData.ts:110` — `if (!user) return;` makes `updatePermission` **resolve successfully having written nothing**. The caller's `try` sees no error, `finally` clears `saving`, the UI reports success. Silent data loss with a success-shaped signature.
- `PermissionTable.tsx:42` — `saving` is one `string | null` for the whole table. Two rows in flight: the second `setSaving` overwrites the first, and whichever request lands first re-enables **both** rows while one write is still pending.
- `useAdminData.ts:55-97` — no abort controller, no sequence guard. Rapid toggles fire overlapping refetches; an out-of-order response writes stale data into state, which then feeds the stale-read on the next write.
- `useAdminData.ts:123` — `await res.json()` inside the `!res.ok` branch. A non-JSON error body (HTML 500, proxy timeout, empty 502) throws a `SyntaxError` that replaces the real HTTP status — then gets swallowed anyway.
- `AppLayout.tsx:76` — `<main className="flex-1 overflow-y-auto">` computes `overflow-x` to `auto`, establishing a clip context. `z-50` does not escape a scroll clip, so the last row's dropdown will clip or push page scroll. Radix portals out of this for free; the hand-rolled one doesn't.
- `PermissionTable.tsx:133` / `:167` — header and rows are **two separate grids with duplicated track strings**. Alignment depends on two literals staying byte-identical by hand.

**A caught what B missed** — all judgement, none mechanical: the emotional shape of the page (no peak, valley at the click, worse valley at failure); the hierarchy inversion where "No Access" — the state an admin is *scanning for* — is the dimmest text on the card while "Access" gets a green pill; self-lockout (an admin can revoke their own group's access to the admin teamspace and `route.ts` only checks the caller's claim, never the result); and the observation that the preview component is the more useful artifact and it's at the bottom of the page.

**B corrected A on three false positives** — I'm reporting these as *not* findings:
- `EffectivePermissionsPreview.tsx:112` missing `aria-expanded`/`aria-haspopup` — **no**. `DropdownMenuTrigger asChild` injects both. Only the hand-rolled dropdown lacks them.
- "Access"/"No Access" as colour-alone — **no**. Both are literal text; the green is redundant reinforcement. Correct by WCAG 1.4.1.
- `page.tsx:40` `text-red-400` as drift — **no**. It resolves to `#ff6467` (Tailwind v4 oklch) rather than DESIGN's documented `#f87171`, passes at 6.88:1, and `text-red-400` is the token form the doc itself names. Palette-version mismatch, not drift worth acting on.

## Overall Impression

The skeleton is better than the finish. Teamspace grouping mirrors the sidebar IA, the effective-permissions preview shares its resolver with production so it cannot drift from reality, and the data layer's 5-minute cache is a documented, deliberate read-optimisation. Someone thought about this.

Then it stops. Every consequential state — saved, failed, are-you-sure, undo — is missing, and the controls carry no accessible names. The result is a page that **looks** like a careful instrument and **behaves** like an unfinished settings toggle, on the one screen in the product that decides who can enter the building.

The single biggest opportunity: build the four missing states. Toast the outcome, confirm the revoke, offer the undo, name the controls. None of it requires rethinking the page.

## What's Working

1. **The preview reports provenance, through the production resolver.** `EffectivePermissionsPreview.tsx:76-84` doesn't just say "Access" — it says *via which group*, resolved through the same `resolvePagePermission` the server uses. Sharing the resolver between simulator and production means the preview **cannot** drift from reality. That's a genuinely well-made decision, and it's the thing worth building the rest of the page around.

2. **Server state is the single source of truth for every checkbox.** `hasAccess` derives from `permDoc` (`PermissionTable.tsx:175`), never from local state; `updatePermission` invalidates then refetches. It's slow, but a checkbox can never lie about what the server thinks — the correct trade on a permissions grid, and the opposite of the usual optimistic-UI bug farm.

3. **Teamspace grouping matches the app's own navigation model.** Both the tables (`page.tsx:61-78`) and the preview group by teamspace in `order`, so the permission grid reads in the same shape as the sidebar it controls. No taxonomy translation.

## Priority Issues

### [P0] Three separate paths report success while writing nothing

Not one bug — a stack of three, each independently sufficient:

- `useAdminData.ts:110` — `if (!user) return;` resolves the promise having done nothing. The UI reports success.
- `PermissionTable.tsx:82-86, 104-108` — both handlers `catch` → `console.error` → `finally` clears `saving`. A real failure looks like a no-op.
- `useAdminData.ts:123` — `await res.json()` in the `!res.ok` branch throws on a non-JSON error body, masking the actual status before it gets swallowed above.

Downstream, the refetch restores the old value, so the checkbox **snaps back on its own**. To the admin that reads as "the app randomly undid my change" — and the honest interpretation is worse: someone retains access they were meant to lose, and nobody knows.

DESIGN.md:223 is unambiguous — *"Every mutation `toast`s its outcome via `sonner`."* Neither target file imports `sonner`. Five sibling admin components do.

**Fix:** `toast.error("Couldn't update {page} — access unchanged", { action: { label: "Retry" } })` in both catches; `toast.success` on the write path. Make `updatePermission` throw rather than return when `!user`. Guard the `res.json()` in the error branch.

**Suggested command:** `/impeccable harden`

### [P0] The permission matrix has no accessible names and no table semantics

`PermissionTable.tsx:178-182` renders a bare Radix `Checkbox` with `checked` / `onCheckedChange` / `disabled` and nothing else — no `aria-label`, no `aria-labelledby`, no wrapping `<label>`. The layout is CSS-grid `<div>`s, so there's no `<th scope>` to fall back on; header and cells are two *separate* grids, so there isn't even implicit positional association.

A screen-reader user hears "checkbox, not checked" twenty times with no indication of which page, which group, or which teamspace. WCAG 4.1.2. Compounding it: the hand-rolled dropdown has **no Escape handler anywhere in the file** (grep-verified) — the only close paths are outside-`mousedown` and selecting an item, so a keyboard user cannot dismiss it; focus is never returned; the panel has no `role`, and its items carry no `aria-selected`, so selection state is absent from the accessibility tree entirely.

**Why it matters:** This isn't hard to use non-visually — it's *unusable*, on the screen that decides who can use the rest of the app. There is no second path to this configuration.

**Fix:** Real `<table>` semantics with `<th scope="col">{GROUP_DISPLAY_NAMES[g.id]}</th>` and `<th scope="row">{page.title}</th>` — which also gets you `position: sticky` on `<thead>` for free and fixes the slug problem for sighted users in the same pass. At minimum, `aria-label={`${groupName} access to ${page.title}`}` on every checkbox. Replace the hand-rolled dropdown with `DropdownMenuCheckboxItem` from the primitive already imported next door.

**Suggested command:** `/impeccable audit`

### [P1] Revoking is one unconfirmed click, with no blast radius and no undo

`PermissionTable.tsx:174-185`. Unchecking a group strips that page from every member; the server recomputes `permittedPageIds` for all of them. The UI never names a number, never confirms, never offers undo. An admin can also revoke their own group's access to the admin teamspace — the API only checks the *caller's* claim, never the *result*.

The codebase already solved this. DESIGN.md:353-355: consequential actions get a two-step confirm plus an Undo toast via the `revert` flag. Custom requests get that protection. Permissions get none.

**Fix:** Make removal asymmetric — granting stays one click, revoking routes through a confirm that names the cost: *"Remove access to Disputes for Chat Agents? 12 people will lose this page."* The member counts are **already fetched** (`useAdminData.ts:21` types `members: string[]`; `PermissionTable.tsx:8-12` drops the field — add it back). Pair with an Undo toast that re-PUTs the prior permission object. Disable, with a tooltip, any checkbox that would remove the current admin's own access.

**Suggested command:** `/impeccable harden`

### [P1] Twelve AA contrast failures, one root cause

`--foreground-muted` is `#6b7280` (`globals.css:34`, defined in `:root` and **never overridden in `.dark`**). Computed against actual composited grounds:

| Site | Ground | Ratio |
|---|---|---|
| `EffectivePermissionsPreview.tsx:188` — **"No Access"** | `#151517` | **3.77** |
| `PermissionTable.tsx:195` — "No individuals" | `#171719` | **3.72** |
| `EffectivePermissionsPreview.tsx:176` — "via {group}" | `#151517` | **3.77** |
| `PermissionTable.tsx:136` — column headers | `#101013` | **3.92** |
| `EffectivePermissionsPreview.tsx:137,149` | `#0e0e10` | **3.99** |
| `PermissionTable.tsx:245` — user email (hover / selected) | `#0e0e0e` / `#060d19` | **3.99 / 4.03** |
| `PermissionTable.tsx:120` — teamspace heading | `#09090b` | **4.11** |
| `page.tsx:41` — error detail | `#09090b` | **4.11** |
| `PermissionTable.tsx:214,245` — dropdown text | `#000000` | **4.34** |

All twelve fail AA normal text (4.5:1), all at 12px. DESIGN.md:144 already says this outright: *"Ink Muted… **Not a text colour.** …it fails AA on every ground in the app."*

The worst on merit is `:188`. **"No Access" is the primary datum of the entire preview panel** — the thing an operator scans for during an access review — and it's rendered in the least legible colour on the screen while its opposite gets a green pill. The exception is styled as the default.

Separately, `page.tsx` uses **two** greys for one role in one file: `var(--foreground-muted)` at `:41` and `text-muted-foreground` (`#9f9fa9`) at `:55` — against the One-Grey Rule (DESIGN.md:172).

**Fix:** Global swap to Ink Secondary (`--foreground-secondary` / `text-zinc-400`) per the One De-emphasis Rule. Promote "No Access" out of de-emphasis entirely — it's a state, not metadata; give it the zinc status treatment from `campaignTracking.ts` so it reads as the peer of the Access pill.

**Suggested command:** `/impeccable polish`

### [P1] Every checkbox costs a full admin-payload refetch, and concurrent edits stomp silently

`useAdminData.ts:127-128` — every toggle invalidates the cache and refetches **pages, teamspaces, pagePermissions, groups and users**. A row of five group boxes is five full-dataset reads, against CLAUDE.md rule 9.

Worse, the write is read-modify-write over a snapshot that can be up to **five minutes stale** (`useAdminData.ts:43`), PUT as the whole `{groups, users}` object. Two admins working simultaneously silently overwrite each other. No version, no etag, no merge, no conflict signal. With no abort controller (`:55-97`), overlapping refetches can also land out of order and write stale data back into the state that feeds the next write.

The UX cost compounds: `setOpenDropdown(null)` at `:90` closes the panel on every user pick, so adding four people to a page is four open-scroll-click-wait cycles with no search field over the roster.

**Fix:** Optimistic local state, reconcile on response, revert + error toast on failure. Send a delta (`{ add: { groups: [...] } }`) rather than the full object, or version the doc and 409 on mismatch. Keep the dropdown open for multi-select and add a search input. *(Worth confirming whether the API route merges server-side — if it does, the stomp severity drops.)*

**Suggested command:** `/impeccable optimize`

### [P2] Props mutated during render; spinner where a skeleton belongs; no empty state

- `page.tsx:62`, `PermissionTable.tsx:148`, `EffectivePermissionsPreview.tsx:54` all call `.sort()` **in place** on arrays owned by `useAdminData`'s state. `PermissionTable.tsx:148` mutates a prop array during the parent's render pass; the preview mutates the same `pages` array inside a `useMemo`, so ordering depends on which component rendered last. With React 19 double-invoking render in dev, this is a live correctness hazard. Fix: `[...pages].sort(...)`. *(`PermissionTable.tsx:47-49` is fine — `.filter()` copies first.)*
- `page.tsx:25-33` drops a bare `<Loader />` into an `h-64` box. DESIGN.md:271 and :327 both forbid this explicitly; `skeleton.tsx` is present.
- `page.tsx:50-91` has no empty state. Zero teamspaces renders an `<h1>`, a subtitle, and an empty bordered box.

**Suggested command:** `/impeccable polish`

## Persona Red Flags

**Sam (screen reader + keyboard only)** — the page is inoperable, not merely awkward.
- The entire matrix is unlabelled checkboxes in `<div>`s (`PermissionTable.tsx:164-185`). "Checkbox, not checked" × N, with no way to know which page or group — and each one changes who can log into what.
- The individuals popover has no `aria-expanded`, no `role`, **no Escape handler**, and no focus return when it closes at `:90`. Focus is dropped into the void mid-task.
- Item selection is conveyed only by an inline blue wash and a decorative bare `<svg>` check — no `aria-checked`, no text alternative. The state is literally not in the accessibility tree.
- Hover is applied via JS inline styles (`:228-233`), so there is **no `:focus-visible` style at all**. Keyboard position is invisible even with residual vision.
- Heading order is `h1` (`page.tsx:54`) → `h3` (`:118`, `Preview:108`), no `h2`. Heading navigation misreports the structure.
- `page.tsx:38-45` isn't `role="alert"`; `page.tsx:29`'s `Loader` is an empty div with no `role="status"`. Both loading and error are entirely unannounced.

**Riley (stress tester)** — finds four real defects in ten minutes.
- Two windows, toggles CA in one and SMM in the other on the same row. Second write clobbers the first from a five-minute-stale cache. No conflict, no warning, no trace.
- Throttles to offline, toggles: row dims, un-dims, checkbox reverts, zero explanation. Files it as *"the app randomly undoes permission changes"* — which is exactly what it looks like.
- Unchecks every group on the admin teamspace including their own. Nothing stops them.
- Double-clicks fast: the second click lands while `disabled`, dropped with no queue and no feedback — final state is the opposite of what the interaction implied.
- Adds a sixth group: `repeat(N, 80px)` grows unbounded, the wrapper has **no `overflow-x`**, and the grid escapes past its own rounded border rather than scrolling.

**Alex (power user)** — the fast path is the slowest thing on screen.
- Onboarding four hires to one page: open dropdown → click → **dropdown closes** → full payload refetch → row disabled throughout → repeat ×4. Every comparable tool (Notion, Linear, Drive) keeps the picker open for multi-select.
- No search over the roster, so it's four separate scroll-hunts through a 240px window.
- No "grant this group everything in this teamspace" — the most common real bulk operation has no affordance at all.
- Verifying means scrolling to the preview and using a *different-looking* dropdown, one user at a time. The verify loop costs as much as the edit loop.
- Columns say `CA / SMM / OFAM`; the preview says `Chat Agents / Social Media Manager / Account Manager`. Alex holds a translation table for the app's own vocabulary.

## Minor Observations

- `EffectivePermissionsPreview.tsx:168-169` hardcodes `#22c55e` + `rgba(34,197,94,0.08)`. The system green is `#4ade80` with a `/10` fill and `/30` border, centralised in `campaignTracking.ts`. Wrong hue *and* inlined (DESIGN.md:148, :324).
- `PermissionTable.tsx:226` — the selected dropdown row's wash computes to **1.08:1** against an unselected row. Effectively invisible; rescued only by the check icon. DESIGN.md:262 documents this exact failure for the OF Manager chat row and prescribes three cues.
- `PermissionTable.tsx:207` — literal `z-50` instead of `var(--z-overlay)` (Named-Layer Rule). Numerically equal, so no visual bug — rule violation only.
- Overlay alphas drift from the documented vocabulary: `.03` and `.02` where the recipe specifies panel `0.025` / list-item `0.04` (DESIGN.md:200-204). Containers are `rounded-lg` where DESIGN.md:247 says `rounded-xl`.
- `EffectivePermissionsPreview.tsx:102-106` mixes recipes — a translucent `.02` background edged with the **opaque-surface** hairline `#2a2a2a` instead of the overlay's `rgba(255,255,255,0.07)`.
- Truncation without recovery: `:244-245` truncates name and email with no `title` and no tooltip. `:192-195` caps the trigger at 220px but never truncates its label. `Preview:116-118` caps at 300px and renders `Name (email)` untruncated.
- `PermissionTable.tsx:52-53` — `getPermDoc` is a linear `.find`, called twice per page per render. The sibling builds a `Map` for exactly this (`Preview:42-48`). Inconsistent within one feature.
- `photoURL` and `members` are fetched, typed, and never read — dead payload on every request, and `members` is precisely the data the blast-radius fix needs.
- `Preview:120` re-runs `users.find(...)` in an inline IIFE when `selectedUser` at `:39` already holds it.
- `Preview:127` renders "Select a user to preview…" as a selectable *menu item* as well as the placeholder — a clear-selection action disguised as the empty option. Label it "Clear selection".
- `Preview:113-124` — the trigger's accessible name *is its value*, so once a user is picked the control no longer says what it does. DESIGN.md:264: *"a placeholder is not a name."*
- The teamspace heading is a `text-sm` uppercase tracked eyebrow (`:119`) while the preview's equivalent is `text-xs` — two sizes for one role, and DESIGN.md:186 reserves the eyebrow device for sidebar section headers, "not a per-section scaffold."

## Questions to Consider

1. **Is a matrix the right shape at all?** A grid optimises for "set many things at once," but the actual admin task is singular and event-driven: *someone joined, someone left, someone changed role.* What if the primary surface were person-first — "Priya, Chat Agent, has access to these 14 pages" — and the matrix demoted to an audit view? You already built the person-first component. It's the more useful artifact and it's at the bottom of the page.
2. **Why is a group's page access edited here rather than as a property of the group?** Membership lives elsewhere in admin; capability lives here. Answering "what does a Chat Agent get?" means reading a column across N tables on one page and a member list on another.
3. **Should grant and revoke ever be the same gesture?** Granting wrongly is a security incident found late. Revoking wrongly blocks a person from work, found in minutes. Wildly asymmetric costs, one identical click.
4. **Where is the audit trail?** Every control here changes who can enter the building, and the system shows the admin nothing: no changed-by, no when, no diff. If someone asks in three weeks "who gave Marketing access to Payments?", does this page have any answer? A "recent changes" strip would double as the missing confirmation, the missing undo, and the missing end-of-journey moment — one component closing four of the failures above.
