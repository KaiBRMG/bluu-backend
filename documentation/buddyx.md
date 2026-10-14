# BuddyX Integration

BuddyX is where chat agents work now, and its read-only Public API is where CA sales come from. This spoke covers the sync, the sales it writes into `ca-sales`, disputes that now move money, and the three analytics pages.

**Read this before touching anything under `src/lib/buddyx/`, `buddyx*` services, `/api/buddyx/*`, `/api/admin/buddyx/*`, `/api/analytics/*`, `/api/ca-sales/*`, or the disputes create/verdict routes.** The salary engine itself is unchanged — read [ca-salary.md](ca-salary.md) for that. The API is described in [`buddyxapi.yaml`](../buddyxapi.yaml); the original plan and its decisions (D1–D12) are in [`buddyx-integration.md`](../buddyx-integration.md).

---

## 1. Shape

```
  cron 05:01 / 13:01 / 21:01 UTC ─┐            (07:01 / 15:01 / 23:01 SAST)
  refresh button (2-min cooldown) ┤──► runBuddyxSync()  ── lease lock (buddyx-meta/lock)
                                  │       directory → sales → chatters → creators → (fans, 21:01 only)
                                  ▼
                       lib/buddyx/client.ts — the ONLY file that calls api.buddyx.app
                                  ▼
   buddyx-chatters / buddyx-models   ca-sales (source:'buddyx')   buddyx-team-days / -periods
   creator-stats-days  buddyx-subscribers  buddyx-links  buddyx-mass-messages  buddyx-fans
                                  ▼
       salary engine (unchanged)    analytics routes (Firestore only — never the API)
```

**Nothing downstream of `ca-sales` changed.** The engine sums `signedGross` per `userId` per day exactly as it did for Infloww rows (ca-salary.md §13).

## 2. The cutover

`SALES_CUTOVER_AT` (`salaryConstants.ts`) = **2026-10-04 08:50:31 SAST**, the last Infloww row. `salesSourceFor(ms)` is the one predicate both writers use: Infloww owns `≤` it, BuddyX `>` it. Before it, BuddyX attribution is unusable for pay (most tips from 27 Sep–3 Oct are unassigned). Creator statistics split by day instead: Infloww owns days before `2026-10-04`, BuddyX from it (`BUDDYX_CREATOR_STATS_START_DAY`), so the two never write one `creator-stats-days` doc.

## 2b. Gross and net — which figure is which

**OnlyFans keeps 20%; net is 80% of gross.** Every money figure in the product is labelled one or the other (`BasisTag` / "gross" in the label, `GROSS_NOTE` on hover) — never left to a guess.

| BuddyX field | What the API says | What we store / show |
|---|---|---|
| Tip `amount`, PPV `revenue`, overview `revenue` / `tips` / `tipsAssigned`, earnings-breakdown `revenue` / `tips` / `messages` / `subscriptions`, `revShareAmount`, subscriber `price` | `{ gross, net }`, `net = gross × 0.8` (each half rounded to cents) | **Gross.** `ca-sales.grossRevenue` / `signedGross` (+ `netRevenue = round2(gross × 0.8)`), `*Gross` fields everywhere else |
| Tracking / free-trial link `metrics.revenue`, `revenueFromStackers`, `cost`; link fan `totalSpent*` | a bare number — **gross or net not stated** | Stored as reported; shown as "Revenue (as reported)" with `LINK_REVENUE_NOTE`. **Unverified** — confirm against the BuddyX dashboard before treating link ROI as gross. |
| Mass message `price` | "Price … in USD" — the list price a fan pays to unlock | Shown as "list price" |
| Infloww exports | explicit `Gross` / `Net revenue` columns | Gross; Infloww rows keep the export's own net |

The salary engine nets each day as `gross × (1 − deductionRate)` (20% by default, CA Admin → Rates), and the Sales Report's net figures use the same rate, so the report and the payslip agree. Per the API's guidance, net totals are derived from summed gross, never by summing per-row nets.

## 3. The client — `src/lib/buddyx/`

