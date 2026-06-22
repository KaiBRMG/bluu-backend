# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

This is an internal management platform for Bluu Rock MGMT.

Always notify the user if changes are made to firestore rules or firestore indexes.

## Repository Structure

This is a monorepo with three distinct sub-projects:

- **`src/`** — Next.js 16 web app (App Router, TypeScript, React 19). The primary codebase. Run all Next.js commands from this directory. This is the main web app and services all employees.
- **`electron/`** — Electron wrapper that embeds the Next.js app in a desktop application. Employees only have access via this Electron app.
- **`src/app/creator-portal/`** — The interface for clients (known as creators). This interface is separate from the main system and uses a different Auth flow.
- **`functions/`** — Firebase Cloud Functions (Node.js, plain JS). Two functions: `generateThumbnail` (Storage trigger) and a daily scheduled cleanup for stale sessions.

## Commands

All Next.js commands run from `src/`:

```bash
cd src
npm run dev          # Start dev server
npm run build        # Production build (uses 4GB Node heap)
npm run lint         # ESLint
npm run analyze      # Bundle analyzer (sets ANALYZE=true)
```

Firestore rules tests (requires Firebase Emulator on port 8080):

```bash
cd tests/firestore-rules
npm test             # Run all rules tests
npm run test:watch   # Watch mode
```

Electron desktop app (from `electron/`):

```bash
cd electron
npm run dev          # Run in dev mode
npm run dist:mac     # Build macOS distributable
```

## Environment Variables

Required in `src/.env.local`:

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
FIREBASE_SERVICE_ACCOUNT   # JSON string of service account key
```

## Architecture

### Browser Access Middleware

`src/middleware.ts` blocks all non-Electron browser access to the app. The matcher covers every page route (excludes `_next`, `api`, and static assets).

**Logic:**
1. If the request path starts with a `BROWSER_ALLOWED_PREFIXES` entry → allow through unconditionally.
2. If the `User-Agent` header contains `Electron/` → allow through (this is the desktop app).
3. Otherwise → rewrite the request to `/desktop-only` (a browser-safe page telling users to use the desktop app).

**Currently allowed browser prefixes:**
- `/auth` — OAuth flow pages (`/auth/google`, `/auth/callback`). These run in the system browser during login and must be reachable without Electron.
- `/creator-portal` — External creator interface, browser-accessible by design.
- `/desktop-only` — The "use the desktop app" landing page itself.

When adding a new route that legitimately needs browser access, add its prefix to `BROWSER_ALLOWED_PREFIXES` in `src/middleware.ts`. The `api` routes are already excluded from the matcher and are unaffected by this middleware.

### Auth Flow

Authentication is Google OAuth only. The full login sequence for internal employees is:

1. User clicks **Login** in the Electron app.
2. Electron opens the system browser to `/auth/google`.
3. `/auth/google` (server component) immediately redirects to `accounts.google.com` with the OAuth params.
4. Google redirects back to `/auth/callback?code=...` (still in the browser).
5. `/auth/callback` (client component) reads the `code` param and redirects to `bluu://callback?code=...` — a custom deep link that hands the code back to Electron.
6. Electron calls `/api/auth/exchange-code`, which exchanges the code for a Firebase custom token, sets custom claims (`admin: true/false`), and creates/updates the user document.
7. The Electron app signs in to Firebase with the custom token.

API routes involved:
- `/api/auth/google-url` — generates OAuth URL (used by Electron directly; `/auth/google` builds the URL itself server-side)
- `/api/auth/exchange-code` — exchanges code for Firebase custom token, sets custom claims, creates/updates the user document

Admin status comes from a **JWT Custom Claim** (`token.admin`), not a Firestore read. The claim is set at login and refreshed when group membership changes.

