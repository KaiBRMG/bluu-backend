# Data Layer

> Server services, client data hooks, Firestore collections, and read-optimization rules. This is the shared substrate every feature spoke builds on.

## Dependencies / Interacting Files

| Layer | Location |
|---|---|
| Server services | `src/lib/services/*.ts` |
| Client hooks | `src/hooks/*.ts(x)` |
| Firebase Admin | `src/lib/firebase-admin.ts` (`adminDb`, `adminAuth`) |
| Permission cache | `src/lib/permissionsCache.ts` |
| Query cache util | `src/lib/queryCache.ts` |

---

## Server-Side Services (`src/lib/services/`)

| Service | Responsibility | Key rule |
|---|---|---|
| `userService.ts` | User doc reads (`getUserById`) | **60s in-process cache** — call `invalidateUserCache(uid)` after **any** user doc write in the same handler |
| `pageService.ts` | Page permission resolution | see [permissions.md](permissions.md) |
| `permissionResolver.ts` | Resolves groups/users → `permittedPageIds` | denormalizes onto user docs |
| `groupService.ts` | Group membership | admin claim refresh on membership change |
| `activeSessionService.ts` | `active_sessions/{userId}` presence docs | see [time-tracking.md](time-tracking.md) |
| `timeEntryService.ts` | `time_entries` ledger | written at clock-out |
| `screenshotService.ts` | Screenshot metadata + Storage paths | |
| `shiftService.ts` | Shift definitions | |
| `campaignTrackingService.ts` | `campaign-tracking` reads/writes | see [campaign-tracking.md](campaign-tracking.md) |
| `notionService.ts` | Notion DB integration | see [notion-resources.md](notion-resources.md) |
| `teamspaceService.ts` | Teamspace data | |

---

## Client-Side Data Hooks (`src/hooks/`)

| Hook | Source | Cache | Notes |
|---|---|---|---|
| `useUserData` | live `onSnapshot` on user doc | IndexedDB (Firestore) on reload | Source of truth for `enableScreenshots`, groups, `sessionToken` |
| `useTimesheetData` | timesheet API | sessionStorage, 5 min TTL | Call `invalidateTimesheetCache(uid)` after clock-in/out |
| `useDisputesData` | all disputes API routes | sessionStorage, 5 min (creator/CA lists) | see [disputes] |
| `useCreators` | `/api/creators` | sessionStorage, 5 min, key `bluu_creators_v2` | **Canonical** source of creator names + `photoURL`. Do **not** fetch `/api/creators` directly. |
| `useBasicUsers` | `/api/users/display-names` | sessionStorage, 5 min | Full employee list **incl. archived** — for pickers and UID→name maps |
| `useUserName` | built on `useBasicUsers` | — | Canonical client-side `uid → displayName`. Do **not** roll your own `/api/users/display-names` fetch. See [user-management.md](user-management.md#user-name-resolution) |
| `usePermissions` | permission map | localStorage (no TTL) via `permissionsCache.ts` | |

**Caching pattern (sessionStorage hooks):** versioned key + 5-min TTL, mirrored across `useCreators` / `useResources` / `useBasicUsers`. Reuse this pattern for new reference-data hooks rather than fetching in components.

---

## Firestore Collections

| Collection | Purpose | Type |
|---|---|---|
| `users/{uid}` | Internal employee documents | `UserDocument` |
| `creators/{uid}` | External creator accounts | `CreatorFullDocument` |
| `active_sessions/{userId}` | Lightweight presence doc; **deleted on clock-out** | `ActiveSessionDocument` |
| `time_entries/{sessionId}` | Permanent ledger, written at clock-out | `TimeEntryLedgerDocument` |
| `page-permissions/{pageId}` | Which groups/users can access each page | |
| `screenshots/{docId}` | Screenshot metadata; Storage paths (full-size + thumbnails) | |
| `shifts/{shiftId}` | Recurring/one-off shift definitions | |
| `disputes/{disputeId}` | Dispute records (CA portal) | `DisputeDocument` |
| `campaign-tracking/{id}` | Custom requests **and** campaigns | see [campaign-tracking.md](campaign-tracking.md) |
| `content-planning/{id}` | Content planning entries | |
| `groups/{groupId}` | Group membership (`.members`) incl. `groups/admin` | |
| `leave_requests/{id}` | Leave requests | |
| `notifications/{docId}`, `notifications-batches/{batchId}` | Notification system | see [notifications.md](notifications.md) |
| `bugs/{id}` | Bug reports | |

**Deprecation:** `TimeEntryDocument` is `@deprecated`. New sessions use `ActiveSessionDocument` + `TimeEntryLedgerDocument`.

---

## Firestore Read Optimization (rules)

- **`getUserById` 60s TTL cache** — any route that writes a user doc **must** call `invalidateUserCache(uid)` in the same handler.
- **Batch reads** use `adminDb.getAll(...refs)` to avoid N+1 reads.
- **`enableScreenshots`** is read from the client-side `useUserData` snapshot, **not** from the time-tracking status API.
- **`isAdmin()`** security rule uses the `request.auth.token.admin` JWT claim → **zero Firestore reads** (see [auth.md](auth.md)).

---

## Session Token (single active session)

`users/{uid}.sessionToken` is a UUID rotated on every login. Client stores it locally; `onSnapshot` on the user doc detects a mismatch and forces sign-out. Detail duplicated in [auth.md](auth.md#single-active-session) — the write path is login; the enforcement path is the client snapshot.
