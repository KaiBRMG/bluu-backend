# User Management & Data Lifecycle

> Five tightly-coupled concerns: **registration** (how an account comes to exist), **archiving** (soft, non-destructive), **deleting** (hard cascade), **name resolution** (incl. deleted users), and **profile pictures**. Archive vs delete is the primary distinction — one keeps all data, the other erases it.

---

## 0. Registering Users (the only way an account is created)

`POST /api/admin/users`, from the **Add employee** button on the user-management page header. Fields: full name, nickname (`displayName`), **login email**, and a group.

The group **defaults to the org's default group** (`AdminGroup.isDefault`), not to `unassigned`. Assigning a group is half of what the action exists for, and a `Select` reading "Unassigned — decide later" presents as a deliberate choice rather than a skipped step — which quietly shipped hires who signed in to an empty sidebar. `unassigned` is still selectable; it is just not the default.

Since the personal-email migration, **login is an allowlist check against the docs this creates** ([auth.md](auth.md#the-allowlist-the-authorisation-gate)) — nothing else provisions accounts. Someone not registered here cannot sign in at all.

- **Authorisation: tier 2** (`user-management` page permission), consistent with the PUT/DELETE handlers on the same page. This is a deliberate widening — anyone with that page can now mint a login. The one exception: **registering into the `admin` group requires the admin claim**, or the page permission would chain straight into control of the auth graph (same guard as `/api/admin/groups/[groupId]/members`).
- **The email is load-bearing.** A typo means the new hire is turned away with "your account is not in the system". The dialog says so.
- **Uniqueness** is enforced by the `auth-emails` index inside a transaction, so two admins registering the same address cannot both win.
- **Collisions:** an orphaned Auth account (no Firestore doc) is *adopted* under its existing uid; an address belonging to a **creator** is refused. Creator registration refuses employee addresses symmetrically. Never merge the two — one uid owning both a `users` and a `creators` doc means one identity in two auth contexts.
### "Invited" — registered but not yet set up

`isInvitedUser` ([`userStatus.ts`](../src/components/admin/user-management/userStatus.ts)) is the single definition, used by the row mark, the Status facet and the promoted section:

```ts
!user.lastLoginAt || user.hasCompletedOnboarding === false
```

**The span runs to the end of onboarding, not to first login.** A user who signs in once and abandons the flow has submitted nothing — and onboarding is all-or-nothing, so `recordSuccessfulLogin` discards the partial run and drops them back at the login screen ([onboarding.md](onboarding.md#onboarding-is-all-or-nothing)). Calling them "Active" would show a complete-looking employee record that is actually empty.

**RULE — the second test must be `=== false`, never a falsy check.** Users created before the onboarding flow shipped have no `hasCompletedOnboarding` field at all, so it arrives as `undefined`; a falsy test would relabel every long-standing employee as "Invited".

`isInvitedUser` feeds `userStage()` in the same file — the derived, closed four-value vocabulary (`invited` / `active` / `no-access` / `archived`) the whole page reads. Three raw fields (`isArchived`, `isActive`, and the two onboarding signals) collapse into one answer to "where is this person?", and each stage **borrows its hue from `STATUS_COLORS`** rather than re-typing a hex — the same shape [`disputeStatus.ts`](../src/components/disputes/disputeStatus.ts) uses. Precedence is `archived` → `invited` → `no-access` → `active`: archived wins outright, and "not set up" beats "no access" because a record that was never completed is the more useful fact about it.

Surfaced in three places, all from that one definition:
- The **`NOT SET UP` section** at the top of the index — the chase queue is promoted into the list rather than living behind a tab, so "what needs my attention" is answered without a click. A second meta line (`invitedStageLabel`) says whether they never signed in or stalled during onboarding, which is what decides between chasing the person and checking the email for a typo.
- The **Status facet** in the rail, with a faceted count.
- The row's **stage dot and pill**.

Invitations do not expire; the promoted section is the chase mechanism.

## 0a. "Last seen" vs "last sign in"

They are two different facts, and the registry used to conflate them. The row meta read `seen 4mo ago` off **`lastLoginAt`**, which is written in exactly one place — `recordSuccessfulLogin`, at sign-in. The Electron shell never reloads itself and staff do not quit it (rule 9c), so for most of the fleet that value is months old. The page was reporting *how long ago someone last signed in* as though it were *how long ago they were last here*, and a room full of daily users rendered as abandoned accounts.

| Field | Written by | Means |
|---|---|---|
| `lastLoginAt` | `recordSuccessfulLogin` ([`userService.ts`](../src/lib/services/userService.ts)) | The last **sign-in**. Still what `isInvitedUser` keys off — `null` is "never signed in", and that meaning is unchanged. |
| `lastActiveAt` | `POST /api/user/presence`, from [`PresenceReporter`](../src/components/PresenceReporter.tsx) | The real **last seen**: the last time the app was open. |

**What counts as online: having the app open in any capacity.** Not "clocked in", and not "interacting".

- `PresenceReporter` is mounted in all three authenticated layouts — `(main)`, `/of-manager`, `/gologin` — because each of those windows being open is the app being open. Duplicate pings from someone running more than one are collapsed server-side.
- In `(main)` it sits **outside `LazyProviders`**, deliberately: presence is true before those providers load and stays true while clocked out, so it must not sit behind anything that reads clock state.
- It does **not** gate on `document.visibilityState` — a minimised window is still open, and `backgroundThrottling` is off on every Electron window so the interval holds its cadence. A sleeping machine handles itself: timers do not fire, so nothing is stamped.
- **`active_sessions` cannot substitute for this.** That doc exists only while the user is clocked in and is deleted at clock-out, and the time-tracking heartbeat only runs in the `working` state. Being clocked out is not being away.

**Cost (rule 9).** One ping per window per 10 minutes, floored at 9 minutes client-side and collapsed to one persisted write per user per 5 minutes per server instance. `POST /api/user/presence` is **read-free** — it never fetches the doc to compare, because a value rendered as "seen 3d ago" does not justify a read per ping. It calls `invalidateUserCache` (rule 2) but deliberately **not** `invalidateAdminUsersCache`: that cache's TTL is 30s and this field's resolution is ~10 minutes, so invalidating would force a full `users` re-read several times a minute for nothing. `lastActiveAt` is **exempt from single-field indexing** — if a "who is online right now" query is ever wanted, the exemption has to be removed and the index rebuilt first ([data-layer.md](data-layer.md#single-field-index-exemptions)).

**RULE — label the fact you are showing.** `lastActiveAt` is absent for anyone who has not opened the app since presence reporting shipped, so both surfaces fall back to the sign-in date *relabelled*, never dressed up as a sighting: the index row says `signed in 4mo ago` (with a tooltip saying why there is no last-seen yet), and the record panel shows **Last Sign In** and **Last Seen** as two separate rows, the latter reading "Not yet recorded".

---

## 0b. The page shape

`/admin-portal/user-management` is **one faceted index of people** — the browse-and-open shape DESIGN.md §5 documents, and the same one `apps-resources` uses. It replaced a four-tab layout in which three tabs rendered the same component with booleans that collapsed to predicates already available as filters inside it.

| Piece | File | Note |
|---|---|---|
| Page shell, filtering, faceted counts, URL state | [`page.tsx`](../src/app/(main)/admin-portal/user-management/page.tsx) | Filters live in the query string (`stage`, `group`, `type`, `q`) via `replaceState`, so a view is linkable and survives a reload |
| Facet rail (Status / Group / Employment) | `RegistryRail.tsx` | Counts are computed with that one facet cleared, so a count is what clicking will produce |
| Sectioned two-line index + bulk selection | `EmployeeIndex.tsx` | Sections are the `userStage` vocabulary |
| Group multi-select (record field + bulk add) | `GroupPicker.tsx` | shadcn `Popover` + `Command` |
| Registration dialog | `NewUserDialog.tsx` | The page's primary action, on the `<h1>` row |
| Record panel | `UserDetailDrawer.tsx` → `UserDetailContent.tsx` | 560px `Sheet` with a dirty-state guard |

**RULES for this surface:**
- **Archived is opt-in, never implicit.** An empty `stage` filter means every stage *except* archived. Nothing may surface archived users without the facet being selected.
- **Group membership is edited on the person**, from the record's Access & Permissions block — it writes immediately and toasts with an Undo. There is no separate group-membership screen; "who is in Ops?" is the Group facet. Bulk assignment is row selection in the index plus **Add to group**.
- **Group names are greyscale attribute chips.** The old `groupColors.ts` hashed the name into ten saturated hues; DESIGN.md §6 bans that by name. Deleted — do not reintroduce it.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/hooks/useBasicUsers.ts` | `/api/users/display-names` — all users incl. archived |
| `src/hooks/useUserName.ts` | `uid → displayName` map (built on `useBasicUsers`) |
| `src/hooks/useAdminUsers.ts` | `/api/admin/users` — user management (incl. archived) |
| `src/hooks/useDisputesData.ts` | `/api/disputes/users` — filters archived server-side |
| `src/components/DeletedUser.tsx` | Renders italic *Deleted User* + `resolveUserName(uid, names)` |
| `src/components/ui/avatar.tsx` | The **only** avatar renderer |
| `src/components/PresenceReporter.tsx` | Stamps `lastActiveAt` — the real "last seen". Mounted in all three authenticated layouts |
| API: `/api/user/presence/route.ts` | The read-free write half of presence |
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
| `/api/admin/users` (`useAdminUsers`) | Returns archived **intact** | User-management is the surface that manages them (the index's **Archived** status facet). Filter archived only in action lists drawing from it (`AdminLeave`) |

### Intentional exceptions (keep archived users)
- **Screenshots tab** (`AdminScreenshots`) — archived users' screenshots still exist in storage and must remain viewable/deletable.
- **`AdminActiveUsers`** — resolves names from the basic-user list; archived users have no active session, so they never render anyway.

**RULE:** When adding a new page/component that lists users **for selection**, filter `isArchived` out of the rendered list.

---

## 2. Deleting Users (hard — destructive cascade)

`DELETE /api/admin/users/[uid]` (from the record panel's Actions menu) is the **destructive counterpart to archiving** — permanently removes the user **and all their personal data**. (The Delete dialog says so; the Archive dialog explicitly states data is *not* deleted.)

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
- **Intentional inconsistency:** name-composition precedence differs in a couple places (the registry row: `firstName lastName || displayName`; `AdminTimesheets`: `displayName || firstName lastName`) — deliberate presentation choices, **not** a bug to unify. The **avatar seed** is not part of that latitude: every surface seeds from `displayName` alone (DESIGN.md §5, the Avatar Seed Rule), so one identity hashes to one colour everywhere.

---

## 4. Profile Pictures

- **RULE:** Always use `src/components/ui/avatar.tsx` (`Avatar`, `AvatarImage`, `AvatarFallback`). **Never** a plain `<img>` for avatars.
- Creator `photoURL` **and `photoThumb`** are included in `useCreators` and `/api/creators` output. `photoThumb` is a 64px WebP `data:` URI and is what avatars actually render — `photoURL` is the 256px fallback. See [ca-salary.md §11b](ca-salary.md#11b-creator-avatars-format-caching-and-render-cost).
- `DisputeDocument` carries `creatorPhotoURL`, `createdByPhotoURL`, `assignedToPhotoURL` — all resolved server-side in `/api/disputes/route.ts`.