| File | Role |
|---|---|
| `client.ts` | `buddyxGet` / `buddyxPaginate` / `buddyxAll` / `buddyxData`. Base URL, bearer header, error envelope, `limit=200`, `INVALID_CURSOR` restart (once), 429 → `Retry-After` (×3), 5xx/network retry (×2). `import 'server-only'`. Counts requests for the run log. |
| `rateLimit.ts` | Two token buckets (120/min global, 30/min for `/team-reports/overview` + `/creators/earnings-breakdown`, which draw on both), resynced from `RateLimit-*` headers. |
| `errors.ts` | `BuddyxError { code, status, requestId }`. `isFatal` (auth) stops the run and alerts; `isModelScoped` (`MODEL_INACTIVE` …) skips one creator. |
| `types.ts` | Wire types + `normaliseId` — **ids arrive as JSON numbers**; everything stored keys on strings. |
| `mapping.ts` · `salesPlan.ts` · `benchmarks.ts` | Pure logic, tested in `tests/salary-engine/`. |

Requests are **sequential**. A page read never reaches the client.

## 4. Sync

| Scope | Writes | Calls/run |
|---|---|---|
| `directory` (always first) | `buddyx-chatters`, `buddyx-models` | 2 |
| `sales` | `ca-sales` | ~4–8 |
| `chatters` | `buddyx-team-days` (today, yesterday, +4 backfill), `buddyx-team-periods` (`mtd`, `7d` = the last 7 **complete** days, `prev-month` ≤ once/20h), **`buddyx-team-hours`** (one overview per completed hour, ≤ 24/run, last 2 re-pulled), `buddyx-mass-messages` | ~15 expensive + 1–2 (≤ 31 while the first week of hours backfills) |
| `creators` | `creator-stats-days` (earnings-breakdown + per-creator overview, today/yesterday/+2 backfill), `buddyx-subscribers`, `buddyx-links` (with a daily `series` snapshot, capped at 400) | ~20 expensive + ~25 |
| `fans` (21:01 UTC run, or refresh) | `buddyx-fans`, `buddyx-fan-names` | links whose fan count moved, only |

- **Lease** `buddyx-meta/lock`, 6 min, claimed in a transaction. A cron that finds it held skips; a refresh gets `409 { running }` and the UI polls `/api/buddyx/status`.
- **Cooldown**: a refresh within 2 min of the scope's last attempt returns `202 { fresh: true }` without an API call.
- **Freshness** `buddyx-meta/state` — per scope `lastSuccessAt / lastAttemptAt / lastError`, plus `runFailures`. `SyncStatus` reads it via `/api/buddyx/status`.
- **Run log** `buddyx-sync-runs`, TTL 90 days (`expireAt`).
- **Time budget** 240s (`maxDuration` 300). A scope that runs out stops cleanly and resumes next run; backfills are forward-only cursors in `buddyx-meta/cursors`, so "which days are missing" is one doc read, not a query.
- Who may refresh: `sales` → `ca-dashboard`/`ca-admin`; `chatters` → `ca-chatter-analytics`; `fans` → `ca-fan-analytics`; `creators` → `creators-of-analytics`; `directory` and the sales **preview** → admin claim.

### Identity mapping (`directory`)

- **Chatter → user** by email, folded with `normalizeEmail` (the login fold). **Never by name.**
- **Model → creator** by OnlyFans handle against `creators.OFID` **and** `creator-subaccounts.OFID` (rule 9h). A handle claimed twice maps to nobody.
- An admin's manual link (CA Admin → Sales → Mapping, admin claim) wins and survives every sync. Archived users/creators still match.
- Unmatched → stored with `uid`/`creatorId` null and reported; their sales land with `userId: null` + `unmappedChatterId`.

### Sales (`sales`) — the money path

**Window:** from the oldest month payroll still owes (`resolvePayrollMonth`) to now, never before the cutover. The whole window is re-pulled every run — that is what makes vanished-row detection and late re-attribution correct.

Row id `bx-tip-{id}` / `bx-ppv-{id}`, minted from the BuddyX id the first time and **never changed** (disputes and `assignmentLog` reference it). `planSalesSync` decides; the service reads and writes around it:

0. **Identity — a re-sync updates the right document.** A BuddyX row is matched to its document by its BuddyX id (`sourceId`), never by who it is attributed to, so a reassignment in BuddyX rewrites `sourceUserId`/`userId` on the **same** document (pinned in `salesWrite.test.ts`). BuddyX's spec does not say whether a tip-allocation keeps its id when a manager reassigns it, so `resolveSaleIdentities` also pairs a new id with a vanished one when both carry the same facts (`saleMatchKey`: kind, model, fan, instant, gross in cents) **and the pairing is unique on both sides** — the document is *re-keyed* (same id, new `sourceId`) and any transfer or dispute lock on it survives. An ambiguous pairing is never guessed: it falls through to remove + create and is counted (`sales.rekeyAmbiguous`, shown on CA Admin → Sales). A document id a re-keyed row still holds is never reused (`~2` suffix).
1. **Attribution invariant.** `userId = transfer ? transfer.toUserId : sourceUserId`. **A sync never clears a transfer** — whether an approved dispute or an admin reassignment (§5) made it — the write is `merge` and never names `transfer` or `disputeId` on an existing row. If BuddyX later credits a transferred sale to someone other than whom it credited when the transfer was made (`transfer.sourceUserIdAtTransfer`, falling back to `fromUserId` on older transfers) **and** other than the agent Bluu holds it on, the transfer stands and the row gets `attributionConflict: true`. BuddyX coming round to Bluu's answer is not a conflict.
1b. **Nothing is dropped silently.** Rows at/before the cutover are Infloww's. A row with no id or no parseable date is counted as `sales.unplaceable` and surfaces on CA Admin → Sales. Both endpoints are called without `chatterId`/`modelIds`, so the window covers every allowed model and every chatter, **assigned and unassigned** (`chatterId: null` on either endpoint → `userId: null`).
2. **Write only what changed** — every synced field is fingerprinted into `syncHash`.
3. **Finalised guard** — a change touching a month finalised for the stored *or* new holder is refused and counted (`sales.rejectedFinalized`).
4. **Vanished rows** — a stored row the API stopped returning is soft-removed (`removedAt`) **only when both endpoints paginated to completion**, and never inside a finalised month (flagged `vanishedAfterFinalise`, left counting). A row that reappears is restored. Reads drop `removedAt` rows in memory; no index change.
5. After writing: commission-tier notices for every touched agent-month, and a one-time alert per new unmapped chatter carrying sales.

**The write switch.** `buddyx-meta/config.salesWriteEnabled` (admin claim, CA Admin → Sales) is **off by default**. While off, the sales pass is a dry run and writes nothing. CA Admin → Sales → **Preview** returns per-agent, per-day totals to check against the BuddyX dashboard before switching it on — sequencing step 3. It is a Firestore doc, not a constant, so it can be turned off again without a deploy (rule 9c).

### Infloww history (one-off)

`POST /api/admin/buddyx/historical-import` (admin claim; CA Admin → Sales → Historical import). `kind=sales` runs the old `parseSalesSheet` (now cutover-aware, and stamping `source`/`kind`/`creatorId`/`sourceUserId`); because sale ids are content hashes, already-stored rows are **backfilled in place**. It also seeds `buddyx-fan-names` and rebuilds `buddyx-fans` spend for every month touched. `kind=creator-stats` reads sheet "Creator Statistics Detail" and keeps only the fields BuddyX continues. `/api/ca-salary/import` (the `.xlsx` upload) was **deleted**; the historical route replaces it. **Delete the historical route, `inflowwImportService.ts` and `HistoricalImport.tsx` once the history is in.**

## 5. Disputes v2 and admin reassignment — Bluu Backend is the source of truth

BuddyX is read-only (and cannot reassign a PPV at all), so who holds a sale is decided **here**: an approved dispute or an admin moves the sale in `ca-sales`, and no sync undoes it.

