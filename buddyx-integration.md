# BuddyX Integration — Plan

> Status: **implemented 2026-10-07** — the reference is now [documentation/buddyx.md](documentation/buddyx.md). Drafted 2026-10-06.
> Scope: replace the Infloww `.xlsx` sales import with the BuddyX Public API, make Bluu Backend the sales source of truth, overhaul the Sales Report and Disputes, and add three analytics pages.
>
> Part 1 is the backend/technical pass. Part 2 (UI) is folded in after the `/impeccable shape` pass.

---

## 0. Decisions taken

| # | Decision | Choice |
|---|---|---|
| D1 | Cutover | **The instant of the last Infloww row: `2026-10-04 08:50:31 SAST` (`06:50:31Z`).** Infloww owns every sale at or before it, BuddyX every sale after it. Each source owns its own side, so nothing counts twice. |
| D2 | Historical sales | One-off backfill of the full Infloww CA sales export (2025-10-04 → cutover) through the existing parser. Finalised months are refused, as they are today. |
| D3 | Historical creator stats | Import the Infloww *Creator Statistics* file, **keeping only fields BuddyX continues**, so every chart stays one continuous series. |
| D4 | Unassigned tips (`chatterId: null`) | **Count toward nobody until claimed.** Any agent can claim one by dispute; with no holder to approve, the claim goes straight to admin. |
| D5 | Multi-sale disputes | **Auto-split per current holder.** One submission becomes one dispute per holder, linked by `groupId`. Two-stage approval is unchanged. |
| D6 | Cross-agent visibility | **Tips only, scoped search.** The agent must pick creator + window (≤7 days, open months). Results carry no per-agent totals. PPVs never appear in search. |
| D7 | Vanished rows | **Soft-remove + flag.** `removedAt` stops a row counting, the row is kept for audit and listed for admin. Never applied inside a finalised month; those are flagged instead. |
| D8 | Chatter Analytics | **Self + anonymous team benchmark** for agents; full named leaderboard for `ca-admin`. |
| D9 | Fan Analytics | Agents see fans of **creators they're rostered on this month**; `ca-admin` sees all. |
| D10 | Fan names | **Enrich where possible**: a fan directory seeded from Infloww history and BuddyX link-fan lists, falling back to the ID plus an `onlyfans.com/u{id}` link. No OF provider calls (rule 9b). |
| D11 | `.xlsx` upload | **Retired from the UI.** The parser survives only for the one-off historical import (admin claim, refuses anything after the cutover). |
| D12 | New notifications | **One:** `buddyxSyncFailing`, an ops alert, once per incident. |

### Verified against the live API (read-only, 2026-10-06)

Read-only calls to the live API. Only counts and shapes were printed, no personal data:

- **8 linked creators** (OnlyFans handles), `customName`/`revShare` currently `null`. **9 team members** (7 active, 2 inactive), every email `@gmail.com`, which fits the personal-email migration and makes email matching viable.
- **Tip history begins 2026-09-27.** From 27 Sep to 3 Oct nearly every tip is **unassigned** (e.g. 18/19 on 2 Oct). The share falls to 7/16 on 4 Oct, 1/13 on 5 Oct and 0/7 on 6 Oct, matching when chatters moved into the BuddyX app. This is the evidence for D1: before the cutover BuddyX attribution is unusable for pay.
- **PPV history begins 2026-10-04 12:39 SAST**, after the cutover. PPV rows have no `type` field.
- `chatterId` and `fanId` come back as **JSON numbers** although the spec allows `string | integer`. Normalise both to strings at the boundary.
- **Infloww `Fan ID` and BuddyX `fanId` share one id space**: 49 of the 55 fans with a BuddyX tip appear in the Infloww export. The fan directory can join across the cutover.
- Rate-limit headers behave as documented (`120` global, `30` on `/team-reports/overview` and `/creators/earnings-breakdown`).
- `/messages` runs ~**1,300 rows/day**. Subscribers ~200+/creator/month. Mass messages ~70/week. Tracking links ~23 and free-trial links ~18 per creator.
- **Infloww creator stats are bucketed in `Africa/Monrovia` (UTC+0)**, not SAST like the sales export.

### Not verifiable without risk, so handled defensively

- **PPV/tip `id` stability across calls.** Upserts and vanished-row detection key on it. The first syncs log a churn metric (rows removed and re-added with identical facts) so a non-stable id shows up quickly.
- **Whether BuddyX re-attributes a tip after the fact.** Handled: the sync re-reads attribution every run (§3.4).
- **Firestore matching** of the 8 handles and 9 emails could not be run locally (`.env.local` holds no service account). Matching is therefore a runtime step with an admin review screen (§3.2).
- Infloww creators `Sol` and `Cole` have no obvious BuddyX handle (`notashyboi`, `lefty67` …). Expected: some creators are Fansly/other and are out of scope. The mapping screen settles it.

---

# Part 1 — Backend

## 1. Shape of the change

```
                    ┌──────── Vercel Cron 05:01 / 13:01 / 21:01 UTC ────────┐
                    │        (= 07:01 / 15:01 / 23:01 SAST)                  │
  manual refresh ──►│  POST /api/buddyx/sync {scope}  (cooldown + lease lock)│
  (agent / admin)   └───────────────────────┬───────────────────────────────┘
                                            ▼
                         lib/buddyx/client.ts  — the ONLY file that knows URLs,
                         auth, pagination, rate-limit buckets, 429/Retry-After
                                            ▼
                         lib/services/buddyxSyncService.ts — one function per scope
        ┌───────────────┬──────────────┬─────────┴────────┬───────────────────┐
   directory         sales            chatters           creators           fans
 buddyx-models    ca-sales (tips,   buddyx-team-days   creator-stats-days  buddyx-fans
 buddyx-chatters   PPVs; source:    buddyx-team-        buddyx-links        buddyx-subscribers
                   'buddyx')         periods            buddyx-mass-msgs
                        │
                        ▼  unchanged: salaryEngine reads ca-sales via signedGross
                 buildSalaryMonth · overview · tier notices · finalise
```

**What does not change:** the salary engine, the ratchet, overrides, month close and leave. Per ca-salary.md §13 the engine is source-agnostic: write rows into `ca-sales` with the same shape and nothing downstream moves. The changes sit around it: a new writer, attribution fields, and disputes that now *do* something.

## 2. The API client — `src/lib/buddyx/`

