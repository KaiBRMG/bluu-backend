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
| `chatters` | `buddyx-team-days` (today, yesterday, +4 backfill), `buddyx-team-periods` (`mtd`, `7d`, `30d`, `prev-month` ≤ once/20h), `buddyx-mass-messages` | ~8 expensive + 1–2 |
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

Row id `bx-tip-{id}` / `bx-ppv-{id}`. `planSalesSync` decides; the service reads and writes around it:

1. **Attribution invariant.** `userId = transfer ? transfer.toUserId : sourceUserId`. **A sync never clears a transfer** — the write is `merge` and never names `transfer` or `disputeId` on an existing row. If BuddyX re-attributes a transferred sale away from `transfer.fromUserId`, the transfer stands and the row gets `attributionConflict: true`.
2. **Write only what changed** — every synced field is fingerprinted into `syncHash`.
3. **Finalised guard** — a change touching a month finalised for the stored *or* new holder is refused and counted (`sales.rejectedFinalized`).
4. **Vanished rows** — a stored row the API stopped returning is soft-removed (`removedAt`) **only when both endpoints paginated to completion**, and never inside a finalised month (flagged `vanishedAfterFinalise`, left counting). A row that reappears is restored. Reads drop `removedAt` rows in memory; no index change.
5. After writing: commission-tier notices for every touched agent-month, and a one-time alert per new unmapped chatter carrying sales.

**The write switch.** `buddyx-meta/config.salesWriteEnabled` (admin claim, CA Admin → Sales) is **off by default**. While off, the sales pass is a dry run and writes nothing. CA Admin → Sales → **Preview** returns per-agent, per-day totals to check against the BuddyX dashboard before switching it on — sequencing step 3. It is a Firestore doc, not a constant, so it can be turned off again without a deploy (rule 9c).

### Infloww history (one-off)

`POST /api/admin/buddyx/historical-import` (admin claim; CA Admin → Sales → Historical import). `kind=sales` runs the old `parseSalesSheet` (now cutover-aware, and stamping `source`/`kind`/`creatorId`/`sourceUserId`); because sale ids are content hashes, already-stored rows are **backfilled in place**. It also seeds `buddyx-fan-names` and rebuilds `buddyx-fans` spend for every month touched. `kind=creator-stats` reads sheet "Creator Statistics Detail" and keeps only the fields BuddyX continues. `/api/ca-salary/import` (the `.xlsx` upload) was **deleted**; the historical route replaces it. **Delete the historical route, `inflowwImportService.ts` and `HistoricalImport.tsx` once the history is in.**

## 5. Disputes v2 — Bluu Backend is the source of truth

BuddyX is read-only, so an approved dispute **moves the sale here**.

- **Filing** (`POST /api/disputes { saleIds, Comment }`): the agent picks tips from `GET /api/ca-sales/search` (one creator, ≤ 7 days, open months, after the cutover, **tips only**, no totals, never their own). In one transaction every sale is re-read and checked by `claimRefusal` (`disputeRules.ts`); any refusal rejects the whole submission and returns each one (`refused[]`) so the dialog marks those rows. One dispute per current holder, linked by `groupId` (+ `groupSize`); unassigned tips go to `'No One'` → straight to admin. Every claimed sale is locked with `disputeId`. A PPV is refused with *"PPV sales are assigned to the sender"*.
- **CA rejection** releases the locks (`releaseDisputeLocks`).
- **Admin verdict** (`applyAdminVerdict`, shared by the single and bulk routes): v2 approval transfers each sale still held as claimed, in a month open for both, setting `transfer`, `userId = createdBy`, `transferFromUserId`; others are skipped with a reason. **Partial success is recorded in `transferResult`, never thrown.** Rejection releases locks and — if the dispute had been approved — gives its transfers back. v1 disputes move nothing ("Legacy — adjust manually").
- **Un-transfer** `DELETE /api/ca-sales/{saleId}/transfer { reason }` (`ca-admin`, open months): the escape hatch for a wrong approval; recorded as `untransfers[]` on the dispute.
- Tier notices for both agents run from `after()`.

## 6. Analytics

