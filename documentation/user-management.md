# User Management & Data Lifecycle

> Five tightly-coupled concerns: **registration** (how an account comes to exist), **archiving** (soft, non-destructive), **deleting** (hard cascade), **name resolution** (incl. deleted users), and **profile pictures**. Archive vs delete is the primary distinction — one keeps all data, the other erases it.

---

## 0. Registering Users (the only way an account is created)

`POST /api/admin/users`, from **Employee Registry → New**. Fields: full name, nickname (`displayName`), **login email**, and optionally a group.

Since the personal-email migration, **login is an allowlist check against the docs this creates** ([auth.md](auth.md#the-allowlist-the-authorisation-gate)) — nothing else provisions accounts. Someone not registered here cannot sign in at all.

- **Authorisation: tier 2** (`user-management` page permission), consistent with the PUT/DELETE handlers on the same page. This is a deliberate widening — anyone with that page can now mint a login. The one exception: **registering into the `admin` group requires the admin claim**, or the page permission would chain straight into control of the auth graph (same guard as `/api/admin/groups/[groupId]/members`).
- **The email is load-bearing.** A typo means the new hire is turned away with "your account is not in the system". The dialog says so.
- **Uniqueness** is enforced by the `auth-emails` index inside a transaction, so two admins registering the same address cannot both win.
- **Collisions:** an orphaned Auth account (no Firestore doc) is *adopted* under its existing uid; an address belonging to a **creator** is refused. Creator registration refuses employee addresses symmetrically. Never merge the two — one uid owning both a `users` and a `creators` doc means one identity in two auth contexts.
### "Invited" — registered but not yet set up

`isInvitedUser` ([`userStatus.ts`](../src/components/admin/user-management/userStatus.ts)) is the single definition, used by the badge, the filter and the tab count:

```ts
!user.lastLoginAt || user.hasCompletedOnboarding === false
```

**The span runs to the end of onboarding, not to first login.** A user who signs in once and abandons the flow has submitted nothing — and onboarding is all-or-nothing, so `recordSuccessfulLogin` discards the partial run and drops them back at the login screen ([onboarding.md](onboarding.md#onboarding-is-all-or-nothing)). Calling them "Active" would show a complete-looking employee record that is actually empty.

**RULE — the second test must be `=== false`, never a falsy check.** Users created before the onboarding flow shipped have no `hasCompletedOnboarding` field at all, so it arrives as `undefined`; a falsy test would relabel every long-standing employee as "Invited".

Surfaced in three places:
- **Orange badge** on `UserCard`, shown *instead of* Active/Disabled — it is the more useful fact. A second line (`invitedStageLabel`) says whether they never signed in or stalled during onboarding, which is what decides between chasing the person and checking the email for a typo.
- **Invited Users tab** on the user-management page. Counts **overlap** with Employee Registry by design — an invited user is a real employee record, just an unfinished one — so the tabs are not a partition (unlike Archived).
- **Status filter** (`invited`) in `RegistryFilters`, for narrowing within the main registry.

Invitations do not expire; the tab is the chase mechanism.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/hooks/useBasicUsers.ts` | `/api/users/display-names` — all users incl. archived |
| `src/hooks/useUserName.ts` | `uid → displayName` map (built on `useBasicUsers`) |
| `src/hooks/useAdminUsers.ts` | `/api/admin/users` — user management (incl. archived) |
| `src/hooks/useDisputesData.ts` | `/api/disputes/users` — filters archived server-side |
| `src/components/DeletedUser.tsx` | Renders italic *Deleted User* + `resolveUserName(uid, names)` |
| `src/components/ui/avatar.tsx` | The **only** avatar renderer |
| API: `/api/admin/users/[uid]/route.ts` | DELETE cascade |
| API: `/api/users/display-names/route.ts` | Basic user list |
| API: `/api/shifts/week/route.ts` | `userMap` excludes archived |
| API: `/api/disputes/route.ts` | Resolves creator/participant photoURLs + names |

---

## 1. Archived Users (soft — nothing deleted)

`users/{uid}.isArchived === true` → user is **removed from the system but their data is NOT deleted** from Firestore.

**THE RULE:** Filter archived users out of any list/dropdown where you **select or act on a user**, but keep them wherever their **existing data must still resolve or display**.

### The four user-list sources

| Source (hook) | Archived handling | Why |
|---|---|---|
| `/api/users/display-names` (`useBasicUsers`) | Returns `isArchived` on each `BasicUser`; does **NOT** filter server-side | Some pages (`creators/custom-requests`, `ca-portal/campaigns`) resolve historical editor names by UID via `useUserName`, including archived users. **Filter at the consumer** when building a picker (see `AdminTimesheets`, `CreateNotificationDialog`) |
| `/api/disputes/users` (`useDisputesData`) | **Filters archived server-side** | Only feeds CA assignee/filter pickers; dispute display names resolved separately in `/api/disputes`, so historical display is unaffected |
| `/api/shifts/week` | Excludes archived from its `userMap` | Removes them from the shift grid + shift-assignment picker |
| `/api/admin/users` (`useAdminUsers`) | Returns archived **intact** | User-management is the surface that manages them (Employee Registry has a `showArchived` toggle). Filter archived only in action lists drawing from it (`AdminLeave`, `AddMembersDropdown`) |

### Intentional exceptions (keep archived users)
- **Screenshots tab** (`AdminScreenshots`) — archived users' screenshots still exist in storage and must remain viewable/deletable.
- **`AdminActiveUsers`** — resolves names from the basic-user list; archived users have no active session, so they never render anyway.

**RULE:** When adding a new page/component that lists users **for selection**, filter `isArchived` out of the rendered list.

---

## 2. Deleting Users (hard — destructive cascade)

`DELETE /api/admin/users/[uid]` (from the Employee Registry detail card) is the **destructive counterpart to archiving** — permanently removes the user **and all their personal data**. (The Delete dialog says so; the Archive dialog explicitly states data is *not* deleted.)

### Removed by the handler
- `users/{uid}`, group membership (`groups/*.members`), page-permission entries (`page-permissions/*.users.{uid}`), `active_sessions/{uid}`.
- **The login allowlist entry** `auth-emails/{normalisedEmail}` (`releaseEmailClaim`). The email is read off the doc *before* it is deleted. Leaving the claim behind would keep the address pointing at a dead uid: re-registering that person would fail with "email already taken", and a login attempt would resolve to a doc that no longer exists.
- Every doc **owned** by the user (`userId`/`uid` field) in: `time_entries`, legacy `time-entries`, `screenshots`, `shifts`, `leave_requests`, `notifications`, `bugs`.
- Storage: `screenshots/{uid}/` prefix (full-size + thumbnails) and `profile-photos/{uid}/`.
- The **Firebase Auth account** (`adminAuth.deleteUser(uid)`, tolerant of `auth/user-not-found`). **Why it matters:** deleting only the Firestore doc leaves an orphaned login — the user could sign in again, get the *same* uid back, and silently recreate their doc ("resurrection"). Deleting the Auth account closes that. The mirror failure (Auth account deleted but doc left behind) is what produces **duplicate** `users` docs for one email — see [auth.md](auth.md#login-identity--duplicate-account-prevention).

### Intentionally KEPT
Shared business records that reference the user only as a **participant/audit field** — these belong to creators/other employees:
- `disputes` (`createdBy` / `assignedTo`)
- `campaign-tracking` & `content-planning` (`createdBy` / `lastEditedBy`)
- `admin_notification_batches` (`sentBy`)

The deleted UID renders as *"Deleted User"* (see §3).

### Mechanics
- **Not** a single atomic transaction (too many ops) — runs **chunked 500-op batches per collection**, then deletes Storage prefixes.
- **Idempotent** — re-running delete on the same UID is safe.
- **RULE:** When you add a new collection storing **per-user** data, add it to this cascade.

---

## 3. User Name Resolution

Internal names live on `users/{uid}` as `displayName` (+ `firstName` / `lastName`).

**Resolution chain:** `displayName` → `firstName lastName` → **"Deleted User"**.

| Context | How |
|---|---|
| **Client (uid → name)** | `useUserName()` (`src/hooks/useUserName.ts`); `names` map sourced from `useBasicUsers`. Don't roll your own `/api/users/display-names` fetch |
| **Rendering a possibly-deleted user** | `resolveUserName(uid, names)` / `<DeletedUser />` (`src/components/DeletedUser.tsx`) — shows italic *Deleted User* when the UID no longer resolves (deleted users are gone from `users`, so a shared record holding their UID would otherwise show the raw UID) |
| **Server (uid → name)** | `getUserById` (single, cached) or `adminDb.getAll(...)` over `users` refs (batch). Return an **empty string** for an unresolved (deleted) user — that empty value is the signal the client renders as *Deleted User*. See `/api/disputes`, `/api/shifts/week`, `/api/admin/notifications/[batchId]/recipients` |

- **Creator names** (`stageName`) are a **separate** path via `useCreators` / `creatorMap`; that fallback still shows the **raw creator ID**, not "Deleted User".
- **Intentional inconsistency:** name-composition precedence differs in a couple places (`UserCard`: `firstName lastName || displayName`; `AdminTimesheets`: `displayName || firstName lastName`) — deliberate presentation choices, **not** a bug to unify.

---

## 4. Profile Pictures

- **RULE:** Always use `src/components/ui/avatar.tsx` (`Avatar`, `AvatarImage`, `AvatarFallback`). **Never** a plain `<img>` for avatars.
- Creator `photoURL` is included in `useCreators` and `/api/creators` output.
- `DisputeDocument` carries `creatorPhotoURL`, `createdByPhotoURL`, `assignedToPhotoURL` — all resolved server-side in `/api/disputes/route.ts`.