| File | Role |
|---|---|
| `client.ts` | `buddyxGet(path, query)` and `buddyxPaginate(path, query)`, an async generator over `pagination.nextCursor` with `limit=200`, the max. The only file holding `https://api.buddyx.app`, the bearer header and the error envelope. |
| `rateLimit.ts` | Two token buckets per process: `global` (120/min) and `expensive` (30/min, used by `/team-reports/overview` and `/creators/earnings-breakdown`, which also draw on `global`). Each response's `RateLimit-Remaining`/`RateLimit-Reset` resyncs the bucket. A `429` sleeps `Retry-After` and retries (max 3). `INVALID_CURSOR` restarts that pagination once. |
| `types.ts` | Wire types from `buddyxapi.yaml`, plus `normaliseId(x: string \| number \| null)`, because ids arrive as numbers. |
| `errors.ts` | `BuddyxError { code, status, requestId }`. `AUTH_INVALID_KEY` is **fatal and alerting** (D12). `MODEL_INACTIVE` is per-creator and non-fatal: that creator is skipped and recorded. |

- **Server-only** (`import 'server-only'`). `BUDDYX_API_KEY` is never sent to the client (rule 10). Add it to Vercel env (Production + Preview) and to architecture-overview.md's env table.
- **Requests are sequential.** At this volume parallelism buys nothing and makes the shared bucket harder to reason about.
- **Totals come from aggregate endpoints where they exist**, per the spec's rounding guidance. Per-row sums (the salary engine's `signedGross`) carry ≤ ±$0.005 drift per row, which is immaterial for pay but means a day's sum may differ from `/earnings-breakdown` by cents. The analytics pages show the aggregate figure and never reconcile the two on screen.

## 3. Sync

### 3.1 Scopes, triggers, cadence

| Scope | What it pulls | Calls/run (est.) | Cron | Manual refresh from |
|---|---|---|---|---|
| `directory` | `/creators`, `/team-members` | 2 | every run (runs first) | admin mapping screen |
| `sales` | `/team-reports/tips` + `/team-reports/ppv-revenue` over the **sales window** (§3.3) | ~4–8 | every run | Sales Report, Disputes, CA Admin → Sales |
| `chatters` | `/team-reports/overview` per day for today + yesterday, plus one call per preset period (§5.1); `/mass-messages` window | ~8 expensive + 2 | every run | Chatter Analytics |
| `creators` | `/creators/earnings-breakdown` per day (today + yesterday); `/team-reports/overview?modelIds=X` per creator per day; `/subscribers` per creator; `/tracking-links` + `/free-trial-links` per creator | ~16 expensive + ~40 | every run | OnlyFans Analytics |
| `fans` | `/free-trial-links/{id}/fans` + `/tracking-links/{id}/fans`, incremental by `startDate`; recompute `buddyx-fans` rollups for fans touched | variable | **23:01 run only** | Fan Analytics |

- **Cron:** one entry in `src/vercel.json`, `"1 5,13,21 * * *"` → `GET /api/cron/buddyx-sync`. It runs every scope except `fans`, which runs on the 21:01 UTC tick. Fails closed without `CRON_SECRET`, like the existing crons. It lives in the Next app, not `functions/`, because it sends a notification (D12) and needs `src/lib` services (hub rule).
- **`export const maxDuration = 300`.** A full run is ~70 sequential requests; the expensive bucket (30/min) makes it ~1–2 minutes.
- **Manual refresh:** `POST /api/buddyx/sync { scope }`, `withAuth`. Scope permission: `sales` needs `ca-dashboard` or `ca-admin`; `chatters` needs `ca-chatter-analytics`; `fans` needs `ca-fan-analytics`; `creators` needs `creators-of-analytics`; `directory` needs the admin claim. **Cooldown 2 min per scope**, server-side. A refresh inside the cooldown returns `202 { syncedAt, fresh: true }` without calling the API, so a mashed button costs nothing.
- **One sync at a time:** a lease document `buddyx-meta/lock` `{ holder, scope, expiresAt }`, claimed in a transaction with a 6-minute lease. A cron that finds it held skips; a manual refresh that finds it held returns `409 { running: scope }` and the UI polls `/api/buddyx/status`.
- **Freshness:** `buddyx-meta/state` holds `{ [scope]: { lastSuccessAt, lastAttemptAt, lastError } }`. `GET /api/buddyx/status` reads that one doc, `private, max-age=15` + `Vary: Authorization` (rule 9i). Every surface's "Synced 3 min ago" label reads it.
- **Run log:** `buddyx-sync-runs/{auto}` `{ trigger: 'cron' | uid, scopes, startedAt, durationMs, requestCount, counts, errors[] }`, read by CA Admin → Sales. TTL field `expireAt` at 90 days, index-exempt.

### 3.2 Identity mapping — `directory` scope

**Chatters** → `buddyx-chatters/{chatterId}`:

```ts
{ chatterId, name, email, status, timeZone,
  uid: string | null,                 // resolved Bluu user
  match: 'email' | 'manual' | 'none',
  manualUid?: string, linkedBy?, linkedAt?,   // admin override wins over email
  syncedAt }
```

- Resolution: `manualUid` → `normalizeEmail(email)` against `users.workEmail`, using the same folding as login (`lib/authEmail`). **Never guessed by name.** An unmatched email is reported on the mapping screen with every sale it carries; those sales are stored with `userId: null` and `unmappedChatterId` set, so they show up in admin's queue rather than disappearing.
- The roster is read once per run with a field mask (`workEmail`, `displayName`, `isArchived`). Archived users still match, because historical pay must still resolve.
- **The manager is "implicitly included"** in overview stats and can appear as a chatter on revenue rows. That id never resolves to an agent, and its rows go to the unmapped queue like any other.

**Creators** → `buddyx-models/{modelId}`:

```ts
{ modelId, handle, customName, revShare,
  creatorId: string | null,           // creators uid OR creator-subaccounts id (rule 9h)
  match: 'handle' | 'manual' | 'none', manualCreatorId?, syncedAt }
```

- Resolution: `manualCreatorId` → folded `handle` against `creators.OFID` **and** `creator-subaccounts.OFID`, with `@` stripped and lower-cased. A sub-account can be an OnlyFans account in its own right, which is why sub-accounts are searched too. Archived creators still match.
- **Creators with no BuddyX model are simply absent.** Fansly and other platforms are out of scope. Nothing reports them as missing.
- A model whose `creatorId` is null still syncs. Its rows store `creatorId: null` + `modelHandle`, and the mapping screen counts them.

**Re-mapping** (admin sets `manualUid`/`manualCreatorId`) re-stamps the affected `ca-sales` rows in the open window on the next `sales` run. Rows in finalised months are not touched.

### 3.3 Sales — `sales` scope