There are two separate auth contexts:
- **`AuthProvider`** (`src/components/AuthProvider.tsx`) — for internal employees (`@bluurock.com` emails), enforces `isActive` check
- **`CreatorAuthProvider`** (`src/components/CreatorAuthProvider.tsx`) — for external creator accounts, used only in the creator portal

### API Route Auth Middleware

All API routes are wrapped with one of two middleware functions:
- **`withAuth`** (`src/lib/middleware/withAuth.ts`) — verifies Firebase Bearer token, injects `DecodedIdToken`
- **`withCreatorAuth`** (`src/lib/middleware/withCreatorAuth.ts`) — same as above, but also verifies the user exists in the `creators` Firestore collection and `isActive !== false`

#### Authorization tiers

Inside handlers, authorization layers on top of the middleware. From least to most privileged:

1. **Authenticated only** — `withAuth` alone. Use for general reference data (e.g. `/api/creators`, `/api/users/display-names`, `/api/disputes/users`) needed across many pages where a single page-permission check would block legitimate callers.
2. **Page permission** — `checkPageAccess(token.uid, '<pageId>')` from `apiHelpers.ts` or inline `caller.permittedPageIds.includes(...)`. Most admin/feature endpoints use this tier.
3. **Admin claim** — `token.admin !== true` guard. Reserve for actions that gate access to the system itself or the authorization graph. Required for:
   - **Admin group membership writes** (`/api/admin/groups/admin/members` POST/DELETE) — also blocks self-promotion (`uids.includes(token.uid)`).
   - **Page-permission map writes** (`/api/admin/pages/[pageId]/permissions` PUT) — editing this map is the root of all other authorization decisions, so it must require admin even though `'sharing'` page permission still gates the read.

When adding a new admin-action route, decide which tier applies; do not default to "page permission" if the action affects the auth graph or account state.

### Portal Structure

Three distinct portals, each with its own layout/auth:

| Portal | Route prefix | Auth |
|--------|-------------|------|
| Internal (employees) | `/ca-portal/`, `/admin/`, `/applications/` | `AuthProvider` + `withAuth` |
| Creator | `/creator-portal/` | `CreatorAuthProvider` + `withCreatorAuth` |

### Data Layer

**Server-side services** (`src/lib/services/`):
- `userService.ts` — 60s in-process cache; call `invalidateUserCache(uid)` after any user doc write
- `pageService.ts` — page permission resolution
- `timeEntryService.ts`, `screenshotService.ts`, `shiftService.ts`, etc.

**Client-side data hooks** (`src/hooks/`):
- `useUserData` — live `onSnapshot` on the user doc (serves from IndexedDB cache on reload)
- `useTimesheetData` — sessionStorage cache (5 min TTL); call `invalidateTimesheetCache(uid)` after clock-in/out
- `useDisputesData` — wraps all disputes API routes; creator/CA user lists cached in sessionStorage (5 min)
- `useCreators` — fetches the active creator list (including `photoURL`) with a 5-min sessionStorage cache (`bluu_creators_v2`). Use this hook on any page that needs creator names or profile pictures; do not fetch `/api/creators` directly.
- Permissions are cached in localStorage via `src/lib/permissionsCache.ts` (no TTL)

### Firestore Collections

Key collections and their purpose:
- `users/{uid}` — internal employee documents (`UserDocument`)
- `creators/{uid}` — external creator accounts (`CreatorFullDocument`)
- `active_sessions/{userId}` — lightweight presence doc; deleted on clock-out
- `time_entries/{sessionId}` — permanent ledger written at clock-out
- `page-permissions/{pageId}` — which groups/users can access each page
- `screenshots/{docId}` — screenshot metadata; Storage paths for full-size and thumbnails
- `shifts/{shiftId}` — recurring/one-off shift definitions
- `disputes/{disputeId}` — dispute records for the CA portal
- `notifications/{docId}`, `notifications-batches/{batchId}` — notification system

The `TimeEntryDocument` interface is `@deprecated`; new sessions use `ActiveSessionDocument` + `TimeEntryLedgerDocument`.