All three read Firestore only, cache 60s server-side per scope key, and send `private, max-age=60` + `Vary: Authorization`.

| Page | Route | Scope |
|---|---|---|
| Chatter Analytics `/ca-portal/chatter-analytics` | `/api/analytics/chatters` | **Two sources:** revenue (PPV / tips gross, counts sold, the daily trend) comes from the `ca-sales` ledger — Infloww history back to Oct 2025, BuddyX after, transfers applied, so it matches the Sales Report — while activity (messages, fans chatted, PPVs sent / unlock rate, online and reply times, mass messages) comes from BuddyX team reports only and is `null` ("—") before `BUDDYX_TEAM_STATS_START_DAY` (27 Sep 2026). Agent: own row, daily trend, **anonymous** benchmark (median + top quartile, only with ≥ 3 active agents — sold something or were online; a metric with no figure leaves an agent out of that comparison only). `ca-admin`: named leaderboard (every agent with sales or BuddyX activity, plus unlinked BuddyX chatters), BuddyX online vs Bluu clocked time over the part of the range BuddyX covers (gap stated past 15%), revenue per account, rostered-but-offline band (also BuddyX-covered days only). Custom ranges sum days; medians need an admin **Pull** (`/api/analytics/chatters/pull`, one live call, stored 7 days). |
| Fan Analytics `/ca-portal/fan-analytics` | `/api/analytics/fans`, `/api/analytics/fans/{creatorId}/{fanId}` | Agent: creators on their own shifts this month. `ca-admin`: all + acquisition. The detail **404s** a fan outside scope. |
| OnlyFans Analytics `/creator-portal/onlyfans-analytics` | `/api/analytics/creators` | Internal; every creator. Range back to 2025-10-04. |

`buddyx-fans.spendByMonth` is rebuilt from `ca-sales` (both sources) for the open months by the `fans` scope, and for every imported month by the historical import. `spendMonths` (indexed array) is how a month's rebuild finds fans to clear. Lifetime spend, first seen and last purchase are derived on read.

**Not mirrored, on purpose:** `/messages` (private text), mass-message `text`, `/fan-conversation`.

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
| `buddyx-team-periods` | `mtd` · `prev-month` · `7d` · `30d` · `custom-{from}-{to}` | by id · TTL `expireAt` |
| `buddyx-mass-messages` | id | `day` range |
| `creator-stats-days` | `{creatorId}_{day}` | `day` range |
| `buddyx-subscribers` | event id | `day` range, `fanId`, `syncedAt` |
| `buddyx-links` | `{modelId}_{linkId}` | `modelId` |
| `buddyx-fans` | `{creatorId}_{fanId}` | `creatorId in`, `spendMonths array-contains` |
| `buddyx-fan-names` | fanId | by id |

`ca-sales` gained `source`, `sourceId`, `kind`, `creatorId`, `modelId`, `modelHandle`, `chatterId`, `sourceUserId`, `transfer`, `transferFromUserId`, `disputeId`, `removedAt`, `unmappedChatterId`, `attributionConflict`, `vanishedAfterFinalise`, `syncHash`, `syncedAt`; `userId` may now be `null`. New composite indexes: `(creatorId, kind, occurredAt)` for the dispute search, `(transferFromUserId, month)` for "transferred away". `fanId` is no longer index-exempt (the fan drawer queries it). `disputes` gained `version`, `groupId`, `groupSize`, `saleIds`, `sales`, `totalGross`, `transferResult`, `untransfers` (all exempt).

Delete cascade: a deleted user's manual chatter links are cleared; `ca-sales.userId` is kept (pay history).

## 9. Open items

- Run order to go live: deploy rules + indexes → set `BUDDYX_API_KEY` → check Mapping (all active chatters and models mapped) → historical import (dry run, then commit; sales, then creator stats) → sales **Preview** vs the BuddyX dashboard → switch **Write sales** on.
- Then delete the historical-import route, its service and `HistoricalImport.tsx` (§4).
- `revShare` is null for every creator in BuddyX; the OnlyFans Analytics rev-share fact stays hidden until it is configured there.
- Open questions from the plan: creator-facing analytics in the Mini App; a live, admin-only fan conversation in the fan drawer.