**Window.** `[max(CUTOVER, start of oldest open month), now]`, where a month is open while any CA agent-month in it is unfinalised (`resolvePayrollMonth`'s rule). In practice that is the current month, plus last month until payroll closes. The whole window is re-pulled every run: ~100–300 rows/month today, so 2–4 pages per endpoint. A full re-pull is what makes vanished-row detection (D7) and late re-attribution correct.

**Row → `ca-sales` document.** Ids are deterministic so re-syncs upsert: `bx-tip-{id}` / `bx-ppv-{id}`.

```ts
// CaSaleDocument — additions (existing fields kept, so the engine/serialiser need no change)
source: 'infloww' | 'buddyx'          // existing rows backfilled to 'infloww'
sourceId: string                      // BuddyX row id; Infloww sale hash
kind: 'tip' | 'ppv'                   // Infloww: Type 'Messages' → ppv, 'Tips*' → tip
type: string                          // 'tips_messages' | 'tips_posts' | 'tips_profile' | 'ppv'
creatorId: string | null              // resolved id (Infloww: buildCreatorIdResolver on the name)
modelId?: string; modelHandle?: string
chatterId?: string | null             // BuddyX chatter, as the source attributes it
sourceUserId: string | null           // uid the SOURCE attributes it to (null = unassigned/unmapped)
userId: string | null                 // EFFECTIVE holder = transfer?.toUserId ?? sourceUserId
transfer?: { fromUserId: string | null, toUserId: string, disputeId: string,
             approvedBy: string, approvedAt: Timestamp } | null
transferFromUserId?: string | null    // denormalised for the "transferred away" query
disputeId?: string | null             // lock: an open dispute holds this sale
removedAt?: Timestamp | null          // D7
unmappedChatterId?: string | null
syncedAt: Timestamp
// grossRevenue = amount.gross / revenue.gross; netRevenue = .net; signedGross = gross
// occurredAt = datePurchase (tip) / unlockDate (ppv); day/month via salaryDate (Africa/Harare)
// fanId = String(fanId); fanName = fan directory lookup at write time ('' if unknown)
// status: 'complete' (BuddyX has no reversals; a removal is removedAt, below)
// employeeName = chatterName; sourceEmail = chatter email (audit); importId = sync run id
```

**Write rule (the attribution invariant).** For every API row, in a single pass over the window:

1. Read the window's stored BuddyX rows once (`month in [...]` + `source == 'buddyx'`), field-masked to `sourceUserId`, `transfer`, `removedAt`, `month`, `disputeId`. That one read serves diffing, vanished detection and the finalised guard.
2. Compute `sourceUserId` from the chatter map. Then `userId = transfer ? transfer.toUserId : sourceUserId`. **A sync never clears a transfer.**
3. **Write only what changed.** Rule 9: an unchanged row is skipped, so a steady-state run writes only new rows. Written via `bulkWriter`.
4. **Finalised guard** (unchanged semantics from ca-salary.md §4): a row whose month is finalised for its *stored* holder or its *new* holder is never written. The run reports it under `rejectedFinalized` and CA Admin → Sales lists it.
5. **Source re-attribution after a transfer:** if `transfer` is set and the source's new `sourceUserId` differs from `transfer.fromUserId`, keep the transfer, set `attributionConflict: true` and list the row for admin. This never happens silently.

**Vanished rows (D7).** A stored BuddyX row in the window that the API no longer returns gets `removedAt = now`, but only when:
- **both endpoints paginated to completion in this run.** A partial fetch never removes anything. This is the guard that matters.
- its month is not finalised. Otherwise it is flagged `vanishedAfterFinalise` for admin and left counting.

A removed row that reappears gets `removedAt` cleared. Reads exclude `removedAt` rows in memory (`getSalesForMonth`/`getSalesForMonthByUser`), so the engine never sees them. **No index change.**

**Cutover enforcement.** `SALES_CUTOVER_AT` lives in `salaryConstants.ts`. The sync drops rows `occurredAt <= cutover`, and the Infloww backfill drops rows `> cutover`. The two predicates are written as one exported helper, `salesSourceFor(occurredAtMs)`, so they cannot drift apart.

**After a sales run** (moved from the import route):
- `checkTierNotices` for every agent whose month gross changed, which keeps the commission-tier notification firing (ca-salary.md §11). It used to fire from the import.
- `invalidate` the server-side month caches used by `useSalaryMonth` consumers. The client hook TTL (60s) bounds the rest.

### 3.4 Infloww historical import (one-off)

- `POST /api/admin/buddyx/historical-import`, **admin claim** (rule 3), multipart, `kind = 'sales' | 'creator-stats'`, `dryRun` first. Surfaced as a collapsed "Historical import" block on CA Admin → Sales, visible only to admin-claim holders. **Delete after use** (tracked in §9).
- **`sales`**: the existing `parseSalesSheet` + `buildUserResolver` + `SALES_EMAIL_MAP`, unchanged, plus:
  - drops rows after the cutover;
  - adds `source: 'infloww'`, `kind`, `creatorId` (via `buildCreatorIdResolver`, ca-salary.md §11c), `sourceUserId = userId`;
  - **backfills those fields onto existing `ca-sales` rows** (same hash ids, so it is an update, not a duplicate).

  Finalised-month refusals behave exactly as today.
- **`creator-stats`**: sheet *Creator Statistics Detail* (3,294 day rows). Only the fields BuddyX continues are kept (D3):

  | Kept field | Infloww column | BuddyX source |
  |---|---|---|
  | `totalGross` | Total earnings Gross | earnings-breakdown `revenue.gross` |
  | `subsGross` | Total subscription earnings Gross | `subscriptions.gross` |
  | `tipsGross` | Tips Gross | `tips.gross` |
  | `messagesGross` | Message Gross | `messages.gross` |
  | `newSubs` | New subscribers | `newSubs` |
  | `fansChatted` | Fans chatted | overview?modelIds `fansChatted` |
  | `messagesSent` | Messages sent | overview `totalMessages` |
  | `ppvsSent` | PPVs sent | overview `ppvsSent` |
  | `replyTimeMs` | Reply time (`29m 1s` → ms) | overview `medianResponseTimeMs` |

  - `(Deleted)` creators and names that match no creator are skipped and reported.
  - **Day boundary:** Infloww days are UTC, BuddyX days are fetched in `Africa/Harare`. The two-hour shift is immaterial for trend charts. Each row stores `tz` so the boundary can be labelled, and the series is not re-bucketed (raw daily totals cannot be).
  - **`replyTimeMs` is not the same statistic on both sides.** Infloww's is an average, BuddyX's a median that excludes replies over 8 hours. The chart marks the cutover on that metric.

  Written to `creator-stats-days/{creatorId}_{day}`, `source: 'infloww'`.
- **Fan directory seed:** the sales import also upserts `buddyx-fan-names/{fanId}` `{ name, source: 'infloww', lastSeenAt }` from the `Fan` / `Fan ID` columns (~2,500 fans).

### 3.5 Analytics scopes — what is stored

All Admin-SDK only. All bulky fields are index-exempt (rule 9).

| Collection | Id | Contents | Written by |
|---|---|---|---|
| `buddyx-team-days` | `{day}` (SAST) | `totals` + `breakdown[]` from `/team-reports/overview` for that day, each row with resolved `uid` | `chatters` |
| `buddyx-team-periods` | `{preset}` (`mtd`, `prev-month`, `7d`, `30d`) | Same shape, for the whole period. **Exists because medians and p75 cannot be summed from days.** | `chatters` |
| `buddyx-mass-messages` | `{id}` | `modelId`, `creatorId`, `sentBy`→`uid`, `sentDate`, `price`, `previewCount`, `unsent*`. No text (see below). | `chatters` |
| `creator-stats-days` | `{creatorId}_{day}` | The §3.4 field set, `source: 'infloww' \| 'buddyx'`, `tz`, plus BuddyX-only extras: `revShareGross`, `massMessages`, `ppvsUnlocked`, `unlockRate`, `onlineMs` | `creators` |
| `buddyx-subscribers` | `{eventId}` | `creatorId`, `fanId`, `subType`, `isTrial`, `isCreator`, `price.gross`, `subscribedAt`, `day` | `creators` |
| `buddyx-links` | `{modelId}_{linkId}` | Link metadata + current cumulative metrics (`cost`, `claims`/`subscribers`, `transitions`, `revenue`, `fansCount`, `stackers*`), plus `series: {day → {subs, revenue, fans}}` capped at 400 entries for trends, the same year-keyed pattern as Growth Tracking | `creators` |
| `buddyx-fans` | `{creatorId}_{fanId}` | Rollup: `name`, `nameSource`, `firstSeenAt`, `lastPurchaseAt`, `spendByMonth {YYYY-MM: {tips, ppv, count}}`, `subscriptions` (last `subType`, `isTrial`, `lastSubscribedAt`, `subCount`), `acquisition {kind, linkId, linkName}`, `linkTotalSpent`, `isStacker` | `fans` (+ `sales` touches `spendByMonth`) |
| `buddyx-fan-names` | `{fanId}` | `name`, `source: 'infloww' \| 'buddyx-link'`, `lastSeenAt`. Global, because a fan's name is the same on every creator. | §3.4 seed, `fans` |

**`buddyx-fans` maintenance is incremental.** The `sales` run already holds the window's rows, so it recomputes `spendByMonth[month]` for each `(creatorId, fanId)` touched and writes only changed docs. Lifetime figures are derived on read from `spendByMonth`. The Infloww backfill seeds the history, so lifetime spend spans the cutover.

**Not mirrored, on purpose:**
- **`/messages`** (~1,300/day, private conversation text). `overview` already gives per-chatter message counts, and nothing on the planned pages needs message bodies.
- **Mass-message `text`.** Same reasoning, and it would make the collection a content archive.
- **`/fan-conversation`.** History only starts 2026-06-10 and it is per-fan.

A future "open conversation" action on the fan drawer could fetch it **live** for admins (no storage). Logged under open questions, §10.

## 4. Disputes — Bluu Backend becomes the source of truth

Today an approved dispute changes nothing in Bluu: the admin went and fixed the CRM, and the fix came back in the next export. With BuddyX read-only, **an admin approval now transfers the sale inside Bluu.**

### 4.1 Data model (v2, alongside legacy)

```ts
// disputes/{id} — v2 additions; legacy fields kept populated for every existing surface
version: 2
groupId: string                 // one submission → N disputes (one per holder, D5)
saleIds: string[]               // ≤ 50 per submission, tips only
sales: Array<{ saleId, occurredAt, creatorId, fanId, fanName, type, gross }>   // snapshot at filing, index-exempt
totalGross: number
assignedTo: string              // current holder uid, or 'No One' for unassigned tips (D4)
// legacy mirrors so the serialiser, ledger, queue and admin table keep working:
Creator     = sole creatorId, or 'multiple'
saleDate    = earliest occurredAt
saleAmount  = totalGross
fanName     = sole fan's name, or `${n} fans`
transferResult?: { transferred: string[], skipped: Array<{saleId, reason}> }   // written on admin approval
```

**v1 disputes are untouched.** They stay readable and decidable, and approving one still moves nothing (the old behaviour), labelled "Legacy — adjust manually". The freeform v1 *create* path is removed.

### 4.2 Routes

| Route | Change |
|---|---|
| `GET /api/ca-sales/search?creatorId&from&to` | **New.** `ca-dashboard` page access. Requires `creatorId`. Window ≤ 7 days, inside open months, after the cutover. Returns **tips only** (D6), excluding the caller's own and removed rows. Projection: `saleId, occurredAt, type, gross, fanId, fanName, holder {uid, displayName} \| null, disputeId != null`. No totals. Composite index `creatorId ASC, kind ASC, occurredAt ASC`. `private, max-age=30` + `Vary`. |
| `POST /api/disputes` | **Rewritten** for `{ saleIds[], Comment }`. In one transaction: read every sale. Reject if any is `kind: 'ppv'` (*"PPV sales are assigned to the sender"*), removed, before the cutover, held by the caller, already `disputeId`-locked, or in a month finalised for the holder or the filer. Then group by `userId` (null → `'No One'`), write one dispute per group with a shared `groupId`, and stamp `disputeId` on every sale. Notifications as today: `disputeAssigned` per holder, none for `'No One'`. |
| `PATCH …/ca-approval` | On **Rejected**: clear `disputeId` on its sales in the same batch (they become disputable again). Approved: unchanged. |
| `PATCH …/admin-approval` | **Approved (v2):** transaction re-reads each sale. If it is still held by `assignedTo` (or still unassigned for `'No One'`) and the month is open for both parties, set `transfer {fromUserId, toUserId: createdBy, …}`, `userId = createdBy`, `transferFromUserId`, and clear `disputeId`. Otherwise skip it with a reason. **Partial success is recorded in `transferResult`, never thrown.** Afterwards, `checkTierNotices` runs for both agents. **Rejected:** clear `disputeId`. |
| `PATCH /api/disputes/bulk-approval` | Same per-dispute logic, shared through one `applyDisputeVerdict()` in `disputeTransfer.ts`. The route is a loop over it. |
| `GET /api/disputes/summary` | Unchanged queries. The serialiser adds `version`, `sales`, `totalGross`, `groupId`, `transferResult`. |

**Admin un-transfer:** `DELETE /api/ca-sales/{saleId}/transfer` (`ca-admin`, open month only) reverts a transfer. This is the escape hatch for a wrong approval, which no longer has a CRM to undo it in.

### 4.3 What "source of truth" means here

- A sale's **effective holder** is `transfer?.toUserId ?? sourceUserId`, and every pay path reads `userId`, which always equals it.
- **BuddyX attribution is advisory after a transfer.** Bluu wins. Conflicts are surfaced (§3.3 step 5), never auto-resolved.
- `ca-salary-months` snapshots freeze as before. A transfer cannot touch a finalised month, so "what we paid" never changes.

## 5. Analytics backends

### 5.1 Chatter Analytics — `ca-chatter-analytics`

`GET /api/analytics/chatters?period=mtd|prev-month|7d|30d|custom&from&to`

- **Agent view (D8):** their own row from `buddyx-team-periods` plus the period's daily series from `buddyx-team-days`, and a **benchmark**: team median and p75 for each metric, computed server-side. Benchmarks are computed only across agents with `onlineMs > 0`, and **only when there are ≥ 3 such agents**; with fewer, the comparison would identify a colleague. No other agent's id or name crosses the wire.
- **Admin view (`ca-admin`):** the full breakdown with names and avatars, sortable.
- **Metrics:** PPV revenue, tips (assigned) and tip count, PPVs sent/unlocked, unlock rate, PPV rate, fans chatted, messages, online time, median/p75 first-reply time, mass messages sent (count, avg price, unsent).
- **Derived, and unique to Bluu:**
  - **Revenue per online hour.**
  - **BuddyX online vs Bluu clocked-in time** for the period. The time ledger comes from `time_entries` via the existing `computeTimeWorked`, and the comparison is admin view only. This is the integrity check neither system can do alone.
  - **Sales per shift-account.** Revenue ÷ assigned accounts, from `shifts.creatorIds`.
- **Custom ranges:** totals are summed from `buddyx-team-days`. Medians and p75 are **not** derivable from days, so for a custom range they render as "—" with an explainer, unless an admin presses refresh, which runs one live `overview` call and stores it as `buddyx-team-periods/custom-{from}-{to}` with a 7-day TTL.

### 5.2 Fan Analytics — `ca-fan-analytics`

`GET /api/analytics/fans?creatorId?&period` and `GET /api/analytics/fans/{creatorId}/{fanId}`

- **Scope (D9):** agents get the creators in `creatorIds` across their own shifts this month (the same read as the Overview's `accountCount`); `ca-admin` gets all. Enforced server-side on both routes: the detail route 403s a fan whose creator is out of scope.
- **Lists / KPIs:**
  - **Top spenders** (period, lifetime).
  - **Spend distribution** (buckets) and **whale concentration** (share of revenue from the top 10% of spenders).
  - **New vs returning subscribers** and **trial → paying conversion** (a trial sub who later bought).
  - **At-risk spenders** (spent in the prior 60 days, nothing in the last 14).
  - **Acquisition:** revenue and fans by tracking / free-trial link, with **ROI** where `cost > 0`.
  - **Tip vs PPV mix** per fan.
- **Fan drawer:** purchase timeline (from `ca-sales`, both sources), subscription events, acquisition link, and which chatter earned what from them (names admin-only; an agent sees "you" vs "team").
- **Read budget:** `buddyx-fans` where `creatorId in [scope]`, ~a few thousand docs. Field-masked, server-cached 60s per scope key. Single-field index on `creatorId`, and the rest of the doc is index-exempt.

### 5.3 OnlyFans Analytics — `creators-of-analytics` (Creator Portal, internal)

`GET /api/analytics/creators?creatorId?&from&to`

- **Earnings by source** (subs / tips / messages), daily, from `creator-stats-days`. Continuous across the cutover, because D3 imported only the matching fields.
- **New subs:** new vs returning vs trial, from `buddyx-subscribers` (after 2026-09-25) and `newSubs` before that.
- **Links:** tracking-link and free-trial-link performance (subs, clicks → subs conversion, revenue, revenue per fan, cost, ROI, stackers) and the trend from `series`.
- **Mass messages:** volume, average price, unsend rate.
- **Chat performance on this creator:** fans chatted, PPVs sent, reply time.
- **Rev-share amount**, when BuddyX has it configured (currently null for all 8).
- **Creator comparison** table.
- **Internal only.** Not exposed in the Telegram Mini App; see §10.

All three analytics GETs: `private, max-age=60` + `Vary: Authorization` (rule 9i), and data from Firestore only. **The API is never called on a page read**, only on sync or refresh.

## 6. Sales Report backend — `GET /api/ca-salary/sales` (extended)

Same auth (self-or-admin, `resolveSalarySubject`). Response gains:

- `byKind: { tip: {gross, count}, ppv: {gross, count} }`, the split the two tooltips annotate.
- `byCreator` keyed by **`creatorId`** (name kept for display/fallback). This removes the name-join problem for post-cutover rows.
- Per-row `source`, `kind`, `transfer` (in), `disputeId` (locked), `fanName`.
- `transferredAway`: rows where `transferFromUserId == subject && month == M` (new composite index `transferFromUserId ASC, month ASC`). An agent sees what left their month and why.
- `freshness` from `buddyx-meta/state.sales`.
- Admin variant `?userId=all` (`ca-admin`): every agent's rows for the month, plus `unassigned` (`userId == null`, served by the existing `userId, month, occurredAt` index) and `flags` (`attributionConflict`, `vanishedAfterFinalise`, `unmappedChatterId`). This is "Admin sees all sales via CA Portal → Admin".

## 7. Permissions, rules, indexes, notifications

**Pages** (`lib/definitions.ts`, per permissions.md):

| pageId | Teamspace | href |
|---|---|---|
| `ca-chatter-analytics` | `ca-portal` | `/ca-portal/chatter-analytics` |
| `ca-fan-analytics` | `ca-portal` | `/ca-portal/fan-analytics` |
| `creators-of-analytics` | `creator-portal` | `/creator-portal/onlyfans-analytics` |

The daily page-permissions sync picks them up. They are then granted on Sharing.

**Firestore rules — CHANGE (notify, rule 1):** `allow read, write: if false` for `buddyx-meta`, `buddyx-sync-runs`, `buddyx-chatters`, `buddyx-models`, `buddyx-team-days`, `buddyx-team-periods`, `buddyx-mass-messages`, `creator-stats-days`, `buddyx-subscribers`, `buddyx-links`, `buddyx-fans`, `buddyx-fan-names`. Same posture as the rest of CA salary: per-person pay data is server-assembled only.

**Firestore indexes — CHANGE (notify, rule 1):**
- Composite: `ca-sales (creatorId ASC, kind ASC, occurredAt ASC)` and `ca-sales (transferFromUserId ASC, month ASC)`.
- Field exemptions:
  - `ca-sales`: `transfer`, `sourceId`, `modelHandle`, `employeeName`, `sourceEmail`, `syncedAt`, `unmappedChatterId`.
  - `disputes`: `sales`, `transferResult`, `groupId`.
  - Every `buddyx-*` collection's map/array fields (`breakdown`, `totals`, `series`, `spendByMonth`, `subscriptions`, `acquisition`), `buddyx-sync-runs.errors`, `creator-stats-days.*` except `creatorId`/`day`.
- TTL: `buddyx-sync-runs.expireAt`, `buddyx-team-periods.expireAt`.
- Deploy: `firebase deploy --only firestore:rules,firestore:indexes`

**Notifications (rule 5 + 15):**
- `notifications.buddyxSyncFailing(reason)` → the ops maintainer, through `sendOpsAlertOnce` (`onlyfansOpsAlerts.ts`). It latches per incident, keyed `buddyx-sync-failing`, and **clears on the next successful run** so a later failure alerts again. It fires on `AUTH_INVALID_KEY`, on 3 consecutive failed runs, or on a new unmapped chatter carrying sales.
- Added to `AUTOMATED_NOTIFICATIONS` under a new `Integrations` category: `AutomatedNotificationCategory` **and** `AUTOMATED_NOTIFICATION_CATEGORIES`, plus the notifications.md table row.
- The commission-tier notice keeps firing, now from the sync (§3.3).

**Cleanup:**
- Delete cascade (rule 6): user delete nulls `buddyx-chatters.manualUid`.
- `ca-sales` rows keep their `userId`, which is pay history.
- `Infloww-data/` contains fan names and is **untracked but not git-ignored**. Add it to `.gitignore`.

## 8. File map

```
src/lib/buddyx/{client,rateLimit,types,errors}.ts          NEW
src/lib/services/buddyxSyncService.ts                       NEW  scopes, lock, state, run log
src/lib/services/buddyxMappingService.ts                    NEW  chatter/creator resolution
src/lib/services/buddyxAnalyticsService.ts                  NEW  §5 read models + benchmarks
src/lib/services/disputeTransfer.ts                         NEW  applyDisputeVerdict, validation
src/lib/salary/salaryConstants.ts                           + SALES_CUTOVER_AT, salesSourceFor
src/lib/salary/salesImport.ts                               + source/kind/creatorId, cutover filter
src/lib/services/caSalaryService.ts                         removedAt filter; tier-notice hook
src/lib/services/disputeSerialise.ts                        v2 fields
src/app/api/cron/buddyx-sync/route.ts                       NEW
src/app/api/buddyx/{sync,status}/route.ts                   NEW
src/app/api/admin/buddyx/{mapping,historical-import}/route.ts NEW (historical-import: delete after use)
src/app/api/ca-sales/search/route.ts                        NEW
src/app/api/ca-sales/[saleId]/transfer/route.ts             NEW (DELETE)
src/app/api/analytics/{chatters,fans,creators}/…            NEW
src/app/api/disputes/**                                     rewritten POST; verdict side-effects
src/app/api/ca-salary/import/route.ts                       DELETED once the historical import has run
src/vercel.json                                             + cron
firestore.rules · firestore.indexes.json                    + §7
tests/salary-engine/                                        + buddyxMapping, salesWrite (attribution
                                                              invariant, cutover, vanished guard),
                                                              disputeTransfer tests
documentation/buddyx.md                                     NEW spoke; ca-salary.md §4/§8/§10/§13,
                                                              notifications.md, permissions.md,
                                                              architecture-overview.md env, hub map + index
```

## 9. Sequencing

1. **Client + directory sync + mapping screen (backend only).** Ship, run, confirm all 7 active chatters and 8 models map. *Gate: nothing pays from BuddyX yet.*
2. **Historical import**, dry-run then commit: Infloww sales backfill (adds `source`/`kind`/`creatorId` to existing rows) + creator stats + fan-name seed.
3. **Sales sync** writing `ca-sales`. **Before enabling:** dry-run the window (counts per agent per day after the cutover) for an admin to eyeball against the BuddyX dashboard. Then enable the cron.
4. **Disputes v2** (search, create, verdict side-effects, un-transfer).
5. **Sales Report + CA Admin → Sales** UI. Retire the upload tab.
6. **Analytics scopes + the three pages.**
7. Delete `/api/ca-salary/import` + the historical-import route once 2 is verified. `/simplify` (rule 17), docs, and the Firestore deploy notice.

## 10. Open questions (not blocking)

- **Creator-facing analytics:** should creators see their own OnlyFans Analytics in the Telegram Mini App later? The read model already supports it; it would need a `withCreatorAuth` route scoped to their own `creatorId`.
- **Live fan conversation** in the Fan drawer (admin-only, fetched not stored, history from 2026-06-10)?
- **`revShare`** is null for all creators in BuddyX. Configure it there if the rev-share column on OnlyFans Analytics should mean something.

---

# Part 2 — UI (shape brief)

> Produced by `/impeccable shape`. **Operate** mode throughout. Every surface stays inside the established world, DESIGN.md's "Quiet Instrument", so no new visual direction: greyscale, semantic-only hue, the house widget pattern (`creator-portal/custom-requests` Overview), shadcn only, `Avatar`/`CreatorChip`/`PersonTag` for identity, charts through `ui/chart.tsx` with validated hues (the `dataviz` method). Read DESIGN.md §2/§5 before building.

### Decisions from the shape round

| Surface | Choice |
|---|---|
| Sales Report | **Breakdown first.** Charts lead, the ledger follows. |
| Filing a dispute | **Wide dialog from the dashboard's Sale Disputes column.** Disputes stay on the dashboard, per the 18 Sep consolidation. |
| Analytics pages | **Question-led sections** under a standing KPI row. |
| CA Admin → Sales | **Attention band, then the all-agents ledger.** Mapping, sync history and historical import sit in collapsed sections. |
| OnlyFans Analytics | **Roster first** (metric-roster cards, Growth Tracking pattern), and selecting a creator scopes the page. |
| Freshness / refresh | **In each page's own header**, per scope. |

### The two tooltips — where they live

Copy is exact. Each is a shadcn `Tooltip` on an `Info` icon (lucide, `size-3.5`, Ink Secondary), keyboard-focusable, and never the only carrier of meaning (DESIGN.md §5: a marker must not explain what the item cannot know).

| Copy | Placed on |
|---|---|
| "Tips are assigned to the chat agent on shift at the time of sale" | Sales Report **Tips** tile · the tips series in the legend of the daily chart · the dispute dialog's list header · the Chatter Analytics **Tips** KPI |
| "PPV sales are assigned to the sender" | Sales Report **PPV** tile · the PPV legend entry · the dispute dialog's line *"PPVs aren't listed"* · the PPV chip on any ledger row inside the dispute detail · the server's 400 message when a PPV is submitted |

### Shared: the freshness control

- A **`SyncStatus`** component, used in every BuddyX-backed page header. It reads `Synced 4 min ago` (Meta step, Ink Secondary, the exact time in a `title`) and has an icon-only refresh `Button` (`variant="ghost" size="icon-sm"`, `aria-label="Refresh from BuddyX"`).
- **States:**
  - **Idle.**
  - **Syncing:** the icon spins under `.activity-spinner`, and the figures stay readable in place, never skeletoned (the shift-calendar refresh pattern, ca-salary.md §6).
  - **Up to date:** inside the cooldown, toast *"Already up to date — synced 40s ago"*.
  - **Running elsewhere:** on a 409, *"Syncing…"* while it polls status.
  - **Failed:** the label turns `text-orange-400`, *"Sync failed 2h ago · showing data from 09:01"*, and the refresh stays enabled. Hue here is semantic, it means attention.
- **Stale is not empty.** A failed sync never blanks the page. The last stored data stays on screen with the failure stated beside it.

## A. Sales Report — Dashboard → My Salary → Sales report

**Job & audience.** A chat agent mid-month, often between chats, asks *"what am I being credited for, and is it right?"* Success is that they spot a missing tip in seconds and can act on it.

**Sequence (breakdown first):**
1. **Header:** month (owned by `?month=`, as today) · `SyncStatus`.
2. **KPI row** (house tiles, `grid-cols-2 lg:grid-cols-4`): **Tips** ⓘ (gross + count) · **PPV** ⓘ (gross + count) · **Total** · **Transfers** (net ± this month, e.g. `+$60 / −$20`, opens the transfers list).
3. **Daily chart:** stacked bars per salary day, tips and PPV as two validated categorical hues, with the legend carrying both tooltips. Click a bar → it filters the ledger to that day, reusing the existing "inspected day" mechanism, so **a month change clears it** (ca-salary.md §10).
4. **Two side-by-side cards:**
   - **By creator:** `CreatorChip` + bar-behind-the-row, keyed by `creatorId`.
   - **By type:** tip from message / post / profile, and PPV.
5. **Ledger** (existing `SalesReport` table, kept): time in the viewer's zone · `CreatorChip` · type attribute chip · fan (name, else mono ID, linked to `onlyfans.com/u{id}`) · amount.
   - Row markers in words, not hue: `Transferred in · D-…` and `Disputed`.
   - A **Transferred away** group at the foot: rows that left this month, each naming the dispute.
   - The **Infloww** / **BuddyX** source is a quiet attribute chip, shown only for a month that spans the cutover, with a one-line note at the cutover day: *"Sales before 08:50 on 4 Oct came from Infloww."*
6. **Keep** the 150-row step, `useDeferredValue`, the `queryCache` 60s TTL and the focusable scroll regions (ca-salary.md §10).

**States:**
- No sales this month → one quiet line.
- Day filter empty → names the day, with a way out.
- Failed read → error + retry, never an empty ledger (ca-salary.md §6, "A failed read is a state").
- Finalised month → a *"Finalised — figures frozen"* chip. The ledger is still live, and the existing Overview copy explains the difference.

**Anti-goals:**
- No commission maths on this tab; that lives on Overview / Daily breakdown.
- No other agent's data, ever.

## B. Disputes

### B1. New dispute dialog (from the Sale Disputes column)

- **Wide dialog** (`sm:max-w-3xl`). The filters row holds a creator `Combobox` (Popover + Command, the roster from `useCreators`, OnlyFans-mapped creators only), a **date window** of two date pickers capped at 7 days (the cap is stated beside it, not discovered as an error), and an optional **Fan ID** filter.
- **Results:** a list (not a table) of tips with a leading checkbox. Each row shows time · type chip · fan · amount · **holder** (`PersonTag`, or *Unassigned* in Ink Secondary).
  - Rows that can't be picked show why, in words: *Disputed* (already locked), *Yours*, *Finalised month*.
  - The list header carries the tips tooltip. A single foot line reads *"PPVs aren't listed"* ⓘ with *"PPV sales are assigned to the sender"*.
- **Selection persists across filter changes** (tips from two creators in one claim), and the footer shows the running selection. This is the opposite call from the admin bulk bar, and it is deliberate: here the selection *is* the claim being built, not an action on the rows in view.
- **Comment** (required, the whole basis of the decision, as today).
- **Footer preview of the auto-split**, before submitting: *"3 tips · $115 → 1 dispute to Queen (2 tips), 1 to admin (unassigned)"*.
- **Submit:** one toast naming the count. Partial server refusals (a tip locked by someone else meanwhile) are listed in the dialog and the dialog stays open with those rows marked. Nothing is lost.
- **States:**
  - Before a creator is picked: one quiet line, *"Pick a creator and a day to find tips."*
  - Window with no tips: a line naming the window.
  - Search failed: retry.

### B2. Queue, detail and ledger (existing components, extended)

- **`SaleDisputesPanel` compact row** (23rem column), v2: line 1 reads amount + `CreatorChip` (or *"3 tips · 2 creators"*), line 2 reads filer + date. The tick/cross verdict lane is unchanged.
- **`DisputeDetailDialog`, v2:** the dispute's **sales list** (each tip: time, type, fan, amount, its current state), the comment in full, and the group context (*"Filed with 1 other dispute"*).
- **On an admin approval:** the result in words, *"2 tips moved to Jenelle's sales · 1 skipped — month finalised"*. On the filer's side, the existing Decided pill copy becomes *"Approved — moved to your sales report"*. It is now literally true.
- **A legacy (v1) dispute** reads *"Legacy dispute — adjust manually"* in the detail, so nobody expects a transfer that won't happen.
- **CA Admin → Disputes:** unchanged shape (bulk bar, tabs). Rows gain the tip count and `transferResult`. **Un-transfer** sits on the resolved row's detail as a ghost destructive action, with a reason bar (the shared `RejectReasonBar` pattern), open months only.

## C. CA Admin → Sales (replaces "Sales data")

**Job.** A CA manager keeps the sales ledger trustworthy and answers "where did this agent's money come from".

1. **Header:** month (shared with Overview/Payroll, as today) · `SyncStatus` (sales scope).
2. **Attention band** (house recipe: orange tint, static dot, no motion, names its rows, **states its own empty**, *"Nothing needs a look"*). Lines:
   - unmapped chatters (name + email + sales count) → open Mapping;
   - unmapped creators;
   - unassigned tips (count + $), with *"N claimed, awaiting you"* → filter the ledger;
   - attribution conflicts;
   - rows vanished after finalisation;
   - finalised-month rows the sync refused.
3. **Ledger:** all agents for the month.
   - Filters: agent, creator, kind segmented (Tips · PPV · All), *Unassigned*, *Removed*.
   - Count line `412 sales`. Same row anatomy as A plus an agent column.
   - **Removed** rows are struck through with *"Removed {date} — no longer in BuddyX"*.
   - The kind filter carries both tooltips.
4. **Collapsed sections** (`Collapsible`, closed by default unless the band points into one):
   - **Mapping:** chatters and creators tables, each with BuddyX identity → matched Bluu identity (`PersonTag` / `CreatorChip`) → match kind (*email* / *handle* / *manual* / *unmatched*), and a **Link manually** combobox (admin claim; the change re-stamps open-month rows on the next sync, said in the toast).
   - **Sync history:** the last 20 runs with trigger, duration, counts and errors.
   - **Historical import:** admin claim only, the one-off Infloww sales + creator-stats upload with dry-run preview. It reuses today's `AdminSalesData` preview and skip report, and is removed after use.

## D. Chatter Analytics — `/ca-portal/chatter-analytics`

**Job.** Agent: *"How am I doing against the team?"* Admin: *"Who's carrying, who's slipping, and does BuddyX online time match our clock?"*

- **Header:** period segmented control (MTD · Last month · 7d · 30d · Custom) · `SyncStatus` (chatters scope).
- **KPI row (agent):** PPV revenue · Tips ⓘ · Unlock rate · Median reply time · Online time.
- **"You vs team"** (agent view, the focal section): one **benchmark strip** per metric. A horizontal track shows the team median tick and top-quartile tick, your dot, and the value with a plain-words read (*"faster than 3 of 4"*). Direction-aware: lower is better for reply time.
  - The dot is the one Action Blue mark (the current selection = you).
  - With fewer than 3 active agents: *"Not enough agents active this period to compare."* No strips.
- **Daily trend:** your PPV + tips per day, own scale.
- **Messaging:** fans chatted, messages, PPVs sent → unlocked (a funnel as two figures and a rate, not a funnel chart), mass messages (count, average price, unsent).
- **Admin view adds:**
  - a **sortable leaderboard table** (the agent column sticky; `PersonTag`; every metric column; revenue per online hour);
  - a **"BuddyX online vs clocked in"** column with the gap in words when it exceeds 15% (*"online 31h · clocked 44h"*), a fact rather than an accusation, Ink Secondary unless large;
  - an **attention band** for zero-online agents who were rostered.
- **Custom range:** medians render `—` with *"Medians need a fresh pull for custom ranges"* and a **Pull** button (admin), per §5.1.

## E. Fan Analytics — `/ca-portal/fan-analytics`

**Job.** An agent asks *"who should I be messaging?"*; an admin asks *"how healthy is each creator's fan base, and where do good fans come from?"*

- **Header:** creator scope chips (the agent's rostered creators; admin: all + pick) · period · `SyncStatus` (fans scope, daily cadence, stated).
- **KPI row:** spenders · revenue per spender · whale share (*"top 10% of spenders = 64% of revenue"*) · trial → paying conversion.
- **"Worth a message"** (focal): the **at-risk spenders** list, people who spent in the prior 60 days and nothing in 14. Each row shows fan (name or mono ID + OF link) · creator chip · lifetime spend · last purchase (*"18 days ago"*) · their usual (tips vs PPV). Ordered by lifetime spend.
  - Interrupt-band styling only on the section header count, not every row.
- **Top spenders** (period / lifetime toggle), with a tip-vs-PPV mix bar per row.
- **Spend distribution:** a histogram of spend buckets, single-hue sequential.
- **Acquisition** (admin only): per tracking/free-trial link, showing fans, revenue, revenue per fan, cost and ROI. Links with `cost: 0` show ROI as `—`, never ∞.
- **Fan drawer** (`Sheet`, the collection stays visible behind it): identity, a purchase timeline (tips/PPV, both sources, the cutover marked), subscription events, acquisition link, and *earned by* (*"you · team"* for agents; names for admin).
- **States:** a fan with no name shows the mono ID, never "Unknown". No rostered creators this month → *"You're not rostered on any creator this month"*, not an empty table.

## F. OnlyFans Analytics — `/creator-portal/onlyfans-analytics`

**Job.** Creator managers and admins ask *"where does each creator's money come from, and which acquisition spend works?"*

- **Header:** date range (presets + custom, going back to Oct 2025 via the Infloww history) · `SyncStatus` (creators scope).
- **KPI row** (range-independent standing figures, the metric-roster rule): agency earnings MTD · new subs MTD · best link by revenue per fan · creators active in BuddyX.
- **Creator roster** (focal, the Growth Tracking pattern): one card per creator with `CreatorAvatar` + name, earnings figure + delta, an **own-scale sparkline of daily earnings** (a rate, not cumulative), and a three-segment **source-mix bar** (subs / tips / messages, three validated hues). The card is the open target. Selecting it scopes the sections below, Action Blue edge on the selected card; *All creators* is the default.
- **Sections** (scoped by the selection):
  1. **Earnings by source:** stacked area by day. The cutover is marked with a vertical hairline labelled *"Infloww → BuddyX"*. Gaps are gaps, never zeros.
  2. **Subscribers:** new vs returning vs trial, by day (BuddyX era only; before it, total new subs as one series, said in the legend).
  3. **Links:** a table of tracking and free-trial links with name, kind, clicks → subs (rate), subs, revenue, revenue per fan, cost, ROI, stackers (FTL), and a row sparkline from `series`. Sorted by revenue.
  4. **Messaging on this creator:** fans chatted, PPVs sent/unlocked, mass messages (count, average price), and median reply time. The cutover is marked because the statistic changes (average → median).
  5. **Rev share:** shown only when configured. While it is null for all creators, the section is omitted, not rendered as zeros.
- **Comparison:** below the roster, a compact ranked table across creators (earnings, share, MoM).

## Cross-cutting UI constraints

- **Navigation and freshness:**
  - Sidebar entries for the three new pages get `prefetch={false}` (rule 9i).
  - Pages read through `queryCache`-style 60s caches.
  - Focus/visibility revalidation is free inside the TTL (the calendar's policy).
- **Charts:**
  - Only `ui/chart.tsx` + recharts.
  - Tips/PPV and subs/tips/messages get **validated** categorical hues from the existing `DONUT_COLORS` family, not stock `--chart-*`.
  - Every chart has a text alternative: the figures it plots are in an adjacent table or the tile row.
- **Formatting:**
  - Every amount and count is `tabular-nums`, every id `font-mono`.
  - Exact figures wherever someone reconciles; `formatUsdCompact` only in dense cells, with the exact value in `title`/`aria-label`.
  - Times in the viewer's zone (`useViewerTimezone`), bucketing in SAST.
- **Layout:**
  - Electron at ≥1024px is the target; wide tables scroll inside focusable, named regions.
  - No phone layout. These are console pages; the Mini App is out of scope (open question §10).
- **New components** (all composed from `src/components/ui`): `SyncStatus`, `BenchmarkStrip`, `SourceMixBar`, `SaleSearchList`, `FanDrawer`.
- **DESIGN.md:** add the benchmark strip as a named pattern beside the metric roster and the shaded matrix, and add the attention-band lines' new vocabulary, in the same change (rule 13).

## Open UI decisions (builder must not invent)

- Exact validated hex pairs for tips/PPV and subs/tips/messages. Run the `dataviz` validator against `--card` before choosing.
- Whether the at-risk window (14 of 60 days) should be admin-tunable. Default: a constant, stated on the section.
