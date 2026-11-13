# BuddyX — retired, and the sales-ledger rules it introduced

**BuddyX is retired (2026-11-13, [migration plan](../onlymonster-migration.md) Phase 6).** OnlyMonster is the source of OnlyFans data and of chat-agent sales after the cutover. See [onlymonster.md](onlymonster.md). Nothing calls the BuddyX API any more, and nothing writes its collections.

This spoke now covers three things:
- what BuddyX left behind (frozen `bx-*` sales, archived collections, short-lived compatibility stubs);
- the incident that ended it;
- the **sales-ledger rules BuddyX introduced, which every source still follows** (§5 disputes and reassignment, §5b the CA Admin → Sales ledger).

**Read this before touching** `/api/ca-sales/*`, the dispute create/verdict routes, `disputeTransfer.ts`, `scheduleMatch.ts`, or anything that reads a `source: 'buddyx'` row. The salary engine is in [ca-salary.md](ca-salary.md).

---

## 1. What was removed, and what stays

**Removed:**
- the client, sync, mapping and stats services;
- `/api/admin/buddyx/*` and `/api/cron/buddyx-sync`, with its `vercel.json` entry;
- `SyncStatus` and `useBuddyxSync`, plus every refresh button;
- the BuddyX mapping section on CA Admin → Sales;
- the "Never online" flag, online time and reply-time medians on Chatter Analytics;
- the `analyticsSource` switch (analytics always read OnlyMonster);
- the `buddyxSyncFailing` notification;
- `buddyxapi.yaml`, and the BuddyX planner tests.

The neutral analytics modules moved to `src/lib/analytics/` and `src/components/analytics/`. The read models are `src/lib/services/ofAnalyticsService.ts`. `BUDDYX_API_KEY` can be removed from Vercel, and the key revoked in BuddyX.

**Every archived reader stops at `BUDDYX_LAST_DAY`** (`lib/analytics/history.ts`, the day before the cutover, 2026-11-05). The sync kept running after the team left BuddyX and wrote **zeros** from 6 Nov: $0 `creator-stats-days` rows, and hourly docs with 0 online and 0 messages. Read as history, those would show OnlyMonster-era shifts as "never online" and creators as earning nothing. `readTeamHours` and `readCreatorDays` drop them. The link table's series is flat after that day.

