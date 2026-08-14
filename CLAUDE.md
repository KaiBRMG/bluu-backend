# CLAUDE.md

This file guides Claude Code (claude.ai/code) when working in this repository. It is the **hub** of a hub-and-spoke documentation model: this file holds the high-level system map; deep-dive detail for each subsystem lives in [`documentation/`](documentation/). **When working on a subsystem, open its spoke file first — do not rely on this hub alone.**

## Context

- Internal management platform for **Bluu Rock MGMT**.
- **RULE:** The Next.js project root is `src/`, not the repo root — it holds its own `package.json`/`node_modules`/`tsconfig.json`. Run `npm`/`tsc`/etc. from inside `src/`, not from the repo root (which has no `package.json`).
- **RULE:** Always notify the user if changes are made to **Firestore rules** or **Firestore indexes**.
- **RULE:** Only use visual components/styling from `src/components/ui`; only use `@tabler/icons-react` and `lucide-react` for icons. (Full UI stack in [architecture-overview.md](documentation/architecture-overview.md#ui-stack-strict-constraints).)
- **RULE:** Always read [`DESIGN.md`](DESIGN.md) before writing or changing **any** frontend UI — it is the design system of record (palette, typography, surfaces, component/interaction conventions, and the signature dashboard-widget pattern). Match it; keep it current when the visual language changes.
- If the user mentions "clocked in", "clocked out", "clock in", "clock out", they are referring to the time tracking subsystem.

## System at a Glance

```
                    ┌───────────────────────────────────────────────┐
 Electron desktop ─►│  Internal portals  /ca-portal /admin /apps    │─► AuthProvider + withAuth
 (employees only)   └───────────────────────────────────────────────┘
                    ┌───────────────────────────────────────────────┐
 System browser  ─►│  Creator portal    /creator                   │─► CreatorAuthProvider + withCreatorAuth
 (creators)         └───────────────────────────────────────────────┘
                    ┌───────────────────────────────────────────────┐
 System browser  ─►│  Model application /model-submissions         │─► UNAUTHENTICATED (session token
 (public)           └───────────────────────────────────────────────┘   + rate limit + sharp validation)

                    ┌───────────────────────────────────────────────┐
 Second Electron ─►│  OF Manager        /of-manager                │─► own window, own layout
 window (spawned)   └───────────────────────────────────────────────┘   (NO TimeTrackingProvider)

 src/middleware.ts  → rewrites all non-Electron, non-allowlisted page traffic to /desktop-only
 Firestore + Storage (Firebase Admin SDK) ← services (src/lib/services) ← API routes (src/app/api)
 Client hooks (src/hooks) ← contexts (src/contexts) ← React 19 / Next 16 App Router UI
 functions/ → generateThumbnail (Storage trigger) + daily stale-session cleanup
              + daily page-permissions sync + nightly analytics rollup
```

- **Monorepo:** `src/` (Next.js 16 web app, primary), `electron/` (desktop wrapper), `src/app/creator/` (creator interface), `functions/` (Cloud Functions).
- **Two domains, one Vercel deployment:** the Electron shell is pinned to `bluu-backend.vercel.app` (`BASE_URL`); browser-facing pages use `app.bluurock.com` (`PUBLIC_APP_ORIGIN` in [`src/lib/publicOrigin.ts`](src/lib/publicOrigin.ts)). Build every user-facing link from that constant — **never `window.location.origin`**, which is the vercel.app host inside Electron. See [electron.md](documentation/electron.md#two-domains-one-deployment).
- **Auth:** Google OAuth only, with **personal** Google accounts — there is no company-domain restriction. **Google authenticates; Firestore authorises:** an admin must register someone in the Employee Registry before they can log in, and `/api/auth/exchange-code` refuses any address without a `users` doc. It **never creates one**. Admin status is a JWT custom claim (`token.admin`), not a Firestore read.
- Full repo layout, commands, and env vars: [architecture-overview.md](documentation/architecture-overview.md).

## Temporary Instrumentation (remove after data collection)

- **Screenshot analytics** — a once-off, throwaway capture. Grabs the user's screen (via the Electron native `captureScreenshot()`) with a 3s delay per trigger, and uploads to Storage under `temp-analytics/{uid}/` (filename prefixed with the page key). Gated **per page, per user** by a `localStorage` marker so each page fires **once per user, ever**. No Firestore docs/rules/indexes involved.
  - **Only one page is instrumented: `home`** (`src/app/(main)/page.tsx`, page open only), and it is **allowlisted** — `useTempAnalyticsScreenshot(pageKey, { onlyUids })` restricts collection to specific uids via `TEMP_ANALYTICS_HOME_UIDS` (currently one user). Non-listed users are skipped before storage or the capturer is touched. Omitting `onlyUids` would collect from everyone who opens the page.
  - **Decommissioned:** the three CA-portal pages (`disputes`, `custom-requests`, `campaigns`) were previously instrumented and no longer capture anything — call sites removed. Screenshots already collected from them remain in Storage.
  - Hook: `src/lib/temp-analytics/useTempAnalyticsScreenshot.ts` (`useTempAnalyticsScreenshot(pageKey, options?)`) · Route: `src/app/api/temp-analytics/screenshot/route.ts` · Call site: the home page (search `TEMP ANALYTICS`).
  - **To remove:** delete `src/lib/temp-analytics/` + `src/app/api/temp-analytics/`, then strip the `TEMP ANALYTICS`-tagged lines in each instrumented page. Storage folder `temp-analytics/` can be cleared once the data is pulled.

## Temporary: personal-email migration (remove once the fleet is migrated)

- **What/why:** staff are moving off `@bluurock.com` addresses onto their own Google accounts. The permanent half of that change (allowlist auth, admin registration) is **not** temporary and stays. This section covers only the one-time migration of *existing* users.
- **The gate is [`src/lib/emailMigrationConfig.ts`](src/lib/emailMigrationConfig.ts)** — the single thing deciding who is prompted, modelled on `appUpdateConfig.ts`. `enabled: false` = nobody, and is the kill switch. Arm cohorts by `uids`, `groups`, or `allUsers`, each in its own commit. Shipped disarmed.
- **Mechanism:** [`EmailMigrationDialog`](src/components/migration/EmailMigrationDialog.tsx) (mounted in `(main)/layout.tsx`) shows a non-dismissible card → opens the system browser at `/auth/google?mode=migrate` via `window.open` (`setWindowOpenHandler` → `shell.openExternal`) → the existing `bluu://callback` deep link returns the code → posts it to [`/api/auth/migrate-email`](src/app/api/auth/migrate-email/route.ts).
  - **No Electron build is needed** — nothing under `electron/` changed, so rule 14's two-push dance does not apply. This ships as a plain Vercel deploy.
  - **Self-clearing:** the gate tests `workEmail` for the company domain, so a migrated user stops matching. No "already done" flag to keep in sync.
  - **Never interrupts a shift:** the dialog only arms while `displayState === 'clocked-out'`, re-checked for the whole app session (not latched once at boot like `UpdateAvailableBanner`) — so a user who leaves the app running across shifts is still caught the moment they clock out, instead of needing to fully quit and relaunch while already clocked out.
  - **Enforcement is soft** (a renderer dialog). Deliberate — this is a cooperative rollout.
  - The dialog listens on the **same** `oauth-callback` IPC channel as `Login`. Safe only because the two never coexist (Login renders without a session, the card only with one); `removeOAuthListeners` is `removeAllListeners`, so overlapping them would tear out each other's handlers.
- **To remove** (once no `users` doc has an `@bluurock.com` `workEmail`): delete `src/lib/emailMigrationConfig.ts`, `src/components/migration/`, `src/app/api/auth/migrate-email/`, the mount in `(main)/layout.tsx`, the `mode=migrate` branch in `src/app/(main)/auth/google/page.tsx`, and `isLegacyWorkEmail`/`LEGACY_WORK_EMAIL_DOMAIN` in `src/lib/authEmail.ts`. Keep `normalizeEmail` — that is permanent. Details in [auth.md](documentation/auth.md).

## Temporary: screenshot TCC repair (remove after fleet migrates off pre-signing builds)

- **What/why:** builds before the app was Developer ID signed left a macOS **ScreenCapture (Screen Recording) TCC record keyed to the old code identity**. After signing+notarization, macOS sees a different identity for `com.bluu.app` and re-prompts on every screenshot even though the toggle shows "on" — flipping it off/on doesn't help; only a `tccutil reset` does. This is a **one-time migration for existing users only**; new users are born correct.
- **Mechanism (renderer decides, native executes):**
  - Flag `screenshotBugFixed` on the user doc — set `true` at creation in [`ensureUserExists`](src/lib/services/userService.ts); **absent (falsy) on pre-existing users**, who are the ones needing the fix. Read for free off the `useUserData()` snapshot. Also **latched `true` whenever a reset fires** ([`markScreenshotBugFixed.ts`](src/lib/markScreenshotBugFixed.ts) → `/api/user/update`, server-validated one-way). **This latch is the once-ever cap on the automatic reset — remove it and macOS re-prompts affected users on every app start.**
  - **Three trigger sites**, all calling `electronAPI.permissions.resetScreenCapture()` (feature-detected):
    - **Onboarding (new users)** — [`onboarding/permission/screen/page.tsx`](src/app/(main)/onboarding/permission/screen/page.tsx) resets on mount **on macOS only**, so the grant the user sets in that step registers against the signed identity. No-op on a clean machine.
    - **Existing users** — [`TimeTrackingContext.tsx`](src/contexts/TimeTrackingContext.tsx): on the **first `capture-failed`** (not network) screenshot failure, if `screenshotBugFixed` is falsy, resets once per session. Firing on failure #1 lands the reset **before** the "enable it in OS settings" nudge, so the next prompt actually sticks. (Already-onboarded users never see the onboarding step, so they need this path.)
    - **Manual (Settings)** — [`AppSettingsForm.tsx`](src/components/settings/AppSettingsForm.tsx): a macOS-only "Reset Screenshot Permissions" field at the bottom of **App Settings** with a "Reset OS Permissions" button, for users the automatic paths did not fix. Re-runnable — it never consults `screenshotBugFixed`, it only latches it.
  - `permissions:resetScreenCapture` in [`electron/main.js`](electron/main.js): darwin-only `tccutil reset ScreenCapture com.bluu.app`. **No once-per-machine marker** — the old `.screencapture-tcc-reset-done` guard was removed so the Settings button can actually re-run for users whose automatic reset already fired. Exposed via [`preload.js`](electron/preload.js), typed optional in [`electron.d.ts`](src/types/electron.d.ts).
- **To remove** (once effectively all users are on a signed build and have been fixed): delete the `permissions:resetScreenCapture` handler in `main.js`, its `preload.js`/`electron.d.ts` entries, the mount reset in `onboarding/permission/screen/page.tsx`, the `tccResetAttemptedRef` block in `TimeTrackingContext.tsx`, the Settings field in `AppSettingsForm.tsx`, `src/lib/markScreenshotBugFixed.ts` + its `/api/user/update` allowlist entry, and the `screenshotBugFixed` field (type + `ensureUserExists`). All lines are tagged `TEMPORARY`. Details in [electron.md](documentation/electron.md#screen-capture-permission-repair-macos-tcc-temporary).

## Known Issues: Sharing & Permissions (`/admin/sharing`) — deferred work

The Sharing page's own three files were reworked on 2026-08-14 (real `<table>` semantics, shadcn `Popover`+`Command` pickers, toasts with Undo, AA-legal text colours, skeleton/empty/error states). The findings below were **deliberately left**, because every one of them lives in [`useAdminData.ts`](src/hooks/useAdminData.ts) or the permissions API route — both shared with other admin surfaces, and both out of scope for that pass. Fix them there, not by patching the Sharing page around them.

| # | Issue | Where | Fix |
|---|---|---|---|
| 1 | **A write can report success having written nothing.** `updatePermission` opens with `if (!user) return;`, which resolves the promise without a request. The caller's `try` sees no error, so the UI toasts success. | [`useAdminData.ts:110`](src/hooks/useAdminData.ts) | `throw new Error('Not signed in')` instead of returning. Pure bug; no behaviour anyone depends on. |
| 2 | **The real HTTP status can be masked by a parse error.** `await res.json()` runs inside the `!res.ok` branch, so a non-JSON error body (HTML 500, proxy timeout, empty 502) throws a `SyntaxError` that replaces the actual status. | [`useAdminData.ts:123`](src/hooks/useAdminData.ts) | Wrap the parse in try/catch and fall back to `\`Request failed: ${res.status}\``. |
| 3 | **Every checkbox toggle refetches the entire admin payload** — pages, teamspaces, pagePermissions, groups *and* users. A row of five group boxes is five full-dataset reads. Runs against cross-cutting rule 9. | [`useAdminData.ts:127-128`](src/hooks/useAdminData.ts) | Apply the server's response to local state instead of refetching, or refetch only `pagePermissions`. Needs an optimistic path in the hook so the page can stop disabling rows mid-write. |
| 4 | **Concurrent admins silently overwrite each other.** The write is read-modify-write over a snapshot up to **5 minutes** stale (`CACHE_TTL_MS`), PUT as the whole `{groups, users}` object. No version, no etag, no conflict signal — last write wins and nothing surfaces it. | [`useAdminData.ts:105-131`](src/hooks/useAdminData.ts) + `PUT /api/admin/pages/[pageId]/permissions` | Send a delta (`{ add: {...}, remove: {...} }`) and merge server-side, or version the doc and return 409 on mismatch so the client can toast "someone else changed this — reload". **Changes the API contract.** |
| 5 | **Out-of-order responses can write stale data into state.** `fetchAdminData` has no `AbortController` and no sequence guard, so overlapping refetches (see #3) can land in the wrong order — and that stale state then feeds the next read-modify-write in #4. | [`useAdminData.ts:55-97`](src/hooks/useAdminData.ts) | Abort the in-flight request on re-entry, or stamp each fetch and ignore responses older than the latest. |
| 6 | **Self-lockout is possible.** An admin can revoke their own group's access to the admin teamspace; the route only checks the *caller's* admin claim, never the *result*. | `PUT /api/admin/pages/[pageId]/permissions` | Reject (or warn on) a write that would remove the acting admin's own access to an admin-teamspace page. Server-side — a client-side guard is not a real one. |
| 7 | **No audit trail.** Nothing records who changed a page's permissions or when, on the surface that controls access to the whole app. | permissions API + a new collection | Write an audit entry per permission change; surface a "recent changes" strip on the page. Would also serve as the missing confirmation and history. |
| 8 | **Dead payload.** `members: string[]` and `photoURL` are fetched and typed on every request but never rendered. `members` is exactly the data a blast-radius confirm ("12 people will lose this page") needs. | [`useAdminData.ts:14,21`](src/hooks/useAdminData.ts) | Either use them or stop fetching them. |

Two related notes on the page itself, both **intentional** rather than outstanding:
- **Revoke is one click with an Undo toast, not a confirm dialog.** A deliberate choice — granting and revoking stay symmetric and fast, and the Undo re-PUTs the exact permission map that was replaced. If revocation ever needs a confirm, item 8's `members` count is the thing to show in it.
- **Checked checkboxes render near-white, not Action Blue.** That is the app-wide `--primary` issue already documented in [DESIGN.md](DESIGN.md) §2, not drift local to this page. Fixing it is a global change.

## Documentation Index (spokes)

| Spoke | Read it when you are touching… |
|---|---|
| [DESIGN.md](DESIGN.md) | **Any frontend UI** — design system: palette, typography, surfaces, components, motion, dashboard-widget pattern |
| [architecture-overview.md](documentation/architecture-overview.md) | Repo layout, commands, env vars, portal topology, UI stack |
| [auth.md](documentation/auth.md) | Browser middleware, OAuth login, `withAuth`/`withCreatorAuth`, the 3 authorization tiers |
| [onboarding.md](documentation/onboarding.md) | First-run flow: download → login → terms → OS permissions → personal details, the `AuthWrapper` guard, `hasAcceptedTerms`/`hasCompletedOnboarding`, `/terms` |
| [permissions.md](documentation/permissions.md) | Page definitions, `page-permissions`, `permittedPageIds`, `checkPageAccess` |
| [data-layer.md](documentation/data-layer.md) | Server services, client hooks, Firestore collections, read-optimization rules, session token |
| [time-tracking.md](documentation/time-tracking.md) | Event-log sessions, `sessionCloseMs`, crash robustness, activity percent, **analytics rollups** |
| [notifications.md](documentation/notifications.md) | `notificationContent.ts`, `addNotificationToBatch`, event → factory table |
| [smm-portal.md](documentation/smm-portal.md) | **SMM Portal** — Twitter/X accounts, the content schedule, the bonus rounds/submissions engine, Viral Accounts + page suggestions |
| [campaign-tracking.md](documentation/campaign-tracking.md) | Custom requests vs campaigns, the two archive mechanisms, transfer |
| [resources.md](documentation/resources.md) | `apps-resources` page, `app-resources` collection, resource management, group/user filtering |
| [prompt-library.md](documentation/prompt-library.md) | **Prompt Library** — `prompt-library` collection, per-prompt version history + diffing, the client-side search engine, the LLM logo pipeline |
| [onlyfans-crm.md](documentation/onlyfans-crm.md) | **OF Manager** — the OnlyFans messaging window, the `IOnlyFansClient` adapter seam, the Firestore chat mirror + provider webhook |
| [model-submissions.md](documentation/model-submissions.md) | The **public** application form `/model-submissions` (the project's only unauthenticated write path), its abuse model, and the `apps-model-submissions` review queue |
| [boot-loading-screen.md](documentation/boot-loading-screen.md) | `BootLoaderProvider`, `useBootPhase`, home-widget gating |
| [user-management.md](documentation/user-management.md) | Archiving vs deleting users, name resolution, profile pictures |
| [electron.md](documentation/electron.md) | `electron/` shell, `window.electronAPI` IPC surface, deep-link OAuth, crash/offline recovery, clock-out flush, power events, version nudge, build/release |

## Cross-Cutting Rules (do not violate)

1. **Firestore rules/indexes** — notify the user on any change. Display the command needed to deploy.
2. **User doc writes** — call `invalidateUserCache(uid)` in the same handler (`getUserById` has a 60s cache). See [data-layer.md](documentation/data-layer.md#firestore-read-optimization-rules).
3. **Authorization tier choice** — new admin-action routes affecting the auth graph or account state require the **admin claim**, not page permission. See [auth.md](documentation/auth.md#authorization-tiers-least--most-privileged).
3b. **Login is an allowlist** — `/api/auth/exchange-code` must never create a `users` doc or an Auth account for an unknown address, and must resolve the uid from the `users` doc (not `adminAuth.getUserByEmail` alone). Accounts are created only by `POST /api/admin/users`. Every refusal returns the same generic 403, so staff cannot be enumerated. See [auth.md](documentation/auth.md#the-allowlist-the-authorisation-gate).
4. **Elapsed time from buffers** — always close with `sessionCloseMs` before `parseBuffer`; never `parseBuffer(events, Date.now())` over a buffer set. See [time-tracking.md](documentation/time-tracking.md#2-session-close-time--sessionclosems-single-source-of-truth).
5. **Notification copy** — only edit `src/lib/notificationContent.ts`; write via `addNotificationToBatch`. **Every new automated notification must also be added to [`src/lib/automatedNotifications.ts`](src/lib/automatedNotifications.ts) in the same change** — see rule 15.
6. **Archive ≠ delete** — filter `isArchived` from user pickers; add new per-user collections to the delete cascade. See [user-management.md](documentation/user-management.md).
7. **Avatars** — only `src/components/ui/avatar.tsx`, never `<img>`. Always seed the fallback from **`displayName`** (`getAvatarColor`/`getInitials`); the colour is a hash of that string, so any other seed renders the same person differently across screens. See [DESIGN.md](DESIGN.md#5-components) (The Avatar Seed Rule).
8. **Home-page widgets** — async widgets must gate boot via `useBootPhase('home-<name>', isLoading)`.
9. **Minimise Firestore I/O** — always minimise Firestore reads and writes where possible: prefer cached reads (`getUserById`, the sessionStorage hooks), batch with `adminDb.getAll(...)` / batched writes, and lean on JWT claims (`token.admin`) over reads. Never add an N+1 read or a redundant write.
9b. **NEVER call the OnlyFans provider API yourself.** Do not run scripts, `curl`, or any other command that hits `app.onlyfansapi.com` — not to explore a payload, not to verify a field name, not to diagnose a bug. **Every call is billed**, and a diagnostic loop burns credits fast. The permitted sources are [`openapi.yaml`](openapi.yaml), [the provider's docs](https://docs.onlyfansapi.com/api-reference/overview), and whatever the user shows you (screenshots, pasted payloads). If the documentation does not answer the question, **ask the user for the payload** — never fetch it. Write the code defensively instead (probe plausible field spellings, as `parseWebhookEvent` already does) and say plainly what remains unverified.

10. **Security first** — security principles must always be followed and prioritised. No vulnerability may linger after implementing a change: validate/authorize every request at the correct tier, never trust client input, never leak server-only secrets to the client, and never widen access as a shortcut.
11. **Keep docs current** — always update the documentation repository ([`documentation/`](documentation/) + this hub) when a change makes a spoke or a cross-cutting rule inaccurate. Treat docs as part of the change, not a follow-up.
12. **Read docs before changing a component** — always read the relevant spoke in [`documentation/`](documentation/) (via the index above) before making any change to that component. Understand its rules, dependencies, and gotchas first — never edit a subsystem from the hub alone.
13. **ONLY use shadcn components for UI** - existing components exist in `src/components/ui`. More components can be added using command, e.g. `npx shadcn@latest add card`. **Read [`DESIGN.md`](DESIGN.md) before writing or changing any frontend UI** and follow its conventions; treat updating it as part of any change to the visual language.
14. **Electron changes → a new build, released in TWO pushes** — any change under `electron/` (or that otherwise requires users to reinstall the app) means a new build must be shipped. **[`src/lib/appUpdateConfig.ts`](src/lib/appUpdateConfig.ts) is the single gate for every update prompt on both platforms**: it is per-platform (`mac` / `win`), a `null` entry means that OS is never prompted, and `compulsory: true` blocks clients at start-up. macOS (v0.8.0+) installs in-app; Windows has no valid signing cert and reinstalls by hand. Always bump `electron/package.json` `version` — **electron-builder names the release from that file, not from the tag**.

    **NEVER arm the config in the same push as the code.** Vercel deploys in seconds; the GitHub Actions build takes ~10–30 min (Apple notarization is the long pole). Arming first blocks every user against a release that does not exist yet — and on a compulsory update they cannot use the app while they wait. Prompt the user through this order, and never skip step 3:

    ```bash
    # 1. Push the code with the platform entry still `null`.
    #    Vercel deploys instantly — harmless, because null prompts nobody.
    git add -A && git commit -m "App Enhancements" && git push origin main

    # 2. Tag THE COMMIT YOU JUST PUSHED. Actions runs the workflow from the
    #    tagged commit, so a tag on an earlier commit silently rebuilds the old
    #    version and publishes it to the old release. Tag after committing.
    git tag v0.8.0 && git push origin v0.8.0

    # 3. WAIT for the run to finish, then verify the release before arming:
    #    latest-mac.yml + both .dmg + both .zip (arm64 AND x64).
    #    A missing zip/manifest = auto-update silently dead.
    gh release view v0.8.0

    # 4. Update the `downloadUrl` page with the new installers (label
    #    Apple Silicon vs Intel — the x64 .dmg has NO arch suffix).

    # 5. ONLY NOW arm the config (set the `mac`/`win` entry) and push again.
    git add -A && git commit -m "Announce v0.8.0" && git push origin main
    ```

    Leave a platform `null` if the release does not affect it (e.g. a mac-only fix must not make Windows reinstall). See [electron.md](documentation/electron.md).

15. **New automated notification → update the Automated Notifications catalogue** — the **Automated** tab of `/admin/notifications` is the admin-facing record of everything the system sends on its own, and it renders entirely from `AUTOMATED_NOTIFICATIONS` in [`src/lib/automatedNotifications.ts`](src/lib/automatedNotifications.ts). Any change that adds, removes, or re-targets an automated notification is **incomplete** until that array matches. In the **same** change:
    - Add/update/remove the entry (`id` = factory name, plus `category`, `event`, `trigger`, `recipients`, `sources`).
    - **Call the real factory** with `{token}` placeholders for interpolated values — never retype a title or message here (rule 5: copy lives only in `notificationContent.ts`).
    - A new category also needs adding to `AutomatedNotificationCategory` **and** `AUTOMATED_NOTIFICATION_CATEGORIES` (the second is what the UI iterates — miss it and the section renders nowhere).
    - Add the matching row to the event → factory table in [notifications.md](documentation/notifications.md#notification-events--factory-functions).

    This applies to admin broadcasts only in reverse: manual sends belong on the **Sent** tab and must **not** be added here.

16. **Impeccable workflows may spawn sub-agents** — standing authorisation. When running any `/impeccable` command (`critique`, `audit`, `polish`, `craft`, …), spawn the isolated sub-agents its reference file requires **without asking first**. This overrides the general "don't spawn sub-agents unless the user requested it" default: invoking an `/impeccable` command **is** the request. `critique` in particular mandates two independent, parallel agents (Assessment A: design review · Assessment B: detector + browser evidence) that must not see each other's output — running them inline in one context is a **degraded** run and must be banner-flagged as such, so don't do it here. Applies to `/impeccable` only; it does not widen sub-agent use for ordinary work.

## Maintaining This Documentation

- This hub stays **high-level**: system map, spoke index, cross-cutting rules. Granular detail belongs in a spoke.
- When a subsystem's behavior changes, update its **spoke file**; only update this hub if the system map, the index, or a cross-cutting rule changes.
- New subsystem → add a spoke in `documentation/` and one row to the index above.
