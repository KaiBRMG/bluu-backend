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
```

- **Monorepo:** `src/` (Next.js 16 web app, primary), `electron/` (desktop wrapper), `src/app/creator-portal/` (creator interface), `functions/` (Cloud Functions).
- **Auth:** Google OAuth only; admin status is a JWT custom claim (`token.admin`), not a Firestore read.
- Full repo layout, commands, and env vars: [architecture-overview.md](documentation/architecture-overview.md).

## Temporary Instrumentation (remove after data collection)

- **CA-portal screenshot analytics** — a once-off, throwaway capture on select CA-portal pages. Grabs the user's screen (via the Electron native `captureScreenshot()`) with a 1s delay per trigger, and uploads to Storage under `temp-analytics/{uid}/` (filename prefixed with the page key). Gated **per page, per user** by a `localStorage` marker so each page fires **once per user, ever**. No Firestore docs/rules/indexes involved.
  - Instrumented pages (all under `src/app/(main)/ca-portal/`): `disputes` (page open + Unresolved/Resolved tab switches on both tables), `custom-requests` (page open only), `campaigns` (page open only).
  - Hook: `src/lib/temp-analytics/useTempAnalyticsScreenshot.ts` (`useTempAnalyticsScreenshot(pageKey)`) · Route: `src/app/api/temp-analytics/screenshot/route.ts` · Call sites: the three pages above (search `TEMP ANALYTICS`).
  - **To remove:** delete `src/lib/temp-analytics/` + `src/app/api/temp-analytics/`, then strip the `TEMP ANALYTICS`-tagged lines in each instrumented page. Storage folder `temp-analytics/` can be cleared once the data is pulled.

## Documentation Index (spokes)

| Spoke | Read it when you are touching… |
|---|---|
| [architecture-overview.md](documentation/architecture-overview.md) | Repo layout, commands, env vars, portal topology, UI stack |
| [auth.md](documentation/auth.md) | Browser middleware, OAuth login, `withAuth`/`withCreatorAuth`, the 3 authorization tiers |
| [permissions.md](documentation/permissions.md) | Page definitions, `page-permissions`, `permittedPageIds`, `checkPageAccess` |
| [data-layer.md](documentation/data-layer.md) | Server services, client hooks, Firestore collections, read-optimization rules, session token |
| [time-tracking.md](documentation/time-tracking.md) | Event-log sessions, `sessionCloseMs`, crash robustness, activity percent |
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
14. **Electron changes → prompt an update bump** — the desktop shell can't auto-update, so any change under `electron/` (or that otherwise requires users to reinstall the app) means a new build must be shipped. Whenever you touch `electron/`, remind the user to bump `latestVersion` (and set `downloadUrl`/`compulsory`) in [`src/lib/appUpdateConfig.ts`](src/lib/appUpdateConfig.ts) and bump `electron/package.json` `version`, so the in-app update prompt fires. See [electron.md](documentation/electron.md). Whenever the electron version is bumped, prompt the following commands: `git tag v0.7.0
git push origin v0.7.0
`.

## Maintaining This Documentation

- This hub stays **high-level**: system map, spoke index, cross-cutting rules. Granular detail belongs in a spoke.
- When a subsystem's behavior changes, update its **spoke file**; only update this hub if the system map, the index, or a cross-cutting rule changes.
- New subsystem → add a spoke in `documentation/` and one row to the index above.