- **Filing** (`POST /api/disputes { saleIds, Comment }`): the agent picks **tips and PPVs** from `GET /api/ca-sales/search` (one creator, ≤ 7 days, open months, after the cutover, no totals, never their own; one `kind in ['tip','ppv']` query on the existing `(creatorId, kind, occurredAt)` index). In one transaction every sale is re-read and checked by `claimRefusal` (`disputeRules.ts`); any refusal rejects the whole submission and returns each one (`refused[]`) so the dialog marks those rows. One dispute per current holder, linked by `groupId` (+ `groupSize`); unassigned sales go to `'No One'` → straight to admin. Every claimed sale is locked with `disputeId`. **PPVs were refused until 2026-10-12** — only because the fix had to be made in BuddyX, which cannot move one; that refusal is gone.
- **CA rejection** releases the locks (`releaseDisputeLocks`).
- **Admin verdict** (`applyAdminVerdict`, shared by the single and bulk routes): v2 approval transfers each sale still held as claimed, in a month open for both, setting `transfer` (`kind: 'dispute'`, `sourceUserIdAtTransfer`), `userId = createdBy`, `transferFromUserId`; others are skipped with a reason. A sale BuddyX re-credited to the filer while the claim was open counts as already moved, and its lock is released. **Partial success is recorded in `transferResult`, never thrown.** Rejection releases locks and — if the dispute had been approved — gives its transfers back. v1 disputes move nothing ("Legacy — adjust manually").
- **Admin reassignment** `PUT /api/ca-sales/{saleId}/transfer { toUserId | null, reason }` (`ca-admin`; CA Admin → Sales → row → **Reassign**): moves a BuddyX sale to an agent or to nobody, as a `transfer` with `kind: 'admin'` and the reason (≥ 3 chars) — so it survives every sync exactly as a dispute's move does. Moving it to the agent BuddyX credits **clears** the transfer (the sale matches BuddyX again). Refused (`reassignRefusal`) for Infloww rows, removed rows, a sale an **open** dispute holds (a stale lock — `lockIsStale` — is cleared instead), and a month finalised for the current or new holder. The target must be an existing, non-archived user. Replacing or clearing a dispute's transfer appends to that dispute's `untransfers[]`, so its detail shows the sale as reverted.
- **Un-transfer** `DELETE /api/ca-sales/{saleId}/transfer { reason }` (`ca-admin`, open months): the escape hatch for a wrong approval — a reassignment back onto BuddyX's attribution (`untransferSale` → `reassignSale`).
- **Audit:** every change of holder (dispute, admin, revert) appends `{ action, fromUserId, toUserId, by, at, reason, disputeId }` to the sale's `assignmentLog` (index-exempt).
- **Where a mismatch shows.** Every serialised sale carries `assignment` (`source` · `dispute` · `admin`) and `matchesSource`. `SaleHolderNote` renders it identically on CA Admin → Sales and on the agent's Sales Report (*Moved by dispute* / *Reassigned by admin*, blue; *· BuddyX changed since*, orange; *· BuddyX agrees*, grey). The agent's report also lists **In BuddyX, held elsewhere** — sales BuddyX credits to them that Bluu holds on someone else — from the `(sourceUserId, month)` index (falls back to the old `transferFromUserId` read until that index is built).
- Tier notices for both agents run from `after()`.

## 5b. CA Admin → Sales — the ledger and its anomalies

The whole month's ledger: every agent's rows, unassigned and unmapped sales, and removed rows (toggle). Columns: when · **held by** (+ `SaleHolderNote`) · **BuddyX credits** · creator · type (+ flags) · fan · gross · net · **Reassign**. Filters: agent, creator, kind, unassigned, **differs from BuddyX**, removed, and search (fan, chatter, sale id). The summary line counts sales held differently from BuddyX, split by dispute/admin.

The **attention band** lists every anomaly the ledger can detect, each with *Show them* (narrows the ledger to exactly those rows):

| Anomaly | Source |
|---|---|
| Unmapped BuddyX chatter / creator | mapping |
| Unassigned tips · PPVs with no sender | `unassigned` |
| Moved sale BuddyX has since re-credited | `attributionConflict` |
| Locked by an already-decided dispute | `flags.staleLocks` (`lockIsStale`) |
| Possible duplicates (same kind, creator, fan, instant, gross; different ids) | `flags.possibleDuplicates` |
| $0 sales | `flags.zeroGross` |
| Sales held by an archived agent | `flags.archivedHolders` |
| Vanished from BuddyX inside a finalised month | `vanishedAfterFinalise` |
| Last sync: changes refused to a finalised month · rows it could not place · ambiguous id changes | run counts `sales.rejectedFinalized` · `sales.unplaceable` · `sales.rekeyAmbiguous` |

