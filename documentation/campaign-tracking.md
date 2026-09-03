# Campaign Tracking (Custom Requests & Campaigns)

> One Firestore collection backs **two** distinct surfaces, split by `type`. The **two archive mechanisms** are the single biggest gotcha — do not conflate them.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/campaignTracking.ts` | Types, `CAMPAIGN_TYPES`, `CRStatus`, `STATUS_*` maps, `EDITABLE_FIELDS` |
| `src/lib/services/campaignTrackingService.ts` | Server reads/writes |
| `src/components/campaign/entryActions.tsx` | Shared UI: `TransferDialog`, `ConfirmDialog` |
| API: `src/app/api/campaign-tracking/create/route.ts` | Create |
| API: `src/app/api/campaign-tracking/[id]/route.ts` | `PATCH` (fields in `EDITABLE_FIELDS` only) |
| API: `src/app/api/campaign-tracking/[id]/transfer/route.ts` | Reassign `createdBy` + notify |
| API: `src/app/api/campaign-tracking/[id]/creator-complete/route.ts` | Creator-side completion |
| Pages | `ca-portal/custom-requests`, `ca-portal/campaigns`, `creators/custom-requests` |

## Firestore

- `campaign-tracking/{id}` — **both** custom requests and campaigns.

---

## Two Surfaces, One Collection (split by `type`)

| Surface | `type` values | Approval workflow? | CR code? | Where surfaced |
|---|---|---|---|---|
| **Custom requests** | `CR` / `Call` / `Item` | ✅ Yes | ✅ Yes | `ca-portal/custom-requests` (incl. *My Customs*), `creators/custom-requests` (Overview + per-creator / per-chat-agent tables) |
| **Campaigns** | `CAMPAIGN_TYPES` = `BFE` / `Hubby` / `VIP` | ❌ No | ❌ No | `ca-portal/campaigns` (`where type in CAMPAIGN_TYPES`) |

- CR views filter out campaign types with `!(CAMPAIGN_TYPES as readonly string[]).includes(e.type)`.

---

## Two Archive Mechanisms — DO NOT CONFLATE

### Custom requests → use the `Archived` **`status`** value
(Added to `CRStatus` and every `STATUS_*` map.)

| Action | Writes |
|---|---|
| Archive | `status: 'Archived'`, `totalAmount = amountPaid` (zeroes outstanding for a stale/abandoned custom), **and `isArchived: false`** |
| Unarchive | `status: 'In Progress'` + `isArchived: false` |

- **Critical:** the archive write must set `isArchived: false` **explicitly**. Otherwise a custom that already had `isArchived: true` (e.g. Completed via *Mark as Complete*, which sets it, or previously dismissed) would archive to `status: 'Archived' + isArchived: true` and **never surface**.
- The creators-Overview **Recently Archived** panel shows `status === 'Archived' && !isArchived` (mirrors Recently Completed); dismissing there sets `isArchived: true`.

### Campaigns → use the **`isArchived`** boolean (never the `Archived` status)

| Action | Writes |
|---|---|
| Archive | `isArchived: true` **and `amountPaid = totalAmount`** (treated as paid in full) |
| Unarchive | `isArchived: false` |

### Archived-custom visibility rules
- Excluded from every **default** view (My Customs, all CR data tables, creators Overview).
- Data tables **keep** `Archived` in the `status in [...]` subscription filter so it loads alongside active statuses — this lets the destructive **Archived** badge show archived rows and lets search span them **with no re-subscribe**.
- Toggling the Archived badge greys out the type filters and the *Show Completed* toggle.
- Adding `Archived` to the `status in [...]` list needs **no new composite index** (indexes key on fields, not values).

---

## Transfer

`POST /api/campaign-tracking/[id]/transfer` reassigns `createdBy` to another active `CA`-group user and notifies them (see [notifications.md](notifications.md)).

- Both dashboards update instantly via live `onSnapshot` queries keyed on `createdBy` → **no cache invalidation needed**.
- **RULE:** `createdBy` is deliberately **not** in `EDITABLE_FIELDS` of `PATCH /api/campaign-tracking/[id]`. Reassignment **must** go through the transfer route so the notification always fires.

### Two notification variants — chosen server-side, never by the client

| Who transferred | Factory | Names |
|---|---|---|
| The entry's own owner (`createdBy === token.uid`) | `crTransferred` | the **transferrer** |
| Anyone else — a **manager** on `creators/custom-requests`, or a CA moving a colleague's entry from the CA creator table | `crTransferredOnBehalf` | the **previous owner** |

The route derives this from the stored `createdBy` vs `token.uid`. Do **not** add a client-supplied variant flag — the recipient is inheriting the previous owner's fan and outstanding balance, and that name must come from the doc.

### Where the action lives

Shared UI (`TransferDialog`, `ConfirmDialog`) lives in `src/components/campaign/entryActions.tsx`, reached from the **Actions** menu on:

- **CA view** (`ca-portal/custom-requests`, `ca-portal/campaigns`) — view cards + table rows.
- **Manager view** (`creators/custom-requests`) — `ManagerViewCard`, `ManagerCreatorTable` rows, and `ChatAgentTable` rows.

`TransferDialog` takes an optional **`currentOwnerUid`** and drops that uid from the picker alongside the acting user's. Managers transfer entries they do not own, so without it the current owner would be offered as a target (a silent no-op that still fires a notification). Every call site passes `entry.createdBy`.

## Timezones & due dates

**A due date is late in the *creator's* day, never the viewer's or UTC's.** There are two distinct timezone fields; do not conflate them.

| Field | Lives on | Set by | Means |
|---|---|---|---|
| `defaultTimezone` | `creators/{uid}` | **The creator's device, at sign-in** | Where this creator is. The basis of every overdue calculation. |
| `dueDateTimezone` | a `campaign-tracking` doc | Staff, per request | The zone this *particular* deadline was quoted in (a call scheduled in the fan's zone, say). Stays editable via `TimezoneCombobox`. |

### `defaultTimezone` is detected, not chosen

[`CreatorAuthProvider`](src/components/CreatorAuthProvider.tsx) reads `Intl.DateTimeFormat().resolvedOptions().timeZone` after a creator signs in and POSTs it to [`/api/creator/timezone`](src/app/api/creator/timezone/route.ts) — **only when it differs from the stored value**, so a returning creator costs zero writes (cross-cutting rule 9); the route re-checks the same thing server-side. The call is fire-and-forget and never gates sign-in: a failure just means the next sign-in tries again.

The route is the *only* writer worth caring about. It runs under `withCreatorAuth`, takes the creator id from `token.uid` (no client-supplied identifier), validates the string against the runtime's tz database via `isValidTimezone`, and writes exactly one field on exactly that creator's own doc.

**The admin UI reports it, it does not set it.** [`/admin-portal/creator-management`](src/app/(main)/admin-portal/creator-management/page.tsx) renders `defaultTimezone` read-only ("Not detected yet" until first sign-in) and no longer sends it on create or update. An admin-picked value would be silently overwritten at the creator's next sign-in, which is worse than not offering the field. `defaultTimezone` remains in the route's `ALLOWED_UPDATE_FIELDS` as an API-level escape hatch for a bad detection — but expect it to be re-detected.

### One overdue helper

[`src/lib/timezone.ts`](src/lib/timezone.ts) owns this. `isOverdue(dueDate, timezone)` is the only correct way to ask; it replaced four divergent copies that each hardcoded `dueDate + "T23:59:59Z"`, so a creator in UTC+10 saw items flip to Overdue ten hours late and one in UTC−8 saw them flip early.

- `YYYY-MM-DD` means "any time that day where the creator is" → the deadline is 23:59:59.999 **local**.
- `YYYY-MM-DDTHH:MM` names a specific local time and is taken at face value.
- No timezone (a creator who has not signed in since the change) falls back to **UTC** — the previous behaviour, not a guess from whoever is looking.

The offset math is `Intl`-based and dependency-free (`date-fns-tz` is not installed). `zonedTimeToUtcMs` applies the offset **twice** on purpose: the first pass uses the offset at the guessed instant, which is wrong when the guess lands on the far side of a DST boundary; the second settles it. Verified round-tripping across US/UK/AU DST transitions and the ±14h extremes.

**Consumers** (all pass the creator's zone, not the viewer's): the creator dashboard and content-requests list, the staff [`creator-portal/content-planning`](src/app/(main)/creator-portal/content-planning/page.tsx) page (via a `creatorTz(creators, creatorID)` lookup), and both custom-request wizards, which seed a new request's `dueDateTimezone` from the selected creator's `defaultTimezone`.