**Stays, frozen:**
- **`ca-sales` rows with `source: 'buddyx'`** (`bx-tip-*` / `bx-ppv-*`): every sale from 2026-10-04 08:50:31 SAST to the OnlyMonster cutover (2026-11-06 01:00 SAST). They are ordinary pay rows. The engine sums them like any other, disputes and admin reassignments move them (§5), and **nothing can soft-remove them any more**. A BuddyX-era sale charged back later is deducted by a separate negative `om-cb-*` row on the chargeback's day (D17 (b), `payPlan.ts`). The `bx-*` row itself is never touched (invariant 1). A shift corrected after the fact no longer re-credits them, because the sync that re-derived `scheduleHolder` is gone. Move one by admin reassignment or a dispute instead.
- **`salesSourceFor` and `ONLYMONSTER_CUTOVER_AT`** (`salaryConstants.ts`). These are what stop OnlyMonster writing a sale the BuddyX rows already hold, which would be **double pay**. They must never be removed.
- **The serialiser's BuddyX fields:** `buddyxUserId`, `attributedBy` (defaulting to `'buddyx'`), `unmappedChatterId`, `vanishedAfterFinalise`, `removedAt`. `SaleHolderNote` still explains a BuddyX row in BuddyX's terms, because that is what happened to it.
- **The DELETE guard** in `/api/ca-salary/sales`. Synced rows (BuddyX or OnlyMonster) cannot be deleted, and a deleted BuddyX row would never come back.
- **Archived collections read as history** (§8): `creator-stats-days` (OnlyFans Analytics before each account's OnlyMonster coverage), `buddyx-links` (OnlyMonster has no link statistics), `buddyx-subscribers` (a fan's subscription history), `buddyx-models` (names and folds unmapped `buddyx:{modelId}` rows), `buddyx-team-hours` (the shift timeline's hourly lane), and `buddyx-fan-names` (the live **fan registry** until the `FAN_REGISTRY` move to `fans`, see [fan-base.md](fan-base.md)). Chatter activity 27 Sep – 31 Oct 2026 was carried into `chatter-days` (D24).

**Compatibility stubs until 2026-11-30 (rule 9c).** Then delete them: weeks-old renderers still call these routes.

| Route | Answers |
|---|---|
| `GET /api/buddyx/status` | `{ configured: false, … }`: the old header says "BuddyX not connected" |
| `POST /api/buddyx/sync` | `410` with a "reload the app" message (the old hook toasts it) |
| `POST /api/analytics/chatters/pull` | `410`, same |
| `GET /api/buddyx/creators` | re-exports `GET /api/onlymonster/creators` |

## 2. The cutovers

`salesSourceFor(ms)` is the one predicate every writer uses:
- **Infloww** owns `≤ SALES_CUTOVER_AT` (2026-10-04 08:50:31 SAST, the last Infloww row).
- **BuddyX** owns `≤ ONLYMONSTER_CUTOVER_AT` (2026-11-06 01:00 SAST; BuddyX's last sale is 2026-11-05 21:09 SAST).
- **OnlyMonster** owns everything after it.

`spansSourceCutover(start, end)` tells the Sales Report when to label each row's source. A dispute may be filed on any sale after the Infloww cutover.

## 3. The 2026-11-13 incident: why the sync could not be left running

At 05:01 UTC on 13 Nov the BuddyX cron ran successfully, but both sales endpoints came back **empty and complete**. That is consistent with the account having been disconnected on BuddyX's side. The vanished pass's only guard was "both endpoints paginated to completion", so it soft-removed **all 150 November rows ($13,288)**. October was finalised and was untouched.

The rows were restored by clearing `removedAt` on exactly the ids that run removed, and `buddyx-meta/config.salesWriteEnabled` was set to `false` before the 13:01 run. No notification went out: removals only lower a tier, and tier notices are upward only.

**Lesson for any future source:** an empty-but-complete response from a source that has been switched off is indistinguishable from "every sale vanished". OnlyMonster's sync refuses to unmap on an empty directory, and holds vanishing for an account whose `/transactions` (or `/chargebacks`) comes back empty while rows are stored, or would lose more than half its live rows in one run (`isSuspectEmpty`, `onlymonsterLedgerService.ts`; counted `transactions.vanishHeld`). Keep it that way.

## 4. What the BuddyX sync did (the meaning of a `bx-*` row's fields)

- **Id:** `bx-tip-{id}` / `bx-ppv-{id}`, minted once from the BuddyX id and never changed. A vanished id was re-keyed onto a new one only on a unique match of facts (`saleMatchKey`, now in `saleTypes.ts`, which still drives the possible-duplicates flag).
- **Attribution (since 2026-10-19).** Every sale went to the agent the **shift schedule** had on its account at its instant (`scheduleHolder`, `scheduleMatch.ts`). BuddyX's own chatter was used only when nobody, or several, were on shift. The result is `sourceUserId`, the target every revert returns to. BuddyX's own credit is `buddyxUserId`. `attributedBy` is `'schedule' | 'buddyx' | 'departed'` (`'departed'` = BuddyX credited someone who had left, and no single agent was on shift → unassigned).
- **Invariants,** all still true of every source: `userId = transfer ? transfer.toUserId : sourceUserId`; **a sync never clears a transfer** (a later re-attribution set `attributionConflict` instead); a change touching a finalised month was refused; nothing was soft-removed unless both endpoints paginated to completion. A row that vanished inside a finalised month was left counting with `vanishedAfterFinalise`.
- **Unmapped chatter:** `userId: null` + `unmappedChatterId`. The mapping can no longer be fixed, so CA Admin → Sales lists these rows on one attention line ("came from a BuddyX chatter linked to no Bluu user — assign them").
- **Infloww history** (before the first cutover) was a one-time `.xlsx` import. Those are ordinary rows too, and the only ones an admin may delete.

## 5. Disputes v2 and admin reassignment: Bluu Backend is the source of truth

No source can reassign a sale, so who holds one is decided **here**. The sync credits the agent on shift; then an approved dispute or an admin moves the sale in `ca-sales`, and no sync undoes it. "The source's attribution" below means `sourceUserId`.

**Filing** (`POST /api/disputes { saleIds, Comment }`):
- The agent picks tips and PPVs from `GET /api/ca-sales/search`. The search covers one creator, any window inside the open months after the Infloww cutover, never the agent's own sales, and shows no totals.
- The window's days are in the caller's timezone (`timezone` param, SAST when absent), and pay still buckets on the SAST day.
- The search is one `kind in ['tip','ppv']` query on the `(creatorId, kind, occurredAt)` index.
- In one transaction, every sale is re-read and checked by `claimRefusal` (`disputeRules.ts`). Any refusal rejects the whole submission and returns each refusal (`refused[]`).
- One dispute is created per current holder, linked by `groupId` (+ `groupSize`). Unassigned sales go to `'No One'`, which means an admin.
- Every claimed sale is locked with `disputeId`.

**Verdicts** go through `applyVerdict` (`disputeTransfer.ts`):
- **The holder's approval** (`PATCH …/ca-approval`) is final. It transfers the sales in the same transaction (`transfer.kind: 'dispute'`, `sourceUserIdAtTransfer`) and writes `AdminApproval: 'Approved'`. `approvedVia` / `approvedBy` / `approvedAt` say who decided and when.
- **Partial success** is recorded in `transferResult`, never thrown.
- **An admin rejection** releases the locks. On an approved dispute it is an **overturn**, which needs a reason of at least 3 characters.
- **v1 disputes** move nothing ("Legacy — adjust manually").

**Admin reassignment:**
- `PUT /api/ca-sales/{saleId}/transfer { toUserId | null, reason }` (`ca-admin`), or in bulk through `POST /api/ca-sales/transfer-bulk` (≤ 100 moves). It moves any sale to an agent or to nobody as `transfer.kind: 'admin'`. Moving a sale back to the source's attribution clears the transfer.
- It is refused (`reassignRefusal`) for removed rows, for a sale an open dispute holds, and for a month finalised for either holder.
- **Un-transfer:** `DELETE` on the same path.
- **Audit:** every holder change appends to the sale's `assignmentLog`.
- Tier notices for both agents run from `after()`.

**Where a mismatch shows.** Every serialised sale carries `assignment`, `matchesSource`, `buddyxUserId` and `attributedBy`. `SaleHolderNote` renders them identically on CA Admin → Sales and on the agent's Sales Report. The ledger's **Source credits** column shows `buddyxUserId` (BuddyX rows only; OnlyMonster reports no per-sale chatter). The tips/PPV info tips everywhere, Chatter Analytics included, use `LEDGER_*_ATTRIBUTION`: strict shift since the OnlyMonster cutover, with BuddyX's pick before it.

## 5b. CA Admin → Sales: the ledger and its anomalies

Disputes are part of this tab:
- **Moved by dispute** (`DisputeMovesFeed`): approvals from the last 14 days, each with **Overturn**.
- The attention band lists **open claims on unassigned sales**.
- The **Disputed** view shows every claimed sale with its per-sale outcome (`disputeLedger.ts`).

The ledger shows every sale in a range of salary days, newest first, from `GET /api/ca-salary/sales?userId=all&from&to` (≤ 93 days). It is filtered and paged in memory.
- **Columns:** when · creator · held by (+ `SaleHolderNote`) · on shift · source credits · type · fan · gross · net · actions.
- **Off schedule:** the holder is not among the agents on shift at the instant, with no grace.
- **Moving a sale:** **Assign** / **Reassign** / one-click **Move to {agent on shift}**, plus bulk moves from the selection bar.

**Attention band:**

| Anomaly | Source |
|---|---|
| Held off the shift schedule | `flags.offSchedule` |
| BuddyX-era sales from an unlinked BuddyX chatter (assign them) | `unmappedChatterId` on live, unheld rows |
| Unassigned tips · PPVs with no sender | `unassigned` |
| OnlyMonster: unassigned (nobody / several on shift, agent had left) · unmapped account · unmatched chargeback · pending return · unknown status | the OnlyMonster pay rows ([onlymonster.md](onlymonster.md)) |
| Moved sale the source has since re-credited | `attributionConflict` |
| Locked by an already-decided dispute | `flags.staleLocks` |
| Possible duplicates · $0 sales · held by an archived agent | `flags.*` |
| Vanished from BuddyX inside a finalised month | `vanishedAfterFinalise` |

The BuddyX "last sync" lines (refused, unplaceable, ambiguous re-keys) went with the sync.

## 6. Analytics

Chatter, Fan and OnlyFans Analytics read OnlyMonster's collections plus the archive above. See [onlymonster.md](onlymonster.md) → *Analytics*. All three read Firestore only, cache 60 s server-side, and send `private, max-age=60` + `Vary: Authorization`. Revenue on Chatter Analytics always comes from the `ca-sales` ledger. **The board row (`SalesBoardRow`) is sales only**, because agents see every colleague's: it must never gain an activity, integrity or reply-time field. Retired with BuddyX are online time, reply-time medians and the Pull button. Their response keys stay `null`/`false` for stale renderers.

### Integrity (admin only, display only)

**Flags** (`chatterIntegrityService.ts`), period totals ranked by severity, then size:

| Kind | Raised when | High at |
|---|---|---|
| `regular-input` / `modifier-only` | ≥ 30 flagged minutes | ≥ 120 |
| `static-screen` | ≥ 60 unchanged-screen minutes | ≥ 180 |
| `input-permission` | a Mac agent refused Input Monitoring | — |

`never-online` was retired with BuddyX: it read BuddyX online time, which OnlyMonster does not have, so it would have flagged every rostered agent. The signals come from `integrity-days` / `integrity-captures` ([time-tracking.md §4b](time-tracking.md)). **None of this feeds the salary engine** (rule 9f).

The per-agent report (`/[uid]`) leads with sales (by day, by account, by shift), then the flags and the shift table. The minute timeline shows the BuddyX hourly lane only for a shift the archive covers.

## 8. Collections (archive)

All Admin-SDK only (`allow read, write: if false`; the rule blocks stay until each collection is deleted). Their indexing exemptions and TTLs stay too: removing an exemption would start indexing the archived documents.

| Collection | Status |
|---|---|
| `creator-stats-days` | **Read** (OnlyFans Analytics history; `day` range) |
| `buddyx-links` | **Read** (link table on OnlyFans / Fan Analytics) |
| `buddyx-subscribers` | **Read** (a fan's subscription history, `fanId`) |
| `buddyx-models` | **Read** (names and folds unmapped `buddyx:{modelId}` history) |
| `buddyx-team-hours` | **Read** (shift timeline, days ≤ `BUDDYX_LAST_DAY`) |
| `buddyx-fan-names` | **Read and written:** the live fan registry until `FAN_REGISTRY` moves to `fans` |
| `buddyx-meta` | Unread. `config.salesWriteEnabled` is `false` (2026-11-13) |
| `buddyx-sync-runs` | Unread; TTL `expireAt` empties it |
| `buddyx-chatters`, `buddyx-team-days`, `buddyx-team-periods`, `buddyx-mass-messages`, `buddyx-fans` | Unread |

**Export, verify, then delete on explicit approval** with `src/scripts/archive-collection.js` (§9.3 of the plan). Do not delete a collection still marked **Read** above without first moving its reader.

`ca-sales` fields BuddyX introduced (`source`, `sourceId`, `kind`, `creatorId`, `modelId`, `modelHandle`, `chatterId`, `sourceUserId`, `transfer`, `transferFromUserId`, `disputeId`, `assignmentLog`, `removedAt`, `unmappedChatterId`, `buddyxUserId`, `attributedBy`, `attributionConflict`, `vanishedAfterFinalise`, `syncHash`, `syncedAt`) are kept. The composite indexes `(creatorId, kind, occurredAt)`, `(sourceUserId, month)` and `(transferFromUserId, month)` are still used.

## 9. Open items

- Delete the four compatibility stubs (§1) after 2026-11-30.
- Remove `BUDDYX_API_KEY` from Vercel (all environments) and revoke it in BuddyX.
- Export and delete the unread collections (§8) on approval, and the read ones after their readers move: links need an OnlyMonster source; the registry needs the `FAN_REGISTRY` move.
- The terms page still names BuddyX as a processor. Changing the terms means bumping `TERMS_VERSION`, which signs everyone out ([onboarding.md](onboarding.md)), so it waits for the next terms update.
