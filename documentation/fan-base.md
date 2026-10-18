# Fan Base (fan registry, fan directory, fan report, wizard fan picker)

> One fan across every creator, bridging BuddyX/Infloww **sales** with the **custom-request** pipeline. A fan has one name everywhere, set by hand or learned from their customs.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/fans/fanIdentity.ts` | Client-safe core: `parseProfileLink`, `fanKeyOf`, `pickCustomsName`, `resolveFanName`, `customMoney`. Unit-tested in `tests/salary-engine/fanIdentity.test.ts` |
| `src/lib/services/fanRegistryService.ts` | Registry **writes**: `resolveFanKeyForLink`, `refreshFanCustoms`, `setManualFanName`, `linkHandleFan`, `resolvedFanNames` (used by the BuddyX sales sync), and the name write-through |
| `src/lib/services/fanBaseService.ts` | Registry **reads**: `getFanDirectory`, `lookupFans`, `getFanReport`, `canViewFan` |
| API | `GET /api/fans` (directory) · `GET /api/fans/lookup` (wizard) · `GET /api/fans/[fanKey]` (report) · `PUT /api/fans/[fanKey]/name` · `POST /api/fans/[fanKey]/link` |
| UI | `ca-portal/fan-analytics` (Insights / **All fans** tabs) · `ca-portal/fan-analytics/[fanKey]` (`FanReportView.tsx`) · `components/fans/FanDirectory.tsx` · `components/fans/FanPicker.tsx` |
| Writers that call `refreshFanCustoms` | `POST /api/campaign-tracking/create`, `PATCH` + `DELETE /api/campaign-tracking/[id]` |
| Backfill | `src/scripts/backfill-fan-keys.js` (one-off; idempotent) |

## Identity — the fan key

- **A fan is one OnlyFans user across every creator**, keyed by their numeric OnlyFans id (the `fanId` on every BuddyX sale).
- A fan known only from a custom whose profile link carries a **handle** (`onlyfans.com/somehandle`) gets a provisional key **`h_<handle>`**. Numeric ids never start with `h`, so the spaces cannot collide.
- Profile links look like `onlyfans.com/u598208266?rec=123456789`. **`rec` is a referral code (whoever shared the link), never the fan** — it is ignored. Measured on 2026-10-13: 60% of customs carry a `/u<id>` link, 32% a handle, 8% are Fansly/empty/junk (those stay outside the fan base; `fanKey: null`).
- **Linking** (`POST /api/fans/[fanKey]/link`, `ca-admin` only): re-keys every custom of the `h_` fan to the id, moves a manual name across if the id has none, and keeps the `h_` entry as an alias (`mergedInto`) so a later custom pasted with the handle link lands on the id. The report follows `{ movedTo }` with a redirect.

## The registry — `buddyx-fan-names/{fanKey}`

Three owners, one document, disjoint fields (`FanRegistryDocument`):

| Owner | Fields |
|---|---|
| BuddyX link sync / Infloww import | `name`, `source`, `lastSeenAt` — **both now write with `merge: true`**; a wholesale `set` would wipe staff's name |
| Staff | `manualName`, `manualNameBy`, `manualNameByName`, `manualNameAt` |
| The fan's customs | `customsName`, `customsNameVotes`, `customsCount`, `customsByType`, `customsOutstanding{Count,Amount}`, `customsAbandonedCount`, `customsRejectedCount`, `customsCreatorIds`, `lastCustomAt` |

**Name resolution** (`resolveFanName`): manual → customs → synced (BuddyX link / Infloww) → none (the id renders, never "Unknown").

- **Customs name** (`pickCustomsName`): the name most used across the fan's customs, case-insensitive, in its most recent spelling; a tie (including "nothing repeats") goes to the most recent.
- **A manual name sticks** — nothing automatic replaces it until someone presses *Revert*, which restores the automatic name.

**Names are written through, not resolved on read.** A rename/customs change updates `ca-sales.fanName` (every sale of that fan; cleared when no name is left) and `buddyx-fans.displayName`/`displayNameSource`/`salesName` (`summariseFan` maps those onto `resolveFanName`; `salesName` follows so a reverted manual name cannot survive in it). One query per collection for one fan; reads on ledgers stay free. The BuddyX sales sync stamps new sales via `resolvedFanNames`. Dispute snapshots keep the name they were filed with.

`refreshFanCustoms(keys)` runs on every custom create, on a PATCH that actually **changes** `fanName`/`profileLink`/amounts/`status`/`isArchived` (old **and** new key), and on delete — through `refreshFanCustomsQuietly` inside Next's `after()`, so it adds no latency and never fails the custom request (a failure is logged; the next edit recomputes). A fan picked in the wizard straight after a create may therefore show its previous rollup for a moment.

**One cache, owned by the registry.** `readCustomsFans()` (every entry with `customsCount > 0`) is cached 60s per instance in `fanRegistryService` and dropped by its own writers — routes never invalidate anything. Other instances, and `readFans`' 60s rollup cache, can lag up to a minute.

## Money on customs (`customMoney`)

- **Outstanding** — a live custom (not archived, not rejected; for campaigns, not `isArchived`) paid below its total.
- **Abandoned** — archived without being paid in full. Archiving rewrites the figures (a custom's total drops to what was paid; a campaign's paid rises to the total), so `PATCH` now stamps **`originalTotalAmount`** (custom requests) / **`originalAmountPaid`** (campaigns) on archive and clears it on unarchive. A custom request archived before this counts as abandoned with an **unknown** amount; a campaign archived before it counts as paid (what campaign archiving meant).
- **Rejected** — counted separately.
- **Collected** — what the fan actually paid: `amountPaid`, except an archived campaign with `originalAmountPaid` kept, where archiving raised `amountPaid` to the total. The report's customs strip shows the sum as **Lifetime value** beside Unpaid and Abandoned, and each order row's "paid" figure uses it.

## Scope & permissions

- Directory and report: `ca-fan-analytics` (`analyticsAccess`). Agent → creators rostered this month (sales, subscriptions, customs filtered to them); `ca-admin` → all. The report **404s** a fan with nothing in scope, exactly as a missing fan.
- Rename: anyone who can see the fan (`canViewFan` re-checked server-side).
- Link handle → id: `ca-admin` only (it re-keys customs and could merge two people).
- Wizard lookup: `ca-custom-requests` / `ca-campaigns` / `creators-custom-requests` — the people who already read every custom. A pasted link/id is looked up directly; a name searches the selected creator's fans plus every fan with customs.

## The wizard rule — every new fan gets a name

All three create wizards (CA custom requests, CA campaigns, Creator Portal custom requests) use `FanPicker`: search the fan base first; a fan with a name prefills the name field; a fan without one leaves it empty and **Next stays disabled until a name is typed** (`isFanPickComplete`). "Add a new fan" asks for a profile link and a required name, and offers *Use this fan* when the pasted link is already in the fan base. The server re-derives `fanKey` from the link — never trusts the client — and refuses a blank name.

## Firestore

- `campaign-tracking.fanKey` — queried by equality (auto single-field index). `originalTotalAmount` / `originalAmountPaid` index-exempt.
- `buddyx-fan-names` — every new field index-exempt **except `customsCount`** (`where customsCount > 0` lists fans with customs).
- `buddyx-fans.displayName` / `displayNameSource` — index-exempt.
- No rules change: the registry is server-only, `campaign-tracking` is server-written.

## Gotchas

- **Run the backfill once after deploy**: `cd src && node scripts/backfill-fan-keys.js` (dry run — prints totals and how many fans' names would change) then `--commit`. Plain JS like the other scripts, because the app's services import `server-only` and cannot run under plain Node; it is therefore a **port** of `fanIdentity.ts` + `fanRegistryService.ts`, so keep them in step and delete it once it has run.
- The edit dialogs on the customs pages still take free-text name/link — the server re-keys from the link on save.
- **Synced names are not written through.** The BuddyX link sync and the Infloww seed write `name`/`source` directly; existing sales keep their old synced name until the sales sync next upserts them (via `resolvedFanNames`). Deliberate: propagating would turn the nightly sync into thousands of per-fan queries, and a manual or customs name — the case that matters — always propagates.
- `FanLabel` links to the report only when the caller passes `linkToReport` (computed once per table from `usePermissions().canAccess('/ca-portal/fan-analytics')`).