### Firestore Read Optimisation

- `getUserById` has a 60s TTL in-process cache — any route that writes a user doc must call `invalidateUserCache(uid)` in the same handler
- Batch reads use `adminDb.getAll(...refs)` to avoid N+1 reads
- `enableScreenshots` is read from the client-side `useUserData` snapshot, NOT from the time-tracking status API
- The `isAdmin()` Firestore security rule uses `request.auth.token.admin` (JWT claim) — zero Firestore reads

### Session Token (Single Active Session)

`users/{uid}.sessionToken` is a UUID rotated on every login. The client stores it locally; `onSnapshot` on the user doc detects a mismatch and forces sign-out, enforcing single active session.

### Time Tracking Session Model

Sessions use an event log architecture:
1. Client appends events (`clock-in`, `idle-start`, `break-start`, etc.) to a local buffer (`src/lib/localBuffer.ts`)
2. Heartbeat API (`/api/time-tracking/heartbeat`) updates `active_sessions/{userId}.lastUpdated` and `currentState`
3. On clock-out, the full event log is uploaded and `time_entries/{sessionId}` is written
4. The daily Cloud Function closes stale sessions (no heartbeat for 6+ hours) that weren't explicitly clocked out

`active_sessions/{userId}` is keyed by uid, so a user can only ever have **one**
server-side active session. "Two active sessions" symptoms are always a
client-side rendering/buffer issue, never two server docs.

#### Session close time — `sessionCloseMs` (single source of truth)

Any client-side code that derives elapsed time from local buffers MUST close a
session's open segments with `sessionCloseMs(buf, isActive, now)` from
`src/lib/parseBuffer.ts`, then pass the result as `parseBuffer`'s `nowMs` arg.

- **Active session only** (`buf.sessionId === sessionId && displayState !== 'clocked-out'`) extends to `now`.
- Every other buffer closes at its `clock-out` event, or — if it has none (an
  abandoned/orphaned session) — at its **last recorded event**.

Without this, a clock-out-less buffer's open working segment is counted all the
way to `now`, inflating totals and rendering as a phantom "live, working"
session while the user is clocked out. Consumers: `TodayTimeline.tsx` (timeline
bars + per-row totals) and `useDayTotal.ts` (the "TODAY" total). Do not call
`parseBuffer(buf.events, Date.now())` directly over a set of buffers.

`useDayTotal` and `TodayTimeline`'s *Total worked* MUST stay in sync: both sum
`workingSeconds + breakSeconds` (idle and pause excluded). The "TODAY" figure on
the timer page is required to equal the timesheet's *Total worked* exactly.

#### Crash / restart robustness

