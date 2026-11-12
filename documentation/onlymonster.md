# OnlyMonster

OnlyMonster is replacing BuddyX as Bluu's source of OnlyFans data. **The migration plan of record is [`onlymonster-migration.md`](../onlymonster-migration.md)**: decisions D1–D15, proposals P1–P7, invariants, phases and gates. This spoke documents **what is built**. It grows phase by phase, and each phase updates it in the same change.

**Status (2026-11-11): Phases 1–5 and 7 are built; Phase 6 waits for its precondition.** BuddyX still writes every `ca-sales` row. OnlyMonster pay rows go to `ca-sales-shadow` until the Phase 4 switches are set (`ONLYMONSTER_CUTOVER_AT` and `config.salesWriteEnabled`). The analytics surfaces read OnlyMonster only once `config.analyticsSource` is flipped. See [Switches](#switches) and [What is gated](#what-is-gated-and-on-what).

API spec: [`OnlyMonsterAPI.md`](../OnlyMonsterAPI.md) (om-api-service v0.77.0). Webhooks ([`OnlyMonsterWebhooks.md`](../OnlyMonsterWebhooks.md)) are not used (D14).

---

## Rules

1. **The API is called only through [`src/lib/onlymonster/client.ts`](../src/lib/onlymonster/client.ts), only from a sync, and GET only.** The client has no non-GET request and a path allowlist. **No chat endpoint is reachable**: reading a chat through the API marks it read on OnlyFans, exactly as if the creator had opened it. No `/proxy/` endpoint either; the statements permission those need can also create payouts. Pages read Firestore, never the API (CLAUDE.md rule 9l).
2. **Don't call the API by hand to explore.** Use the spec, the Phase 0 findings in the plan (§11), or [`scripts/onlymonster-probe.js`](../src/scripts/onlymonster-probe.js). The probe is GET-only, allowlisted, budgeted (150 calls) and hashes fan ids. The user authorised running it on 2026-11-11.
3. **Attribution is the shift schedule, never OnlyMonster.** OnlyMonster's `/users/metrics` revenue is display-only and admin-only (D13). Members feed activity analytics, never pay.
4. **Accounts map only to Bluu accounts on OnlyFans.** See [Identity mapping](#identity-mapping).

## Shape

```
 Vercel Cron 05:01 / 13:01 / 21:01 UTC ──► /api/cron/onlymonster-sync ──► runOnlyMonsterSync()
                                           lease (onlymonster-meta/lock, 6 min)
                                           stages in order (Phase 1: directory)
                                           run log (onlymonster-sync-runs, TTL 90 d) → incident alert
                                             │
                               src/lib/onlymonster/client.ts  (GET only, allowlisted, token buckets)
```

| File | Role |
|---|---|
| `lib/onlymonster/client.ts` | `server-only`. `omGet`, `omPaginateCursor` (the cursor field is `nextCursor` on `/accounts` and `cursor` on `/transactions` / `/chargebacks`), `omPaginateOffset` (`/members` ≤ 50, `/users/metrics` ≤ 100). `x-om-auth-token`. 429 → `Retry-After` (×3), 5xx/network (×2). Counts requests. |
| `lib/onlymonster/rateLimit.ts` | Token bucket at 25/s, plus one per endpoint shape at 15/s (`mass-messages` 5/s). |
| `lib/onlymonster/errors.ts` | `OnlyMonsterError`. **Fatal** (alerts and stops the run): key missing, 401, 403 `API_KEY_PERMISSION_DENIED` (the alert names the permission). |
| `lib/onlymonster/types.ts` | Wire types. `normaliseId` makes every id a string. A Fansly `platform_account_id` exceeds 2^53, so never pass it through `Number()`. |
| `lib/onlymonster/classify.ts` | Pure. `type` → `subscription · renewal · tip · message · post · stream · other`; exact match only, unknown → `other`. `payKindOf`: only `tip` and `message` can reach pay (D3). `statusClassOf`: `done` settled, `loading` held (the ~7-day payout hold), `pending_return`, else `unknown`. `netOf`: `round2(gross × 0.8)` **per transaction** (V3). |
| `lib/onlymonster/mapping.ts` | Pure identity resolution (below). |
| `lib/onlymonster/constants.ts` | Stages, schedule, lease, budget, collection names. Client-safe. |
| `services/onlymonsterMappingService.ts` | The `directory` stage and manual links. |
| `services/onlymonsterSyncService.ts` | Orchestrator, freshness, run log, incident. |

## Stages

| Stage | Phase | What it does |
|---|---|---|
| `directory` | 1 | `/accounts?withExpiredSubscriptions=true` + `/members` → `onlymonster-accounts`, `onlymonster-members`. 2–3 calls. |
| `transactions` | 2 | `/transactions` + `/chargebacks` per mapped OnlyFans account over the **whole payroll window** → `of-transaction-days`, `of-chargebacks`. Vanishing only on a complete window; chargebacks attach on a unique match. |
| `subscriptions` | 2 | `/subscriptions`, same window → `of-subscription-days` (includes free trials). |
| `massMessages` | 2 | `/mass-messages`, back 7 days (the backfill walks all history) → `of-mass-messages`. |
| `metrics` | 2/5 | `/users/metrics` for today + yesterday: team (`chatter-days`) and per account-day (`account-activity-days`). From 2026-11-01 only. |
| `rollups` | 2/5 | Firestore only. `account-days` for every touched account-day, recomputed from scratch; `creator-fans` for touched months (digest in `creator-fan-months`). |
| `derive` | 3/4 | Firestore only. The pay derivation (`payPlan.ts`) → `ca-sales-shadow`, or `ca-sales` after the cutover with writes on. |
| `reconcile` | 2 | 21:01 run only. `/overview-metrics` net + gross per account per open month, Harare bounds → `account-reconciliation`. |
| `balances` | 7 | 21:01 run only, and only with `ONLYMONSTER_STATEMENTS_KEY`. Read-only payout balances → `account-balances`. |

Each stage is in `ONLYMONSTER_STAGES` with a branch in `runStage`, an exhaustive switch, so a stage with no runner fails to compile.

**Time budget and continuation (D21).** 240 s. A stage that runs out of budget throws `BudgetExceeded`. It and the stages after it (always including `rollups`) are saved as `onlymonster-meta/state.pendingStages`, **together with the touched account-days (`pendingTouched`)**. Without those, the continuation's rollup would have nothing to recompute, and later runs would find the buckets unchanged and never touch them again. `/api/cron/onlymonster-continue` runs every ten minutes: it resumes pending stages, then advances the **backfill**, and when there is nothing to do it costs one `getAll` of two docs and returns `idle`.

**Backfill (D9).** An ordered job list stored in `onlymonster-meta/backfill` (`jobs`, `next`, `done`), built once after the first successful directory run: each mapped account's ledger + subscriptions month by month from 2025-10-04 to the payroll window, its whole mass-message history, and activity days from 2026-11-01. It writes the account ledger and rollups only, never `ca-sales`.
- **Resumable per job:** each job is followed by its rollup and by saving `next`, and no job starts in the last 60 s of the budget, so a tick is never killed before it saves.
- **Failing jobs:** a job that fails is retried on the next tick and skipped after three attempts (`failures`, `skipped`). These are warnings, never an alert.
- **New accounts:** each scheduled run appends jobs for accounts mapped since the list was built.
- **Progress** shows on CA Admin → Sales → OnlyMonster mapping, to the admin claim (it sits beside the per-creator revenue reconciliation).

**Not configured is not failing.** Until `ONLYMONSTER_API_KEY` is set, a run returns `skipped: not-configured`, writes nothing and alerts nobody.

## Identity mapping

**Account → creator or sub-account** ([`mapping.ts`](../src/lib/onlymonster/mapping.ts)). The decisions are from 2026-11-11.

- **By handle (`OFID`, folded), against Bluu accounts with `platform: 'onlyfans'` only.** A creator's handle is often the same on every platform: Noah Ryder's Fansly sub-account carries `@itsnoahryder` too. Without the filter, his OnlyFans account matched two Bluu accounts and therefore mapped to nobody. The `platform` field is set on [creators and sub-accounts](ca-salary.md#sub-accounts-are-peers-and-cost-the-engine-nothing). A Bluu account with **no** platform is never a candidate, because that would be a guess.
- A handle two OnlyFans accounts claim maps to nobody. An admin's manual link wins and survives every sync (admin claim), and its target must be an OnlyFans Bluu account.
- **OnlyMonster accounts with no Bluu match are ignored for now.** Their doc is written with `match: 'none'`, so a later link works. No alert, no attention entry, and later stages skip them.
- Fansly accounts are recorded (`platform: 'fansly'`) and never matched or synced.
- The numeric `platformAccountId` is stored on every account doc; later stages key on it.

**Member → user** by email, with the login fold (`normalizeEmail`). An address two users share maps to nobody, and a manual link wins.

**Suspect empties.** An empty `/accounts` or `/members` list while stored docs exist keeps the stored mapping and records a run warning. The Phase 0 probe once got 0 members, then 9.

A doc OnlyMonster stops listing is kept with `listed: false`.

**UI:** CA Admin → Sales → **OnlyMonster mapping** ([`OnlyMonsterMappingSection`](../src/components/ca-admin/OnlyMonsterMappingSection.tsx), served by `GET/PATCH /api/admin/onlymonster/mapping`; GET needs `ca-admin`, PATCH the admin claim). It shows the passive [`DataFreshness`](../src/components/onlymonster/DataFreshness.tsx) label: *"Updated 13:01 · next 21:01"*, with **no refresh button** (D10).

The delete cascade clears manual member links to a deleted user (`clearManualMemberLinksForUser`, rule 6).

## Collections

All Admin SDK only (`allow read, write: if false`, `firestore.rules` §31a).

| Collection | Doc id | Notes |
|---|---|---|
| `onlymonster-meta` | `state`, `lock` | `state.stages.{stage}.{lastSuccessAt,lastAttemptAt,lastError}`, `runFailures`, `lastRunOk`. `lock` is the lease. |
| `onlymonster-sync-runs` | auto | One per run. `expireAt` is a **TTL** field (90 days), declared in `firestore.indexes.json`. `errors`, `warnings`, `counts` and `stages` are index-exempt. |
| `onlymonster-accounts` | OnlyMonster account id | `OnlyMonsterAccountDocument`. Names and labels are index-exempt. |
| `onlymonster-members` | OnlyMonster member id | `OnlyMonsterMemberDocument`. `manualUid` stays indexed (the delete cascade queries it). |
| `of-transaction-days` | `{platformAccountId}_{day}` | The account ledger (`txs` index-exempt). |
| `of-chargebacks` | chargeback id | `matchState`, `matchedTxId`; indexes `(platformAccountId, chargebackAt)`, `(creatorId, day)`. |
| `of-subscription-days` | `{platformAccountId}_{day}` | `subs` index-exempt. |
| `of-mass-messages` | mass message id | Index `(creatorId, day)`. |
| `account-activity-days` | `{platformAccountId}_{day}` | Per-account activity. |
| `chatter-days` | day | Per-member activity (`rows`) or BuddyX history (`breakdown`), both index-exempt. **Never pay.** |
| `account-days` | `{creatorId}_{day}` | The OnlyFans Analytics rollup; index `(creatorId, day)`. |
| `account-reconciliation` | `{creatorId}_{month}` | `om` vs `ledger`, `diff`. |
| `ca-sales-shadow` | `om-*` | Shadow pay rows; TTL `expireAt` 60 days. |
| `creator-fans`, `creator-fan-months` | `{creatorId}_{fanId}`, `{creatorId}_{month}` | Fan rollup and its per-month digest. |
| `fans` | fan key | The registry's new home (empty until the move). |
| `account-balances` | creatorId | Read-only payout balances (Phase 7). |

Deploy: `firebase deploy --only firestore:rules,firestore:indexes`.

## The account ledger (D20)

`of-transaction-days/{platformAccountId}_{day}` holds every transaction of one account on one Africa/Harare day as `txs[txId] = { t, fan, type, cat, status, gross, net, removedAt?, chargedBackAt?, chargebackId? }` ([`ledger.ts`](../src/lib/onlymonster/ledger.ts)). Bucketing by day keeps a run at ~400 doc reads instead of ~15k, and the bucket is exactly what the rollup, the pay derivation and chargeback matching read.

- **Vanishing is never trusted on a suspicious answer.** An empty `/transactions` list while live rows are stored, or more than half of an account's live rows (and more than 5) disappearing in one run, holds all vanishing for that account and run, and records a warning (`transactions.vanishHeld`). The same applies to an empty `/chargebacks` list. Vanishing removes pay rows.
- **Verified against live data (2026-11-11):** two accounts and 18 days, gross and net, every day matched OnlyMonster's own `/overview-metrics` **to the cent**.
- `account-days/{creatorId}_{day}` is shaped like `creator-stats-days` (plus net, posts, streams, other, holds, chargebacks, returning and trial subscribers), so OnlyFans Analytics swaps collections, not logic.
- **History stitching:** a creator's days before its OnlyMonster `firstTxDay`, and every Bluu account OnlyMonster does not cover, keep their archived `creator-stats-days` rows with their own source label ([`onlymonsterAnalyticsSource.ts`](../src/lib/services/onlymonsterAnalyticsSource.ts)).

## Pay (`payPlan.ts`, D2, D3, D8, D16, D17)

The pure planner [`payPlan.ts`](../src/lib/onlymonster/payPlan.ts), with its I/O in [`onlymonsterPayService.ts`](../src/lib/services/onlymonsterPayService.ts), keeps every BuddyX invariant: id by transaction (`om-{platformAccountId}_{txId}`), a transfer is never cleared, finalised months are frozen, and only changed rows are written.

- **Strict attribution:** exactly one agent scheduled on the account at the instant (half-open intervals, no grace). Otherwise the row is unassigned as `unscheduled`, `overlap` (with `scheduledUids`) or `departed`. Occurrences are clamped at their agent's departure.
- **Tips and PPV only.** `done` and `loading` count; `pending_return` counts and is flagged.
- **Chargebacks:** OnlyFans deletes the original, so a vanished transaction's row is **soft-removed**, and that removal is the deduction. A chargeback whose original predates the derivation's window is fact-matched to its `bx-*` / Infloww row **whatever its ledger match**, since the ledger usually never saw the original. A negative `om-cb-{id}` row lands on the chargeback day only where the original cannot be removed: in a month finalised for its holder (`vanishedAfterFinalise`), or when the original is a pre-cutover `bx-*` / Infloww row. Those are matched by facts: Infloww on the exact instant, `bx-*` within 120 s before it. A unique match is required.
- **Where it writes:** see [Switches](#switches).

The ledger UI (CA Admin → Sales, Sales Report) labels `om-*` rows **OnlyMonster** and leaves *Source credits* empty. [`SaleHolderNote`](../src/components/salary/SaleHolderNote.tsx) says *Nobody on shift* / *Overlapping shifts* (naming the candidates) / *Agent had left* / *Pending return*. The attention band lists each.

**Cutover (§5.7).** `salesSourceFor` has three sides; `ONLYMONSTER_CUTOVER_AT` is 2026-11-06 01:00 SAST (D25). BuddyX's vanished pass never removes a row after the cutover (`planSalesSync({ ownedUntil })`). Disputes accept anything after the Infloww cutover.

## Analytics

All three switch on `config.analyticsSource`, read per request with a 30 s cache:

- **OnlyFans Analytics:** earnings from `account-days` (stitched), subscribers from `of-subscription-days`, mass messages from `of-mass-messages`. Links stay on `buddyx-links` until the fan-registry move.
- **Chatter Analytics:** activity from `chatter-days`. **Revenue always comes from the `ca-sales` ledger.** Online time is null (D12), and reply time is an average, never a median. 27 Sep – 31 Oct 2026 come from BuddyX's days, copied into `chatter-days` as `buddyx-historical` (D24, `scripts/onlymonster-carry-buddyx-activity.js`, run 2026-11-11: 35 days).
- **The sales board never shows OnlyMonster's per-member revenue** (rule 9k): those rows are dropped from its unlinked list.
- **D13 cross-check:** the admin-only report shows *"OnlyMonster attributes $X"* under Sales, with *(check the schedule)* past 15% and $50. It is never pay.
- **Fan Analytics:** `creator-fans` (every category; `spendByMonth[month].{tips,ppv,subs,other,…}`) instead of `buddyx-fans`. Display-name write-through updates both while both exist.

## Switches

| Switch | Where | Effect |
|---|---|---|
| `config.analyticsSource` | CA Admin → Sales → OnlyMonster mapping (admin claim) | `buddyx` / `onlymonster` for OnlyFans, Chatter and Fan Analytics. Reversible, no deploy. |
| `ONLYMONSTER_CUTOVER_AT` | `salaryConstants.ts` (deploy) | **2026-11-06 01:00 SAST** (D25). BuddyX owns sales at or before it, OnlyMonster after. `Infinity` would hand everything back to BuddyX (rollback). |
| `config.salesWriteEnabled` | `PATCH /api/admin/onlymonster/config` (admin claim) | Off → `ca-sales-shadow` only. On (refused while the cutover is unset) → `ca-sales/om-*`. |
| `FAN_REGISTRY` | `fanRegistryService.ts` (deploy) | `buddyx-fan-names` → `fans`, after `scripts/migrate-fan-registry.js --copy` / `--verify`, then `--delta`. |

## Admin views (CA Admin → Sales)

- **OnlyMonster mapping:** mapping, freshness, the backfill's progress, the reconciliation per account-month (✓, or the difference), the analytics source switch, and payout balances (admin claim).
- **Shadow reconciliation:** paid vs OnlyFans per account-day; agent-days; the strict rule's impact per agent; unassigned totals by reason; chargebacks; accounts BuddyX pays that OnlyMonster doesn't cover; and, once the cutover is set, the boundary check (rows on the wrong side must be zero).

## Scripts

| Script | Purpose |
|---|---|
| `onlymonster-probe.js` | GET-only probe (Phase 0, V-items). `--history-only`, `--coverage`, `--compare-bluu`. |
| `archive-collection.js` | Export / verify / confirmed delete; `--backup <label>` for the pay collections. |
| `backfill-account-platform.js` | The 2026-11-11 `platform` backfill (done: 18 docs). |
| `onlymonster-carry-buddyx-activity.js` | D24 (done: 35 days). |
| `migrate-fan-registry.js` | `buddyx-fan-names` → `fans`. |
| `onlymonster-rollback.js` | Phase 4 rollback: soft-remove `om-*` rows, replay pay decisions onto `bx-*` on a unique match only. |

## What is gated, and on what

| Step | Waits for |
|---|---|
| Phase 1 gate | Deploy and the key; three clean scheduled runs. |
| Phase 2 sign-off → flip `analyticsSource` | The backfill completes, and 7 days of the nightly reconciliation are clean or explained. |
| Phase 4: switch `salesWriteEnabled` on (the cutover is set, D25) | A review of 6 Nov onward in the Shadow reconciliation after the first deployed runs, and a fresh invariant-6 backup. V4 id stability (snapshot compare ≥ 2026-11-17) is still checked afterwards. |
| `FAN_REGISTRY` → `fans` | Phase 5, after the analytics switch has run cleanly. |
| Phase 6: delete BuddyX code, cron, key, rules; archive `buddyx-*` | **The month containing the cutover is finalised for every agent** (the BuddyX sync still re-derives `bx-*` rows until then). Delete each collection only on the user's go-ahead. |
| Remove BuddyX refresh buttons / `SyncStatus`, online time, the `never-online` flag | Phase 6 with the rest of BuddyX: they serve BuddyX data until then. |
| Phase 7 sending (mass messages, campaigns) | Not built. It needs a separate key and separate approval (§12). |

## Alerting

`notifications.onlymonsterSyncFailing(reason)` goes to `OPS_ALERT_RECIPIENT_UID`, once per incident (latch `onlymonster-sync-failing`, cleared on the next healthy run). It fires on a rejected key, a missing key permission, or three failed runs in a row. It never fires while the key is unset. Catalogued in `automatedNotifications.ts`.

## Environment

`ONLYMONSTER_API_KEY`: the core key, **read-only permissions**: `accounts.view`, `dashboard.view`, `team_metrics.view`, `traffic_metrics.view`, `mass_messages.view`. Set it in Vercel (Production).

`ONLYMONSTER_STATEMENTS_KEY` (optional, Phase 7): a **separate** key with `onlyfans.statements`, read only by [`statementsClient.ts`](../src/lib/onlymonster/statementsClient.ts), which is GET-only on the balances and payout-request listing paths. That permission can also create payouts, which is why it never shares a key or a module with the core client.

## What the Phase 0 probe established

Full answers are in plan §11. The facts later phases rely on:

- Transaction `start` and `end` are **both inclusive**. Timestamps are whole seconds. Lists are newest first.
- **Net is per transaction** and matched `/overview-metrics` to the cent.
- `loading` is the payout hold and becomes `done`.
- **A charged-back original disappears from `/transactions`.** `/overview-metrics` is net of chargebacks too. A chargeback's `transaction_timestamp` equals the original's OnlyFans timestamp exactly. Every chargeback's status is `undo`, which is the normal state, not a reversal.
- **BuddyX stamps a sale 18–55 s earlier than OnlyFans**, and keeps charged-back sales live.
- `/users/metrics` `creator_ids` takes the OnlyMonster account id. Its `total_*` fields repeat the filter-wide total on every row, so never sum them. Member activity exists from **2026-11-01** only.
- Transaction history reaches each account's first sale (back to Sep 2025 on the oldest accounts).
