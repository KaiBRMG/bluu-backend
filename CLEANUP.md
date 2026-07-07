# Code Quality & Maintainability Review — bluu-backend

*Audit date: 2026-07-07. Method: `knip` over the Next.js app in `src/`, with every significant finding manually verified via targeted greps (knip false-positives excluded — e.g. all time-tracking routes are live via a templated `apiCall()` helper; `queryCache.ts` is used).*

**Headline:** the codebase is in good shape where it matters — Firestore access is already batched and cached per the cross-cutting rules; no N+1 reads or redundant queries found. The debt is concentrated in **dead scaffolding** (~20 files, ~14 dependencies, 5 API routes) and **one large duplication hotspot** (the two custom-requests pages).

---

## 1. Dead code

### Dead service files (verified zero imports anywhere)

- `src/lib/services/timeEntryService.ts` — superseded by the event-log session model in `activeSessionService`. Nothing imports it.
- `src/lib/services/teamspaceService.ts` — teamspaces became code constants in `definitions.ts` (the seed route's comment confirms this migration happened).

**Why unnecessary:** both are leftovers of replaced architectures.
**Impact:** removes stale Firestore access patterns that could mislead future edits (cross-cutting rule 4 about `sessionCloseMs` exists precisely because old time-entry code did it wrong).
**Risk:** low — zero references.
**Plan:** delete both, plus these verified-unreferenced sibling exports:

| Export | File |
|---|---|
| `createActiveSession` | `src/lib/services/activeSessionService.ts` |
| `getPagePermission`, `recomputePermissionsForGroup` | `src/lib/services/pageService.ts` |
| `getUserGroups` | `src/lib/services/userService.ts` |
| `getGroupById` | `src/lib/services/groupService.ts` |
| `markBufferFlushed` | `src/lib/localBuffer.ts` |
| `handleApiError` | `src/lib/middleware/apiHelpers.ts` |

### Dead API routes

| Route | Why it's dead |
|---|---|
| `/api/admin/init` and `/api/admin/seed` | **Identical duplicates of each other** (both call `ensureDefaultGroups` + `seedDefaultPagePermissions`); neither is called from any client, Electron, or script. Bootstrap already happened. |
| `/api/notifications/create` | Lets a user create a notification for *themselves*; no caller anywhere. Also bypasses the `notificationContent.ts` factory convention (rule 5). |
| `/api/auth/google-url` | `documentation/auth.md` claims "used by Electron directly" — **stale**. Electron's `main.js` opens the `/auth/google` *page*, which builds its own URL server-side. |
| `/api/sentry-example-api` | Sentry setup-wizard demo artifact. |

**Impact:** every deleted route is attack surface removed — `notifications/create` is a live authenticated write endpoint nobody uses (rule 10 argues for deleting it first).
**Risk:** low; only caveat is manual Firebase-project bootstrapping via `admin/init` — keep exactly one of the init/seed pair if so.
**Plan:** delete all five (or keep `admin/init` only); fix the stale line in `auth.md` in the same commit (rule 11).

### Unused public assets

`src/public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` (create-next-app starters), and `test-deeplink.html` (dev artifact). Zero references — the one `next.svg` grep hit was a CSS selector coincidence in `calendar.tsx`. Delete freely.

### Untracked build artifact

`src/dist/` — March electron-builder output sitting inside the web app directory (gitignored, disk clutter only). Delete locally.

---

## 2. Duplicate logic

### The big one: custom-requests pages

`src/app/(main)/creators/custom-requests/page.tsx` (**1,952 lines**) and `src/app/(main)/ca-portal/custom-requests/page.tsx` (**1,433 lines**) each locally define near-identical copies of `DatePickerInput`, `StatusBadge`, `Field`, `SummaryTile`, and a ~230-line `NewEntryWizard`. Some sharing already exists (`src/components/campaign/entryActions.tsx`), so the pattern is established — it just wasn't followed for the rest.

**Why it matters:** highest-value item in this review. Any status-badge or wizard change must be made twice, and the copies have already drifted (the CA `DatePickerInput` grew `disabled`/`disabledClassName` props the manager one lacks).
**Impact:** ~500–800 lines removed; future campaign-tracking changes become single-site edits.
**Risk:** medium — the copies have drifted deliberately in places, so extraction needs prop-level care, and these are the two most business-critical pages.
**Plan:** extract into `src/components/campaign/` one component at a time — leaf components (`StatusBadge`/`Field`/`SummaryTile`) first, `NewEntryWizard` last — verifying each page after each extraction. Update `documentation/campaign-tracking.md` when done.

### Parallel route pairs with drift

`campaign-tracking/[id]/creator-complete` vs `content-planning/[id]/creator-complete` are ~80% identical but genuinely diverge (revert support, different notification payloads). **Recommendation: don't force-merge** — the divergence is domain behavior; per the docs these are intentionally separate systems. Leaving them is cheaper than a leaky abstraction.

### Hook fetch boilerplate

~8 hooks (`useBasicUsers`, `useAdminUsers`, `useAdminData`, `useDisputesData`, …) repeat the same ~50-line pattern: seed state from `getCache`, `getIdToken` → fetch → `setCache` → `setState`, `refetch(force)`. The cache layer is already shared (`queryCache.ts`); only the state machine repeats.
**Impact:** a generic `useCachedFetch<T>(key, url, ttl)` would cut ~300 lines.
**Risk:** low-medium — some hooks have extra invalidation cross-talk (`useAdminUsers` invalidates two keys).
**Plan:** optional, lower priority than the page duplication; do opportunistically when next touching these hooks.

---

## 3. Unused UI components

Ten `src/components/ui/` files have zero consumers:
**aspect-ratio, breadcrumb, context-menu, drawer, form, input-otp, menubar, navigation-menu, resizable, slider**

**Why unnecessary:** shadcn components are vendored copies, not a library — unused ones are pure maintenance surface, and `drawer.tsx` is the *only* thing keeping the `vaul` dependency alive.
**Impact:** 10 files gone; enables removing `vaul`. `npx shadcn add <name>` restores any in seconds if needed later.
**Risk:** near zero.
**Plan:** delete all ten. Conversely, **leave the "unused exports" inside kept UI files alone** (`DropdownMenuSub`, `SheetTrigger`, etc.) — trimming shadcn kit exports fights the vendoring convention for negligible gain.

---

## 4. Overly complex implementations

- The two custom-requests pages (§2) — splitting them into components *is* the simplification.
- `src/contexts/TimeTrackingContext.tsx` (898 lines) — long but **deliberately** so: the crash-robustness/buffer design in `documentation/time-tracking.md` explains the state machine. **Do not simplify** — load-bearing complexity.
- `src/components/admin/user-management/UserDetailContent.tsx` (958 lines) and `src/app/(main)/creators/content-planning/page.tsx` (1,157 lines) — same monolithic-page smell as custom-requests, lower urgency.

---

## 5. Legacy code

- **`src/scripts/`** — `import-campaign-tracking.js`, `import-content-planning.js`, `backfill-amount-paid.js`, `investigate-time-gap.js`, `repair-permissions.js` are one-off migrations untouched since May 2026. **`outstanding-payments-report.js` was modified 2026-07-07 — it's a live ops tool.** Delete the five stale ones (git history retains them); keep the report script.
- **`/raffle` page** (991 lines + `src/public/raffle/` + a middleware allowlist entry) — intentional one-off event tool (July 2026 commits). Flagged so it doesn't outlive the event: when done, remove the page, assets, allowlist line, and `canvas-confetti` together.
- **Root planning docs** (`SMM.md`, `Notion.md`, `OnlyFans_CRM.md`) — working notes at repo root; not code debt.
- **Stale docs:** `auth.md`'s google-url claim (§1), and `functions/index.js` exports a third function (`syncPagePermissions`, daily cron) that the CLAUDE.md hub diagram doesn't mention — update the hub's `functions/` one-liner.

---

## 6. Redundant queries / API calls

Genuinely clean — this is the area the cross-cutting rules already police. All multi-doc reads inspected use `adminDb.getAll(...)` or chunked `where in` queries under `Promise.all`; client hooks all go through sessionStorage caches. **No action items.**

---

## 7. Dependencies & remaining tech debt

### Unused dependencies (verified zero imports)

`zod`, `sharp` + `@types/sharp` (Next 16 handles image optimization itself; the Cloud Function's sharp lives in `functions/package.json` separately), `@dnd-kit/core|modifiers|sortable|utilities`, `@tanstack/react-table`, `motion`, `react-tweet`, `vaul` (after deleting drawer.tsx), `baseline-browser-mapping`, and the `radix-ui` meta-package (no direct imports).

### ⚠️ The one real trap before removing anything

About ten UI components import packages **not in `src/package.json`** that resolve only transitively:
`@radix-ui/react-accordion`, `-alert-dialog`, `-collapsible`, `-hover-card`, `-popover`, `-progress`, `-radio-group`, `-scroll-area`, `-switch`, plus `@date-fns/tz` (ShiftModal, recurrence) and `server-only` (notionService).

Today they hoist in via the `radix-ui` meta-package — **remove `radix-ui` blindly and the build breaks.** Fix order matters: `npm install` the individual packages first, *then* remove the meta-package.

### Other debt

- **`googleapis` (heavy install) is used for exactly two calls** in `src/app/api/auth/exchange-code/route.ts`: OAuth token exchange + userinfo. Both are single `fetch` calls to Google endpoints. Replacing them drops one of the largest packages in the tree. Medium effort, security-sensitive path — do in isolation with careful testing.
- **`firebase-tools` in src devDependencies** (enormous) — no npm script uses it; if deploys use a globally-installed CLI, remove it. Verify the deploy workflow first.
- **No dead-code guardrail:** add `knip` as a devDependency + CI step so this audit doesn't need repeating manually.

---

## Recommended cleanup plan

Each phase = one branch + `npm run build` + lint.

1. **Zero-risk deletes** — 2 dead services + dead exports, 10 UI components, 5 starter assets + `test-deeplink.html`, 5 stale scripts, `src/dist/`, sentry-example route. (~30 min, no behavior change possible)
2. **Route cleanup** — delete `notifications/create`, `google-url`, `seed` (keep `init` if a bootstrap escape hatch is wanted); update `auth.md` + CLAUDE.md functions line. *(Security-positive; no Firestore rules/indexes touched anywhere in this plan.)*
3. **Dependency cleanup** — add the ~11 unlisted packages first, then remove the ~14 unused ones; rebuild between the two steps.
4. **Custom-requests extraction** — the drift-prone duplication; leaf components first, wizard last. Run `/simplify` on this branch.
5. **Guardrail** — add knip to CI.

Phases 1–3 are mechanical: roughly **−3,000 lines and a dramatically smaller `node_modules`** with near-zero behavioral risk. Phase 4 is where the real long-term maintainability win is.
