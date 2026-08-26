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
| `resourceService.ts` | `app-resources` reads/writes | see [resources.md](resources.md) |
| `promptLibraryService.ts` | `prompt-library` reads/writes + version transactions | 60s cache; see [prompt-library.md](prompt-library.md) |
| `teamspaceService.ts` | Teamspace data | |
| `smmService.ts` | SMM access gates, current round, link-usage lookup, serializers | see [smm-portal.md](smm-portal.md) |

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
| `useSmmAccounts` / `useSmmBonus` / `useSmmUsers` | SMM API routes | sessionStorage, 5 min | see [smm-portal.md](smm-portal.md#client-hooks--caching) |
| `useSmmPosts` | SMM posts API | in-memory per-week only (high churn) | cleared on any post mutation |
| `useOnlyFansChats` | `onlyfans-chats` via `onSnapshot` | account id in sessionStorage (30 min) | Realtime chat list; the API route only warms the mirror. see [onlyfans-crm.md](onlyfans-crm.md) |
| `useOnlyFansMessages` | provider API + live subcollection | sessionStorage, 60s (newest page) | Merges paged history with the live tail, de-duped by message id |
| `useAuthFetch` | — | — | Shared bearer-token fetch helper (extracted from `useDisputesData`) |
| `usePromptLibrary` | `/api/prompt-library` via `PromptLibraryProvider` | sessionStorage, 5 min, key `bluu_prompt_library_v1` | One provider for the whole `apps-prompt-library` subtree; mutations patch state + cache in place (never re-read). Version histories fetched per prompt, memoised for the session. see [prompt-library.md](prompt-library.md) |

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
| `twitterx-accounts/{id}` | SMM Twitter/X accounts | see [smm-portal.md](smm-portal.md) |
| `twitterx-content-schedule/{accountId}/posts/{postId}` | SMM scheduled posts (**subcollection**) | see [smm-portal.md](smm-portal.md) |
| `twitterx-bonus/{roundId}/submissions/{id}` | SMM bonus rounds + submissions (**subcollection**) | see [smm-portal.md](smm-portal.md) |
| `onlyfans-chats/{accountId}__{chatId}` (+ `/messages/{id}` **subcollection**) | Mirror of the OnlyFans chat list + live messages | see [onlyfans-crm.md](onlyfans-crm.md) |
| `onlyfans-meta/{accountId}` | OnlyFans sync freshness marker (server-only) | see [onlyfans-crm.md](onlyfans-crm.md) |
| `prompt-library/{id}` (+ `/versions/{n}` **subcollection**) | Prompt heads (current text + metadata) and their edit history | see [prompt-library.md](prompt-library.md) |
| `prompt-library-meta/taxonomy` | Managed category/tag lists for the Prompt Library | see [prompt-library.md](prompt-library.md) |

**Subcollections + collection-group indexes:** the `twitterx-*` collections are the first in the repo to use subcollections and `COLLECTION_GROUP` indexes / `fieldOverrides` in `firestore.indexes.json`. See [smm-portal.md](smm-portal.md#indexes-firestoreindexesjson).

**Deprecation:** `TimeEntryDocument` is `@deprecated`. New sessions use `ActiveSessionDocument` + `TimeEntryLedgerDocument`.

---

## Firestore Read Optimization (rules)

- **`getUserById` 60s TTL cache** — any route that writes a user doc **must** call `invalidateUserCache(uid)` in the same handler.
- **Batch reads** use `adminDb.getAll(...refs)` to avoid N+1 reads.
- **`enableScreenshots`** is read from the client-side `useUserData` snapshot, **not** from the time-tracking status API.
- **`isAdmin()`** security rule uses the `request.auth.token.admin` JWT claim → **zero Firestore reads** (see [auth.md](auth.md)).

---

## Firestore Write Optimization (rules)

### Single-field index exemptions

Firestore indexes **every** field of **every** document by default — ascending, descending, and array-contains. For a large string, a long array, or a nested map that nothing ever queries, that is pure write latency, index storage, and pressure on the per-document index-entry caps.

The `fieldOverrides` block in [`firestore.indexes.json`](../firestore.indexes.json) carries two kinds of entry, and they look similar — read the `indexes` array:

- **`"indexes": [...]`** — *additive*. Widens a field's indexing (e.g. giving `posts.postDate` `COLLECTION_GROUP` scope). The `posts` / `submissions` entries are these.
- **`"indexes": []`** — an **exemption**. Removes the field's single-field indexes entirely.

Currently exempted (all write-only payload — nothing filters or orders on them):

| Collection | Fields |
|---|---|
| `time_entries` | `eventLog`, `modifications`, `originalData` |
| `prompt-library` + `versions` | `text`, `textHtml` |
| `analytics_daily` | `segments`, `sessionBounds`, `hourBuckets`, `sessionIds`, `groupsSnapshot` |
| `onlyfans-chats` + `messages` | `lastMessageText`, `fan`, `profile`, `text`, `attachments` |
| `model-submission-sessions`, `model-submission-rate` | `expiresAt` (TTL fields — the TTL policy maintains its own index) |

**When adding a field, exempt it if nothing queries it** — particularly free text, HTML, arrays of maps, and any timestamp driving a TTL policy.

**An exemption is not free to reverse.** It *deletes* the field's single-field indexes, so a later query that filters or orders on an exempted field fails until the exemption is removed and the index rebuilt (a backfill over the whole collection). Check the read path before exempting.

### Bulk deletes

Use `bulkWriter()`, not chunked `batch()`, for any delete larger than a handful of documents — `deleteScreenshots` ([screenshotService.ts](../src/lib/services/screenshotService.ts)) and the `analytics_dirty` drain ([functions/index.js](../functions/index.js)) are the two examples. Both delete over a contiguous key range, which is the contention case Firestore calls out; BulkWriter paces itself and retries individual documents where one bad document fails a whole batch.

---

## Session Token (single active session)

`users/{uid}.sessionToken` is a UUID rotated on every login. Client stores it locally; `onSnapshot` on the user doc detects a mismatch and forces sign-out. Detail duplicated in [auth.md](auth.md#single-active-session) — the write path is login; the enforcement path is the client snapshot.