Detection runs in `GET /api/ca-salary/sales?userId=all` (`detectAnomalies`) — two field-masked `getAll`s (locking disputes, holders), no queries.

## 6. Analytics

All three read Firestore only, cache 60s server-side per scope key, and send `private, max-age=60` + `Vary: Authorization`.

| Page | Route | Scope |
|---|---|---|
| Chatter Analytics `/ca-portal/chatter-analytics` (+ report `/[uid]`) | `/api/analytics/chatters`, `/api/analytics/chatters/[uid]`, `/api/analytics/chatters/[uid]/shift` | **Sales first** (since 2026-10-14; coverage retired — see *Integrity* below). **Default period: the last 7 complete days.** **Two sources:** revenue (PPV / tips gross, counts sold, every trend) comes from the `ca-sales` ledger — Infloww history back to Oct 2025, BuddyX after, transfers applied, so it matches the Sales Report — while activity (messages, fans chatted, PPVs sent / unlock rate, online and reply times, mass messages) comes from BuddyX team reports only and is `null` ("—") before `BUDDYX_TEAM_STATS_START_DAY` (27 Sep 2026). **Everyone** (agent and `ca-admin`) gets: the **team band** (team gross, PPV/tips split, change against the comparison period, team sales by day), then the **named sales board** — every non-archived agent with a sale, BuddyX activity or a rostered shift, ranked by gross (ties: sales made, then name), each row a PPV+tips bar on one shared scale with gross, sales made, gross per clocked hour, accounts rostered and change vs the comparison period — then their own figures (place, PPV, tips, unlock rate, reply time, own daily trend, messaging). **The board row is sales only** (`SalesBoardRow`) because agents see every colleague's: it must never gain an activity, integrity or reply-time field. The anonymous benchmark (D8) it replaced is gone. `ca-admin` additionally gets BuddyX chatters linked to nobody (BuddyX's own revenue, unranked), every row as a link to the report, and the flag list last. **Comparison period:** month to date → the same days last month; a whole month → the month before; anything else → the same number of days immediately before; none past `BOARD_RATE_MAX_DAYS` (93) or before the sales history (`CREATOR_HISTORY_START_DAY`). **Per clocked hour** = gross ÷ Bluu worked time over the period (`computeTimeWorked`), shown at ≥ 1h, and only for ranges ≤ 93 days — it reads every agent's time ledger, a read that grows with the range. **Reads:** the ledger is read and cached **per month** (`sales:{month}`), so a period and its comparison share the overlapping month; the board is built once per period and cached (`board:{period}:{from}:{to}`), shared by every viewer and the report. **Period picker** (shared [`PeriodPicker`](../src/components/buddyx/PeriodPicker.tsx), also on OnlyFans Analytics): *Last 7 days* · the current month · the two before it (named, e.g. *October · September · August*) · *Last 3 / 6 months* · *Last year* (rolling, through today), then start/end date inputs that always show the active range — editing one switches to a custom range (≤ 366 days). Only `7d`, `mtd` and `prev-month` have a synced whole-period doc; every other preset and any custom range sums days, and its medians need an admin **Pull** (`/api/analytics/chatters/pull`, one live call clamped to `BUDDYX_TEAM_STATS_START_DAY`, stored 7 days as `custom-{from}-{to}`). `30d` is no longer offered but the routes still accept it for stale renderers (rule 9c). |
| Fan Analytics `/ca-portal/fan-analytics` (+ `/[fanKey]` report) | `/api/analytics/fans`, `/api/fans`, `/api/fans/{fanKey}` | Agent: creators on their own shifts this month. `ca-admin`: all + acquisition. The report **404s** a fan outside scope. The fan drawer was replaced by the per-fan report — see [fan-base.md](fan-base.md). |
| OnlyFans Analytics `/creator-portal/onlyfans-analytics` | `/api/analytics/creators` | Internal; every creator. Range back to 2025-10-04; default period is the current month (same `PeriodPicker` as Chatter Analytics, without *Last 7 days*). **The four KPI tiles follow the period** (every creator, never the roster selection): gross earnings and new subscribers, each vs the same-length window before ("no previous period" when that window predates the history), the **top link** by revenue added inside the period (from each link's cumulative `series`; a link first synced mid-period counts from its first entry), and creators earning with the top earner's share. The response still carries the legacy `earningsMtd`/`newSubsMtd`/`bestLink`/`activeCreators` keys, now filled with period figures, for stale renderers (rule 9c) — drop them once those have cycled. **Names are resolved server-side** (`identities` in the response — the client creator store holds active creators only). Every active mapped creator gets a roster card; an **archived** creator, one **deleted** in Bluu, or a BuddyX creator **mapped to nobody** gets one only for a period it earned in, marked *Archived* (grey) / *Deleted in Bluu* / *Not in Bluu* (orange). An unmapped model's daily stats are stored under `buddyx:{modelId}` and folded into the creator once mapped (a real row for the same day wins). |

`buddyx-fans.spendByMonth` is rebuilt from `ca-sales` (both sources) for the open months by the `fans` scope, and for every imported month by the historical import. `spendMonths` (indexed array) is how a month's rebuild finds fans to clear. Lifetime spend, first seen and last purchase are derived on read.

**Not mirrored, on purpose:** `/messages` (private text), mass-message `text`, `/fan-conversation`.

### Integrity (admin only, display only)

**Coverage was retired on 2026-10-14.** It was BuddyX online time while clocked in ÷ Bluu clocked working time, and it led the admin view — but BuddyX online time always matched clocked time, so it carried no signal. Gone with it: the per-agent coverage cards and the five-column comparison table (`AgentRoster`), the agent's coverage meter, the `low-coverage` flag, the report's *Clocked vs online* chart and the shift table's online/coverage columns. Chatter Analytics no longer reads `buddyx-team-hours`; only the report does, for the shift table's messages and the minute timeline's BuddyX lane. The sync still writes it.

**Flags** ([`chatterIntegrityService.ts`](../src/lib/services/chatterIntegrityService.ts)) — period totals, ranked severity then size:

| Kind | Raised when | High at |
|---|---|---|
| `never-online` | rostered in the part of the period BuddyX covers, and no BuddyX online time (absent, or working under an unlinked chatter id) | always |
| `regular-input` / `modifier-only` | ≥ 30 flagged minutes | ≥ 120 |
| `static-screen` | ≥ 60 unchanged-screen minutes | ≥ 180 |
| `input-permission` | Mac agent refused Input Monitoring | — |

The input and screen signals come from `integrity-days` / `integrity-captures` — see [time-tracking.md §4b](time-tracking.md). **None of this feeds the salary engine** (rule 9f).

**The report** (`/[uid]`) reuses the page's cached team and board reads and adds the agent's own: time ledger, shifts, captures, plus the hourly docs. It leads with sales — gross, place on the board, gross per clocked hour, sales by day, and gross **by account** (keyed on the sale's `creatorId`, falling back to the creator name it was imported under) — then messages, flagged time, the flags and the shift table. Its shift table carries the gross of the agent's sales made inside each shift's window (`occurredAt`) and lists every scheduled occurrence (in-shift cover excluded) plus any session that overlapped no shift; each row opens `/shift`, the minute-grain timeline (Bluu state, BuddyX by hour, keys per minute, flagged stretches, captures). Screenshot thumbnails appear only for a viewer who already has `shift-management` or the admin claim — the report never widens screenshot access.

## 7. Alerting

`notifications.buddyxSyncFailing(reason)` → `OPS_ALERT_RECIPIENT_UID` via `sendOpsAlertOnce`, key `buddyx-sync-failing`, **cleared on the next healthy run** (`clearOpsAlert`) — once per incident, not once ever. Fires on a fatal auth error, or 3 consecutive failed runs. A new unmapped chatter carrying sales alerts once under its own key (`buddyx-unmapped-{chatterId}`), latched by `buddyx-chatters.unmappedAlertedAt`.

## 8. Collections

All Admin-SDK only (`allow read, write: if false`). Bulky fields are index-exempt.

| Collection | Id | Queried by |
|---|---|---|
| `buddyx-meta` | `state` · `lock` · `config` · `cursors` | — |
| `buddyx-sync-runs` | auto | `startedAt` desc · TTL `expireAt` |
| `buddyx-chatters` | chatterId | `manualUid` (delete cascade) |
| `buddyx-models` | modelId | — |
| `buddyx-team-days` | `YYYY-MM-DD` | by id |
| `buddyx-team-periods` | `mtd` · `prev-month` · `7d` · `custom-{from}-{to}` (a stale `30d` doc may linger — no longer synced or read) | by id · TTL `expireAt` |
| `buddyx-team-hours` | `YYYY-MM-DD` (salary day) | by id. Maps `online` / `messages[chatterId][hour 0–23]`, `uids`, `hours` (presence = pulled); all index-exempt. Cursor `buddyx-meta/cursors.teamHoursThrough` |
| `buddyx-mass-messages` | id | `day` range |
| `creator-stats-days` | `{creatorId}_{day}` — `creatorId` is `buddyx:{modelId}` for an unmapped model | `day` range |
| `buddyx-subscribers` | event id | `day` range, `fanId`, `syncedAt` |
| `buddyx-links` | `{modelId}_{linkId}` | `modelId` |
| `buddyx-fans` | `{creatorId}_{fanId}` | `creatorId in`, `spendMonths array-contains` |
| `buddyx-fan-names` | fanKey (OnlyFans id, or `h_<handle>`) | by id; `customsCount > 0` — the **fan registry**, see [fan-base.md](fan-base.md). Syncs write `name`/`source` with `merge: true` |

`ca-sales` gained `source`, `sourceId`, `kind`, `creatorId`, `modelId`, `modelHandle`, `chatterId`, `sourceUserId`, `transfer` (`kind`, `fromUserId`, `toUserId` — nullable for an admin move to nobody — `disputeId` — null for an admin move — `sourceUserIdAtTransfer`, `reason`, `approvedBy`, `approvedAt`), `transferFromUserId`, `disputeId`, `assignmentLog`, `removedAt`, `unmappedChatterId`, `attributionConflict`, `vanishedAfterFinalise`, `syncHash`, `syncedAt`; `userId` may now be `null`. Composite indexes: `(creatorId, kind, occurredAt)` for the dispute search, `(sourceUserId, month)` for the agent's "In BuddyX, held elsewhere", and `(transferFromUserId, month)` — the old "transferred away" read, now only its fallback. `fanId` is no longer index-exempt (the fan report queries it, and a rename writes the fan's name through to every sale — `fanName` is the **resolved** registry name, not BuddyX's). `disputes` gained `version`, `groupId`, `groupSize`, `saleIds`, `sales`, `totalGross`, `transferResult`, `untransfers` (all exempt).

Delete cascade: a deleted user's manual chatter links are cleared; `ca-sales.userId` is kept (pay history).

## 9. Open items

- Run order to go live: deploy rules + indexes → set `BUDDYX_API_KEY` → check Mapping (all active chatters and models mapped) → historical import (dry run, then commit; sales, then creator stats) → sales **Preview** vs the BuddyX dashboard → switch **Write sales** on.
- Then delete the historical-import route, its service and `HistoricalImport.tsx` (§4).
- `revShare` is null for every creator in BuddyX; the OnlyFans Analytics rev-share fact stays hidden until it is configured there.
- Open questions from the plan: creator-facing analytics in the Mini App; a live, admin-only fan conversation on the fan report.
- **Unverified against the live API (rule 9j — not probed):** whether a BuddyX tip-allocation keeps its `id` when a manager reassigns it (the re-key fallback covers either answer), and whether `/team-reports/ppv-revenue` returns PPVs sent by someone outside the team (e.g. the creator) with `chatterId: null` or omits them. If it omits them, those PPVs are not in the ledger — check the PPV total on the BuddyX dashboard against CA Admin → Sales.