- **App close appends a real `clock-out` event** to the local buffer (in
  `TimeTrackingContext`'s `clockOutAndFlush`) before marking
  `active_sessions.userClockOut = true`, so the buffer is self-describing and can
  never render as live even if later orphaned.
- **Hydration is gated by `isHydrating`** (exposed on the context). On startup the
  pending-buffer reconciliation is `await`ed and the Clock In button is disabled
  until it finishes. This prevents an impatient click from starting a second
  session that races the in-flight upload and orphans the old buffer.
- **`startTracking` reconciles, never blindly discards.** When `/start` returns
  `alreadyActive`, it commits a matching local buffer (`silentLogUpload` →
  `commitSession`, which both writes `time_entries` and deletes the
  `active_sessions` doc) instead of discarding; it only `/discard`s when there is
  genuinely no local buffer (session started on another device).
- **Display self-heal**: the 1s timer tick freezes when the main thread is blocked
  (e.g. a heavy page load), so a `visibilitychange`/`focus` listener recomputes
  elapsed from `entryStartTime + Date.now()` to snap the display back immediately.
- App close is a deliberate soft clock-out — reopening never auto-resumes a
  gracefully-closed session; it commits it and shows a toast. Orphaned
  server-side sessions are cleaned by the daily Cloud Function (above); the client
  does not force-delete server sessions during hydration.

### Activity Percent (Screenshots & Active Users)

`activityPercent` is currently derived from the session event log by comparing
`workingSeconds` vs `idleSeconds` within each screenshot window
(`src/contexts/TimeTrackingContext.tsx` → `calcActivityPercent`). This is
coarse: because the time tracker only flips to `idle` after 15 minutes
without input (`IDLE_THRESHOLD_SECONDS`), low-input periods under that
threshold register as 100% active.

**Preferred (more accurate) method — powerMonitor input samples.** Once a new
Electron update is pushed to all users (so every desktop client exposes
`window.electronAPI.timeTracking.getActivitySince`), the screenshot upload
path in `src/contexts/TimeTrackingContext.tsx` should be reverted to the
sample-based calculation below. It buckets the window into 1-minute slots
and marks each slot active if any keyboard/mouse input occurred — measured
at the OS level via `powerMonitor.getSystemIdleTime()`.

```ts
/** Compute activity % from powerMonitor idle-time samples between windowStart and windowEnd. */
function calcActivityPercent(
  samples: Array<{ sampleMs: number; idleSeconds: number }>,
  windowStart: number,
  windowEnd: number,
): number {
  const totalSlots = Math.max(1, Math.ceil((windowEnd - windowStart) / 60_000));
  const activeSlots = new Set<number>();
  for (const { sampleMs, idleSeconds } of samples) {
    const lastActiveMs = sampleMs - idleSeconds * 1000;
    if (lastActiveMs >= windowStart && lastActiveMs < windowEnd) {
      activeSlots.add(Math.floor((lastActiveMs - windowStart) / 60_000));
    }
  }
  return Math.round((activeSlots.size / totalSlots) * 100);
}
```

Call site (inside the screenshot capture `useEffect`, after `windowStart`/
`windowEnd` are computed):

```ts
let activityPercent: number | null = null;
if (electronAPI.timeTracking.getActivitySince) {
  try {
    const samples = await electronAPI.timeTracking.getActivitySince(windowStart);
    activityPercent = calcActivityPercent(samples, windowStart, windowEnd);
  } catch {
    // Non-critical — proceed without activity data
  }
}
```

The IPC handler is already wired in `electron/main.js` (`timeTracking:getActivitySince`)
and exposed via `electron/preload.js`; the type is in `src/types/electron.d.ts`.
The reason the sample-based path was swapped out is that older installed
Electron builds may not expose `getActivitySince`, so the event-log
fallback runs reliably across all clients in the meantime. Switch back
once the Electron rollout is confirmed.

### Permissions System

Pages are code-defined in `src/lib/definitions.ts` (not Firestore). `page-permissions/{pageId}` maps each page to allowed groups/users. Resolved access is denormalised onto `users/{uid}.permittedPageIds` for fast sidebar rendering.

Page permissions are one of three authorization tiers — see **API Route Auth Middleware → Authorization tiers** above. Some actions (admin group membership, `isActive`, the page-permission map itself) require the `token.admin` JWT claim and cannot be granted through page sharing alone.

The page-permission map at `/api/admin/pages/[pageId]/permissions` (PUT) requires the admin claim to write, even though `'sharing'` page permission still gates the read on `/api/admin/pages` (GET). This asymmetry is intentional: any user with `'sharing'` could otherwise grant themselves any other page and chain into account-level changes.

### Notification System

All notification content (titles, messages, types, actionUrls) is centralised in `src/lib/notificationContent.ts`. Each notification is a named factory function that returns a `NotificationContent` object. When adding or editing notification copy, **only edit this file**.

To write a notification to Firestore, use `addNotificationToBatch` from `src/lib/middleware/apiHelpers.ts`, which handles the boilerplate fields (`read`, `dismissedByUser`, `createdAt`, `announcement`, `announcementExpiry`):

```ts
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';

const batch = adminDb.batch();
addNotificationToBatch(batch, userId, notifications.crCompleted(cr, stageName));
await batch.commit();
```

Current notification events and their factory functions:

| Event | Factory |
|---|---|
| New user — complete onboarding | `notifications.onboardingActionRequired()` |
| New user — welcome message | `notifications.welcomeToTeam(firstName)` |
| New user — admin alert | `notifications.adminNewUserAlert()` — fans out to every uid in `groups/admin.members` (do not hardcode an admin uid) |
| CR submitted | `notifications.crCreated(creatorName, stageName)` |
| CR rejected | `notifications.crRejected(editorName, cr, stageName)` |
| CR completed | `notifications.crCompleted(cr, stageName)` |
| Leave approved | `notifications.leaveApproved(leaveLabel, dateStr)` |
| Leave denied | `notifications.leaveDenied(leaveLabel, dateStr)` |
| Dispute assigned | `notifications.disputeAssigned(createdByName)` |
| Dispute — admin approved | `notifications.disputeAdminApproved()` |
| Dispute — admin rejected | `notifications.disputeAdminRejected(reason?)` |
| Dispute — CA approved | `notifications.disputeCaApproved(assignedToName)` |
| Dispute — CA rejected | `notifications.disputeCaRejected(assignedToName, reason?)` |

### UI Stack

- shadcn/ui components (`src/components/ui/`) — Radix UI primitives with Tailwind
- ONLY use visual components and styling from `src/components/ui`.
- ONLY use `@tabler/icons-react` and `lucide-react` for icons
- CSS variables for theming (`var(--foreground)`, etc.)
- `sonner` for toast notifications
- `@dnd-kit` for drag-and-drop

### Boot Loading Screen

On app start-up a single full-screen animated loader (`src/components/LoadingScreen.tsx`, plays `src/public/loader.webm`) covers the app until everything needed for a flicker-free first paint is ready. Getting this wrong reintroduces the original bugs: a flash of the "Unassigned" group card / empty sidebar, or widget skeletons appearing on the home page during boot.

**Single persistent loader.** The loader is rendered in exactly one place — `BootLoaderProvider` (`src/contexts/BootLoaderContext.tsx`), mounted in `src/app/(main)/layout.tsx` **above** `AuthWrapper`. It stays mounted for the whole boot so the `<video>` element never remounts (a remount restarts the animation and causes a flicker). Do **not** render `LoadingScreen` anywhere else.

**Phase gating.** Components don't show/hide the loader directly — they *report* their loading state via `useBootPhase(key, loading)`. The loader stays up while **any** phase is pending. Current phases:
- `'auth'` — `AuthWrapper`, while Firebase auth resolves (it returns `null` during this; the provider's loader covers the screen).
- `'app-data'` — `AppLayout`, while `useUserData` + `usePermissions` resolve (user groups + page permissions). Includes a one-commit `gatesSettled` bridge so the home widgets mount and register their phases before this clears.
- `'home-resources'`, `'home-notifications'`, `'home-timetracking'` — the home page widgets (`src/app/(main)/page.tsx`).

**Lift timing.** The loader lifts at `max(all phases cleared, MIN_LOADER_MS)`. `MIN_LOADER_MS` (3 s, in `BootLoaderContext.tsx`) is an aesthetic floor so the animation plays at least one full cycle even when data is ready sooner; it also bridges the brief gaps between phases. It is a minimum, not a fixed delay — slower loads stay up longer. Once this first boot completes, a `booted` latch prevents the loader from ever reappearing for the session; in-app navigation relies on each view's own skeletons. A full app reload resets it (a genuine new boot).

> **Adding home-page content/widgets:** any new widget on the home page (`src/app/(main)/page.tsx`) that loads data asynchronously **must** gate the loader by calling `useBootPhase('home-<name>', isLoading)` with its own loading flag. Otherwise its skeleton/empty state will flash on boot before its data arrives. Widgets that read only already-gated data (e.g. the live `useUserData` snapshot) don't need their own phase. This requirement is home-page-specific — other pages use normal in-place skeletons and should not add boot phases.

### Notion Resources Integration

The `/applications/apps-resources` page lists documents from a single Notion database.

- **Service**: `src/lib/services/notionService.ts` wraps `@notionhq/client`. Two `unstable_cache`-wrapped exports: `getActiveDocuments()` (5 min revalidate) and `getDocumentTypes()` (1 hr revalidate). Both share the cache tag `notion-resources` — call `revalidateTag('notion-resources')` if a future write path needs to bust both at once.
- **Env vars**: `NOTION_TOKEN` and `NOTION_DATABASE_ID` in `src/.env.local`. Server-only — never expose to the client.
- **Notion schema expected**: `Name` (title), `URL` (url, optional — if empty, the Notion page URL is used), `Groups` (multi-select; values must match `users.groups`), `Type` (multi-select), `Status` (status; only `Active` rows are returned, `Unlisted` is filtered out at the service), `Last Edited Time` (Notion built-in).
- **Group filter**: applied server-side in `/api/resources` — a doc is visible if any of its `Groups` overlap with the caller's `users.groups`. Admins (`token.admin === true`) bypass this filter. The page itself is gated by the standard sidebar `apps-resources` page permission, so no per-page `permittedPageIds` check runs inside the route.
- **Client cache**: `src/hooks/useResources.ts` mirrors the `useCreators` pattern (sessionStorage, 5 min TTL, key `bluu_resources_v1`).

### Archived Users

A user with `isArchived === true` is **removed from the system but their data is
not deleted** from Firestore. The rule: archived users must be filtered out of any
list/dropdown where you **select or act on a user**, but kept wherever their
**existing data must still resolve or display**.

The four sources that feed user lists, and how each handles archiving:

- **`/api/users/display-names`** (`useBasicUsers`) — returns `isArchived` on each
  `BasicUser` but does **not** filter server-side, because some pages
  (`creators/custom-requests`, `ca-portal/campaigns`) use this endpoint to resolve
  historical editor names by UID, including archived users. Filter archived at the
  **consumer** when building a picker (see `AdminTimesheets`,
  `CreateNotificationDialog`).
- **`/api/disputes/users`** (`useDisputesData`) — filters archived server-side. It
  only feeds the CA assignee/filter pickers; dispute names are resolved separately
  in `/api/disputes`, so historical display is unaffected.
- **`/api/shifts/week`** — excludes archived from its `userMap`, removing them from
  the shift grid and the shift-assignment picker.
- **`/api/admin/users`** (`useAdminUsers`) — returns archived users intact because
  user-management is the surface that manages them (the Employee Registry has a
  `showArchived` toggle). Filter archived only in the action lists drawing from it
  (`AdminLeave`, `AddMembersDropdown`).

**Exceptions that intentionally keep archived users:** the Screenshots tab
(`AdminScreenshots`) — archived users' screenshots still exist in storage and must
remain viewable/deletable; and `AdminActiveUsers` resolves names from the basic-user
list (archived users have no active session, so they never render).

When adding a new page or component that lists users for selection, filter
`isArchived` out of the rendered list.

### Profile Pictures

Always use `src/components/ui/avatar.tsx` (`Avatar`, `AvatarImage`, `AvatarFallback`) to render profile pictures. Never use a plain `<img>` tag for avatars.

Creator profile pictures (`photoURL`) are included in the data returned by `useCreators` and by `/api/creators`. The `DisputeDocument` type carries `creatorPhotoURL`, `createdByPhotoURL`, and `assignedToPhotoURL` — all resolved server-side in `/api/disputes/route.ts`.


