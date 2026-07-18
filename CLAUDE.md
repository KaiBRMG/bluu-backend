# CLAUDE.md

This file guides Claude Code (claude.ai/code) when working in this repository. It is the **hub** of a hub-and-spoke documentation model: this file holds the high-level system map; deep-dive detail for each subsystem lives in [`documentation/`](documentation/). **When working on a subsystem, open its spoke file first — do not rely on this hub alone.**

## Context

- Internal management platform for **Bluu Rock MGMT**.
- **RULE:** Always notify the user if changes are made to **Firestore rules** or **Firestore indexes**.
- **RULE:** Only use visual components/styling from `src/components/ui`; only use `@tabler/icons-react` and `lucide-react` for icons. (Full UI stack in [architecture-overview.md](documentation/architecture-overview.md#ui-stack-strict-constraints).)
- If the user mentions "clocked in", "clocked out", "clock in", "clock out", they are referring to the time tracking subsystem.

## System at a Glance

```
                    ┌───────────────────────────────────────────────┐
 Electron desktop ─►│  Internal portals  /ca-portal /admin /apps    │─► AuthProvider + withAuth
 (employees only)   └───────────────────────────────────────────────┘
                    ┌───────────────────────────────────────────────┐
 System browser  ─►│  Creator portal    /creator-portal            │─► CreatorAuthProvider + withCreatorAuth
 (creators)         └───────────────────────────────────────────────┘

 src/middleware.ts  → rewrites all non-Electron, non-allowlisted page traffic to /desktop-only
 Firestore + Storage (Firebase Admin SDK) ← services (src/lib/services) ← API routes (src/app/api)
 Client hooks (src/hooks) ← contexts (src/contexts) ← React 19 / Next 16 App Router UI
 functions/ → generateThumbnail (Storage trigger) + daily stale-session cleanup
              + daily page-permissions sync + nightly analytics rollup
```

- **Monorepo:** `src/` (Next.js 16 web app, primary), `electron/` (desktop wrapper), `src/app/creator-portal/` (creator interface), `functions/` (Cloud Functions).
- **Auth:** Google OAuth only; admin status is a JWT custom claim (`token.admin`), not a Firestore read.
- Full repo layout, commands, and env vars: [architecture-overview.md](documentation/architecture-overview.md).

## Temporary Instrumentation (remove after data collection)

- **CA-portal screenshot analytics** — a once-off, throwaway capture on select CA-portal pages. Grabs the user's screen (via the Electron native `captureScreenshot()`) with a 1s delay per trigger, and uploads to Storage under `temp-analytics/{uid}/` (filename prefixed with the page key). Gated **per page, per user** by a `localStorage` marker so each page fires **once per user, ever**. No Firestore docs/rules/indexes involved.
  - Instrumented pages (all under `src/app/(main)/ca-portal/`): `disputes` (page open + Unresolved/Resolved tab switches on both tables), `custom-requests` (page open only), `campaigns` (page open only).
  - Hook: `src/lib/temp-analytics/useTempAnalyticsScreenshot.ts` (`useTempAnalyticsScreenshot(pageKey)`) · Route: `src/app/api/temp-analytics/screenshot/route.ts` · Call sites: the three pages above (search `TEMP ANALYTICS`).
  - **To remove:** delete `src/lib/temp-analytics/` + `src/app/api/temp-analytics/`, then strip the `TEMP ANALYTICS`-tagged lines in each instrumented page. Storage folder `temp-analytics/` can be cleared once the data is pulled.

## Temporary: screenshot TCC repair (remove after fleet migrates off pre-signing builds)

- **What/why:** builds before the app was Developer ID signed left a macOS **ScreenCapture (Screen Recording) TCC record keyed to the old code identity**. After signing+notarization, macOS sees a different identity for `com.bluu.app` and re-prompts on every screenshot even though the toggle shows "on" — flipping it off/on doesn't help; only a `tccutil reset` does. This is a **one-time migration for existing users only**; new users are born correct.
- **Mechanism (renderer decides, native executes):**
  - Flag `screenshotBugFixed` on the user doc — set `true` at creation in [`ensureUserExists`](src/lib/services/userService.ts); **absent (falsy) on pre-existing users**, who are the ones needing the fix. Read for free off the `useUserData()` snapshot.
  - **Two trigger sites**, both calling `electronAPI.permissions.resetScreenCapture()` (feature-detected):
    - **Onboarding (new users)** — [`onboarding/permission/screen/page.tsx`](src/app/(main)/onboarding/permission/screen/page.tsx) resets on mount **on macOS only**, so the grant the user sets in that step registers against the signed identity. No-op on a clean machine.
    - **Existing users** — [`TimeTrackingContext.tsx`](src/contexts/TimeTrackingContext.tsx): on the **first `capture-failed`** (not network) screenshot failure, if `screenshotBugFixed` is falsy, resets once per session. Firing on failure #1 lands the reset **before** the "enable it in OS settings" nudge, so the next prompt actually sticks. (Already-onboarded users never see the onboarding step, so they need this path.)
  - `permissions:resetScreenCapture` in [`electron/main.js`](electron/main.js): darwin-only `tccutil reset ScreenCapture com.bluu.app`, capped at **once per OS user, ever** by a `.screencapture-tcc-reset-done` marker in `userData` (correct granularity — TCC is per OS-user+bundle, not per Bluu uid). Exposed via [`preload.js`](electron/preload.js), typed optional in [`electron.d.ts`](src/types/electron.d.ts).
- **To remove** (once effectively all users are on a signed build and have been fixed): delete the `permissions:resetScreenCapture` handler in `main.js`, its `preload.js`/`electron.d.ts` entries, the mount reset in `onboarding/permission/screen/page.tsx`, the `tccResetAttemptedRef` block in `TimeTrackingContext.tsx`, and the `screenshotBugFixed` field (type + `ensureUserExists`). All lines are tagged `TEMPORARY`. Details in [electron.md](documentation/electron.md#screen-capture-permission-repair-macos-tcc-temporary).

## Documentation Index (spokes)

| Spoke | Read it when you are touching… |
|---|---|
| [architecture-overview.md](documentation/architecture-overview.md) | Repo layout, commands, env vars, portal topology, UI stack |
| [auth.md](documentation/auth.md) | Browser middleware, OAuth login, `withAuth`/`withCreatorAuth`, the 3 authorization tiers |
| [permissions.md](documentation/permissions.md) | Page definitions, `page-permissions`, `permittedPageIds`, `checkPageAccess` |
| [data-layer.md](documentation/data-layer.md) | Server services, client hooks, Firestore collections, read-optimization rules, session token |
| [time-tracking.md](documentation/time-tracking.md) | Event-log sessions, `sessionCloseMs`, crash robustness, activity percent, **analytics rollups** |
| [notifications.md](documentation/notifications.md) | `notificationContent.ts`, `addNotificationToBatch`, event → factory table |
| [campaign-tracking.md](documentation/campaign-tracking.md) | Custom requests vs campaigns, the two archive mechanisms, transfer |
| [resources.md](documentation/resources.md) | `apps-resources` page, `app-resources` collection, resource management, group/user filtering |
| [boot-loading-screen.md](documentation/boot-loading-screen.md) | `BootLoaderProvider`, `useBootPhase`, home-widget gating |
| [user-management.md](documentation/user-management.md) | Archiving vs deleting users, name resolution, profile pictures |
| [electron.md](documentation/electron.md) | `electron/` shell, `window.electronAPI` IPC surface, deep-link OAuth, crash/offline recovery, clock-out flush, power events, version nudge, build/release |

## Cross-Cutting Rules (do not violate)

1. **Firestore rules/indexes** — notify the user on any change. Display the command needed to deploy.
2. **User doc writes** — call `invalidateUserCache(uid)` in the same handler (`getUserById` has a 60s cache). See [data-layer.md](documentation/data-layer.md#firestore-read-optimization-rules).
3. **Authorization tier choice** — new admin-action routes affecting the auth graph or account state require the **admin claim**, not page permission. See [auth.md](documentation/auth.md#authorization-tiers-least--most-privileged).
4. **Elapsed time from buffers** — always close with `sessionCloseMs` before `parseBuffer`; never `parseBuffer(events, Date.now())` over a buffer set. See [time-tracking.md](documentation/time-tracking.md#2-session-close-time--sessionclosems-single-source-of-truth).
5. **Notification copy** — only edit `src/lib/notificationContent.ts`; write via `addNotificationToBatch`.
6. **Archive ≠ delete** — filter `isArchived` from user pickers; add new per-user collections to the delete cascade. See [user-management.md](documentation/user-management.md).
7. **Avatars** — only `src/components/ui/avatar.tsx`, never `<img>`.
8. **Home-page widgets** — async widgets must gate boot via `useBootPhase('home-<name>', isLoading)`.
9. **Minimise Firestore I/O** — always minimise Firestore reads and writes where possible: prefer cached reads (`getUserById`, the sessionStorage hooks), batch with `adminDb.getAll(...)` / batched writes, and lean on JWT claims (`token.admin`) over reads. Never add an N+1 read or a redundant write.
10. **Security first** — security principles must always be followed and prioritised. No vulnerability may linger after implementing a change: validate/authorize every request at the correct tier, never trust client input, never leak server-only secrets to the client, and never widen access as a shortcut.
11. **Keep docs current** — always update the documentation repository ([`documentation/`](documentation/) + this hub) when a change makes a spoke or a cross-cutting rule inaccurate. Treat docs as part of the change, not a follow-up.
12. **Read docs before changing a component** — always read the relevant spoke in [`documentation/`](documentation/) (via the index above) before making any change to that component. Understand its rules, dependencies, and gotchas first — never edit a subsystem from the hub alone.
13. **ONLY use shadcn components for UI** - existing components exist in `src/components/ui`. More components can be added using command, e.g. `npx shadcn@latest add card`.
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

## Maintaining This Documentation

- This hub stays **high-level**: system map, spoke index, cross-cutting rules. Granular detail belongs in a spoke.
- When a subsystem's behavior changes, update its **spoke file**; only update this hub if the system map, the index, or a cross-cutting rule changes.
- New subsystem → add a spoke in `documentation/` and one row to the index above.
