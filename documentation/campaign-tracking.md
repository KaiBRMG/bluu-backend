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

`POST /api/campaign-tracking/[id]/transfer` reassigns `createdBy` to another active `CA`-group user and notifies them (`crTransferred` — see [notifications.md](notifications.md)).

- Both dashboards update instantly via live `onSnapshot` queries keyed on `createdBy` → **no cache invalidation needed**.
- **RULE:** `createdBy` is deliberately **not** in `EDITABLE_FIELDS` of `PATCH /api/campaign-tracking/[id]`. Reassignment **must** go through the transfer route so the notification always fires.

Shared UI (`TransferDialog`, `ConfirmDialog`) lives in `src/components/campaign/entryActions.tsx`, reached from the **Actions** menu on CA-view cards + table rows.
