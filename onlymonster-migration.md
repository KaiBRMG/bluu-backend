# BuddyX → OnlyMonster migration plan

**Status (2026-11-13):** Phases 1–5 and 7 built; Phase 6 code removal done; `salesWriteEnabled` switched on 2026-11-13 (Phase 4 live). See each phase's status and [`documentation/onlymonster.md`](documentation/onlymonster.md).
**Scope:** OnlyFans only. Fansly is out of scope for every phase.
**Sources:** [`OnlyMonsterAPI.md`](OnlyMonsterAPI.md) (om-api-service v0.77.0), [`OnlyMonsterWebhooks.md`](OnlyMonsterWebhooks.md), [`documentation/buddyx.md`](documentation/buddyx.md), [`documentation/ca-salary.md`](documentation/ca-salary.md), [`documentation/fan-base.md`](documentation/fan-base.md), and the code under `src/lib/buddyx/`, `src/lib/services/buddyx*`, `src/lib/salary/`.

This touches real people's salaries. Every rule below that reaches pay is either a decision recorded in §1 or a verification item in §11 that must be closed before the code it governs ships. Nothing is assumed.

---

## 0. Summary

OnlyMonster replaces BuddyX as the source of OnlyFans data. The rewrite has four outcomes:

1. **One account ledger of every OnlyFans transaction.** It covers subscriptions, renewals, tips, PPV, paid posts and streams, pulled from `/transactions` and backfilled to October 2025. OnlyFans Analytics is rebuilt on it and reconciled nightly against OnlyMonster's own account totals, so account revenue matches OnlyFans.
2. **A pay ledger (`ca-sales`) that holds only chatter revenue: tips and PPV messages.** Each row is derived from the account ledger and **credited to the agent the shift schedule had on that account at that instant**. OnlyMonster's API has no per-sale chatter attribution (§3), so Bluu's schedule is the attribution, with a strict rule: exactly one agent on shift gets the sale, and anything else is unassigned and flagged. Disputes, admin reassignment, the finalised-month guard and every existing pay invariant are kept unchanged.
3. **Server-side syncs only.** Three scheduled runs a day re-verify every open month. Clients read only Firestore. Every manual refresh button and live-pull route is removed.
4. **BuddyX fully removed** after the month containing the cutover is finalised: code, cron, key, rules, indexes and docs. Its data is kept. Existing `ca-sales` rows are never rewritten or deleted. The live fan registry is migrated to a neutral collection. BuddyX analytics collections are exported to Cloud Storage, verified, and deleted only on explicit approval.

Online time is removed entirely, including the `never-online` integrity flag and the BuddyX lane on the shift timeline. Webhooks are not used.

---

## 1. Decisions (recorded 2026-11-06)

| # | Decision | Answer |
|---|---|---|
| D1 | Who a sale is credited to | **Bluu's shift schedule.** OnlyMonster exposes no per-sale attribution (§3.1). |
| D2 | Shift rule edge cases | **Strict.** Exactly one agent scheduled on the sale's account at its instant gets it. With zero or several, the sale is **unassigned** and flagged for an admin; agents can still dispute it. No grace window. |
| D3 | What goes into the pay ledger | **Tips + PPV messages only.** Paid posts and live streams are account revenue, never commission. |
| D4 | What goes into the account ledger | **Every transaction type.** |
| D5 | Account revenue source | Derived from the account ledger, reconciled against `/overview-metrics`. |
| D6 | Cutover | **An instant mid-month**, set once the shadow reconciliation (Phase 3) is clean. Sales at or before it stay BuddyX's and later ones become OnlyMonster's. Existing rows are never re-sourced. |
| D7 | Chargebacks | **A negative row on the chargeback's own day**, credited to whoever holds the original sale. Finalised months are never restated. |
| D8 | Departed agents | **Guard kept.** Nobody is credited at or after `offboardedAt`, and their leftover shifts stop counting. |
| D9 | Account-ledger backfill | **To Oct 2025**, the start of the history OnlyFans Analytics already shows. Old stats documents are kept as an archive. |
| D10 | Freshness | **3× daily** (05:01 / 13:01 / 21:01 UTC, the BuddyX cadence). Each run re-verifies every open month. |
| D11 | Old BuddyX collections | Fan registry **migrated** to `fans`. Every other `buddyx-*` collection is **exported to Storage, verified, then deleted on explicit approval**. |
| D12 | Online time | **Removed**, with `never-online` and the BuddyX-by-hour lane. |
| D13 | OnlyMonster per-agent revenue from `/users/metrics` | **Admin-only, display-only cross-check** on Chatter Analytics. Never used for pay. |
| D14 | Webhooks | Not used. |
| D15 | Secondary features in scope | **Payout balances (read-only)** and **campaign messaging** (listing and stats first, sending later). |

**Decided 2026-11-11 (second round).** The user confirmed P1 and chose P6 and P7. P2–P5 were left to Claude's judgement ("use your logic elsewhere") and are decided as proposed.

| # | Decision | Answer |
|---|---|---|
| D16 (P1) | Statuses that count toward commission | **`done` and `loading` count. `pending_return` counts and is flagged** on the ledger. Anything else is unknown and flagged. |
| D17 (P6) | Chargebacks, given that OnlyFans deletes the original | **The original sale is removed** (soft-removed when its transaction vanishes from `/transactions`). Where that is impossible, the chargeback lands as a negative row on its own day: inside a month finalised for the holder (`vanishedAfterFinalise`), and for pre-cutover `bx-*` and Infloww originals, which invariant 1 forbids modifying. **This supersedes D7 for open months.** |
| D18 (P7) | Cutover boundary | **No dedupe.** T is a quiet 00:00 SAST; the Phase 4 boundary check finds any double count, which is fixed by hand. |
| D19 | The four charged-back Infloww sales (2026-10-02) | **Write chargeback rows, through the finalised guard.** Result: **refused.** October 2026 is finalised for both holders (Queen; the admin-reassigned holder of the $100 tip). Nothing was written. A correction can only go forward as an admin override. |
| D20 (P2) | Two ledgers | **Yes**: the account ledger plus `ca-sales`. The account ledger is **bucketed per account-day** (`of-transaction-days/{platformAccountId}_{day}`, one doc holding that day's transactions), not one doc per transaction. A run re-verifies about two months × 9 accounts, which is ~400 doc reads instead of ~15k, and the day doc is exactly what the rollup, the pay derivation and chargeback matching read. Fan-level queries come from the `creator-fans` rollup, never a transaction scan. Supersedes §6.1's per-transaction layout. |
| D21 (P3) | Continuation cron | **Yes**, `*/10`. One doc read when idle. |
| D22 (P4) | Cross-check threshold | **15% and $50**, display only. OnlyMonster attributes only ~74% of PPV, so the badge reads "OnlyMonster attributes $X" and never "differs". |
| D23 (P5) | Cutover instant | **A 00:00 SAST boundary**, consistent with D18. |
| D25 | **Cutover instant** (supersedes D23) | **2026-11-06 01:00 SAST** (`2026-11-05T23:00:00Z`), set by the user on 2026-11-11. It is in the past: BuddyX's last sale is 2026-11-05 21:09 SAST, and no `bx-*` row exists after the instant (checked 2026-11-11), so nothing is owned twice. Agents' tips and PPV from 6 Nov have been missing from pay since then; OnlyMonster's rows fill them once `salesWriteEnabled` is on. The Phase 3 shadow gate is shortened to a review of those days in the Shadow reconciliation before the switch. |
| D24 | Chatter Analytics activity, 27 Sep – 31 Oct 2026 | Claude's call: **keep BuddyX's activity days**, copied into `chatter-days` labelled "BuddyX (historical)" before `buddyx-team-days` is archived. Deleting them would blank five weeks for no gain. |

**Proposed by the plan (superseded by the table above, kept for the record):**

| # | Proposal | Needed by |
|---|---|---|
| P1 | **Which transaction statuses count toward commission.** Proposed: `done` and `loading` count; `pending_return` counts but is flagged. This is a **pay policy**, informed by V4. Probe run 1 found every row from two days earlier still `loading`, so excluding `loading` would drop roughly the latest week from pay. | Phase 4 |
| P2 | **Two ledgers:** `of-transactions` (every type) and `ca-sales` (tips and PPV, linked), rather than one collection (§4). | Phase 2 |
| P3 | **A `*/10` continuation cron** beside the 3× daily runs. It only resumes an interrupted run or the backfill and does nothing otherwise, so freshness stays 3× daily (D10). Not registered in Phase 1, which has nothing to resume. | Phase 2 |
| P6 | **Chargebacks follow D7 even though OnlyFans removes the original (V5).** When an original vanishes from `/transactions` and exactly one chargeback matches it, the original **keeps counting** (marked `chargedBackAt`) and the chargeback row deducts on its own day. Only a vanish with no matching chargeback is soft-removed. Without this, an open-month original would be removed on its own day, moving the deduction there and re-tiering every day between through the commission ratchet. §5.5 is written this way. | Phase 3 |
| P7 | **Cutover boundary dedupe.** BuddyX stamps a sale up to ~1 min earlier than OnlyFans (V14), so a sale just after the cutover instant can land on both sides. Proposed: for transactions in `(T, T + 5 min]`, the OnlyMonster writer skips any that uniquely fact-match a `bx-*` row (kind, creator, fan, gross, BuddyX instant within 120 s before), and lists them in the boundary check. Also choose T in the quietest hour. | Phase 4 |
| P4 | **Cross-check threshold:** flag when OnlyMonster's figure and the ledger differ by more than 15% and $50 (D13, display only). | Phase 5 |
| P5 | **The cutover instant is a 00:00 SAST boundary** (still mid-month, per D6), so no salary day is split across sources. | Phase 4 |

---

## 2. Data-safety invariants

These hold across every phase. Each one names the step that enforces it.

1. **No `ca-sales` row is ever hard-deleted, re-keyed or re-sourced by this migration.** BuddyX (`bx-*`) and Infloww rows stay exactly as they are: transfers, `assignmentLog`, dispute locks, `buddyxUserId` and every other field. New rows get new ids (`om-*`). *Enforced by:* the OnlyMonster writer only ever touches ids it minted; there is a unit test for this.
2. **One owner per instant.** `salesSourceFor(ms)` gains a third side: Infloww `≤ SALES_CUTOVER_AT` < BuddyX `≤ ONLYMONSTER_CUTOVER_AT` < OnlyMonster. Both writers keep only their own side, so nothing counts twice and nothing falls into a gap. *Enforced by:* a predicate test, plus a Phase 4 check that the cutover day's account-day total equals BuddyX's part plus OnlyMonster's part.
3. **Every pay invariant carries over unchanged**, ported from `planSalesSync`:
   - A sale's document is found by its source id, never by its holder, and its id never changes.
   - A sync never clears a transfer.
   - A change that touches a month finalised for the stored or the new holder is refused and counted.
   - A row is soft-removed (`removedAt`) only when every endpoint involved paginated to completion, and never inside a finalised month.
   - Only changed fields are written (`syncHash`).
4. **Writes to pay are behind a Firestore switch.** `onlymonster-meta/config.salesWriteEnabled` is off by default and is a document, not a constant (rule 9c). While it is off, the pay derivation writes only to the shadow collection.
5. **Export before delete.** Every collection that leaves Firestore is first exported to Cloud Storage as gzipped NDJSON, with a manifest of the doc count and per-doc hashes. The export is re-read and verified against the live collection. Deletion uses `bulkWriter()` and runs only after the user's explicit go-ahead, separately per collection.
6. **A full backup before each irreversible step.** Before the pay cutover (Phase 4) and before decommissioning (Phase 6), take an export of `ca-sales`, `disputes`, `ca-salary-*`, `shifts` and `leave_requests`, using the same script as invariant 5 because `gcloud` is not installed on these machines. Enable Firestore point-in-time recovery if it is not already on.
7. **Rules and index changes are announced, with deploy commands** (rule 1), in the phase that makes them.
8. **No guessing on money.** A chargeback that doesn't match exactly one sale is flagged, not attached. A sale with no single agent on shift is unassigned, not distributed. An OnlyMonster transaction with an unknown `type` lands in the account ledger as `other`, is counted, and is surfaced. It is never filed as a tip or a PPV.

---

## 3. What the OnlyMonster API does and doesn't give us

### 3.1 There is no per-sale chatter attribution

- `/transactions` returns `id, amount (gross, nullable), fan.id, type, status, timestamp`. **There is no chatter field.**
- `/users/metrics` returns **totals per member over a window**: `sold_messages_price_sum`, `tips_amount_sum`, `sold_posts_price_sum`, `chargedback_*`, activity counts, `work_time` and `break_time`. There is no transaction id. The user confirmed this from a real payload. OnlyMonster's "last active chatter" setting is not visible per sale.
- Chat messages carry `sender.user_id`, but **reading a chat on OnlyFans marks it read**, the same as the creator opening it. It is also limited to 1 request/s per account and only "best-effort, recent only". **A sync must never read chats.** This is written into the new cross-cutting rule (§14).

So the attribution is ours (D1), and OnlyMonster's per-agent totals are used only as a cross-check (D13).

### 3.2 Other constraints the design accounts for

| Constraint | Consequence |
|---|---|
| Chargebacks carry **no original transaction id**, only `fan.id`, `type`, `amount`, `chargeback_timestamp` and `transaction_timestamp`. | Match on those facts; attach only on a unique match (§5.5). |
| Transaction `type` and `status` are **free strings**: `Tip from`, `Payment for message`, `Post purchase`, `Subscription`, `Recurring subscription`, `Live stream`, `Unknown`; statuses `done`, `loading`, `pending_return`. | A classifier with an explicit `other` bucket. Exact strings to be confirmed in Phase 0 (V1, V4). |
| Rate limits: 25 req/s per token, 15 req/s per endpoint by default, 1 req/s per account on `/proxy/*` and the chat endpoints. | Every endpoint we use for core data allows ≥ 15 req/s and is not per-account limited, so a full re-verification of open months costs a few hundred calls per run. Requests stay sequential through one token-bucket limiter. |
| Write endpoints (mass messages, Priority Mass Messages, Auto Messages, payouts, link creation) are **real, non-idempotent actions**, and `unsend` reaches campaigns humans built. | The core API key holds read-only permissions. The core client has **no non-GET method at all**. Writes arrive only in Phase 7, behind a separate key and explicit admin actions (§12). |
| `onlyfans.statements` grants **both** reading balances and **creating payouts**. | Payout reads use a separate key held only by the payout-read code path. The client exposes only GET for it. Creating payouts is permanently out of scope. |
| Reply time is `reply_time_avg`, an **average**. BuddyX gave a median. | Relabel it everywhere. Never compare it with BuddyX-era medians on one axis. |

---

## 4. Target architecture

```
 Vercel Cron 05:01 / 13:01 / 21:01 UTC ──► runOnlyMonsterSync()   lease: onlymonster-meta/lock
 Vercel Cron */10 (continuation) ───────► no-op (1 doc read) unless a run or backfill is unfinished
                                        │
            src/lib/onlymonster/client.ts  ← the ONLY file that calls omapi.onlymonster.ai (GET only)
                                        │
   ┌─ directory ─────────► onlymonster-accounts, onlymonster-members      (identity mapping)
   ├─ transactions ──────► of-transactions          (ACCOUNT LEDGER: every type)
   ├─ chargebacks ───────► of-chargebacks
   ├─ subscriptions ─────► of-subscriptions         (new/returning/trial — includes free trials)
   ├─ links ─────────────► of-links, link fans → fans registry names, acquisition
   ├─ mass messages ─────► of-mass-messages         (read-only stats)
   ├─ activity metrics ──► chatter-days, chatter-periods, account-activity-days   (/users/metrics)
   │
   ├─ derive (pure, no API) ─► ca-sales  om-*  (tips + PPV, shift-attributed)   ← PAY LEDGER
   │                         └ ca-sales-shadow  (same rows, while salesWriteEnabled is off)
   ├─ rollups (pure) ────► account-days, creator-fans
   └─ reconcile (21:01) ─► account-reconciliation   (/overview-metrics vs account-days)
                                        │
   salary engine (unchanged)   analytics routes (Firestore only — never the API)
```

**Why Vercel Cron and not `functions/`:** CLAUDE.md requires scheduled work that uses `src/lib` services, or sends a notification, to live in Vercel Cron. Cloud Functions can't import `server-only` modules. The continuation cron covers the 300 s function limit. A run that exhausts its time budget leaves a cursor, and the next `*/10` tick resumes it, so freshness never waits eight hours on an interrupted run. When nothing is pending, each tick costs one Firestore read.

**Why two ledgers.** The pay path reads a whole month of `ca-sales` per request (engine, ledger, reports). Adding every subscription renewal would multiply those reads for rows that never affect pay. The account ledger holds everything; `ca-sales` holds tips and PPV, each linked to its transaction. Both are written by the same run from the same pull, so account and chatter revenue can't disagree about a sale.

### 4.1 The sync run

Each scheduled run executes these stages in order. Each stage is idempotent and resumable from `onlymonster-meta/cursors`, and each records `lastSuccessAt / lastAttemptAt / lastError` in `onlymonster-meta/state`:

| # | Stage | Window | Calls (est.) |
|---|---|---|---|
| 1 | `directory`: `/accounts` (with `withExpiredSubscriptions`), `/members` | all | 2–4 |
| 2 | `transactions` per mapped OnlyFans account | oldest open payroll month (`resolvePayrollMonth`) → now. The **whole window every run**, which is what makes vanished-row detection and late status changes correct. | accounts × pages (limit 1000) |
| 3 | `chargebacks` per account | same window, by `chargeback_timestamp` | accounts × 1–2 |
| 4 | `subscriptions` per account | cursor − 3 days overlap | accounts × pages |
| 5 | `links`: tracking and trial lists plus link users | lists in full; users incremental on `collected_from` | accounts × 2 + users |
| 6 | `mass-messages` per account | cursor on `created_at`, dedupe by `id` | accounts × 1–2 |
| 7 | `metrics`: `/users/metrics` per salary day (all members), per account per day (`creator_ids=[account]`), and for the presets `7d`, `mtd`, `prev-month` | today and yesterday every run; days whose transactions changed; presets once per run | ~5 + accounts × 2 + 3 |
| 8 | `derive`: pay rows from the account ledger (§5) | open months | 0 (Firestore only) |
| 9 | `rollups`: `account-days`, `creator-fans` for touched days and fans | touched only | 0 |
| 10 | `reconcile` (21:01 run only): `/overview-metrics` per account per open month, net, Harare-offset bounds | open months | accounts × open months |
| 11 | `notify`: tier notices for touched agent-months, ops alerts | — | 0 |

Rough budget: low hundreds of calls per run, sequential, within the 240 s budget the BuddyX sync already uses. The backfill (§6.3) is a separate cursor-driven job that the continuation cron advances in chunks. It never competes with a scheduled run: one lease covers both, and the scheduled run wins.

Collections written: see §9.4 for names, ids, rules and indexes.

### 4.2 Identity mapping

- **Account → creator.** OnlyMonster `/accounts` gives `id` (OnlyMonster), `platform_account_id` (the numeric OnlyFans id), `username`, `name` and `custom_label`. Match `username` against `creators.OFID` **and** `creator-subaccounts.OFID` (`@handle`, folded), as today (rule 9h), **but only among accounts whose `platform` is `'onlyfans'`** (decision 2026-11-11). A Fansly or JFF sub-account that reuses its parent's handle can therefore never collide with the OnlyFans account. A handle claimed twice among OnlyFans accounts still maps to nobody. On a match, **pin the numeric `platform_account_id`** on the mapping doc. Handles change; the numeric id doesn't. An admin's manual link wins and survives every sync.
  - **OnlyMonster accounts with no Bluu match are ignored for now** (decision 2026-11-11). Their `onlymonster-accounts` doc is still written with `match: 'none'`, so a later link works. No alert, no attention-band entry, and every later stage skips them. No transactions are stored under `om:{accountId}` until that decision changes.
  - Fansly accounts are recorded in the mapping list but skipped by every stage.
  - **An empty `/accounts` or `/members` response while stored docs exist is treated as suspect** (run 1 once returned 0 members, then 9). The stored mapping is kept, a warning is recorded on the run, and nothing is unmapped.
- **Member → user.** `/members` gives `id, name, email, customName`. Match by `normalizeEmail` (the login fold), never by name. Manual override wins. **Members feed only activity analytics and the cross-check (D13). Pay never reads them.**
- UI: CA Admin → Sales → **Mapping** (same place and pattern as today). The admin claim edits it.

### 4.3 The client — `src/lib/onlymonster/`

Modelled on `src/lib/buddyx/`:

| File | Role |
|---|---|
| `client.ts` | `import 'server-only'`. `omGet` / `omPaginate` (cursor and offset variants). `x-om-auth-token` header. Error envelope. 429 → `Retry-After` (up to 3). 5xx/network retry (up to 2). `API_KEY_PERMISSION_DENIED` is fatal and alerts. Counts requests for the run log. **Only exports GET helpers.** |
| `rateLimit.ts` | A token bucket per endpoint (15/s default, per-endpoint overrides from the spec) plus a token-wide 25/s bucket. |
| `types.ts` | Wire types. Ids normalised to strings (OnlyFans ids exceed 2^53 on Fansly and `platform_account_id` is documented as a big-int string). |
| `classify.ts` | Pure: transaction `type`/`status` → `{ category, kind?, counted }`. Unknown strings → `other`. Tested. |
| `payPlan.ts` | Pure: the pay-ledger derivation (§5). Ported from `salesPlan.ts` and tested to the same depth. |
| `chargebackMatch.ts` | Pure: unique-match rule (§5.5). Tested. |

Env: `ONLYMONSTER_API_KEY` (core, read-only permissions: `accounts.view`, `dashboard.view`, `team_metrics.view`, `traffic_metrics.view`, `mass_messages.view`). `ONLYMONSTER_STATEMENTS_KEY` is added only in Phase 7.

---

## 5. The pay ledger (`ca-sales`) — the money path

### 5.1 Which transactions become sales

| OnlyFans `type` | `ca-sales` | `kind` / `type` stored |
|---|---|---|
| `Tip from…` | yes | `tip` / `tips` |
| `Payment for message` | yes | `ppv` / `ppv` |
| `Post purchase`, `Live stream`, `Subscription`, `Recurring subscription`, `Unknown`, anything new | **no**, account ledger only | — |

- Tips no longer carry a message/post/profile split, because OnlyFans doesn't report one. Existing rows keep `tips_messages`, `tips_posts` and `tips_profile`; new rows are `tips`. The vocabulary in `saleTypes.ts` already contains `tips`, so a month that spans the cutover displays correctly.
- Mass-message and automated PPV unlocks are indistinguishable from 1:1 unlocks in `/transactions`. They are credited by the same shift rule. This matches today's behaviour.
- Status: **P1, a pay policy for the user to confirm**, informed by V4. The proposal is that `done` and `loading` count, and `pending_return` counts but is flagged on the ledger. It must be settled before Phase 4.

### 5.2 Attribution: `shiftHolder` (strict)

A new pure function sits beside `scheduleHolder` in `scheduleMatch.ts`, built on `matchSalesToSchedule`:

```
shiftHolder(match) = match.scheduled.length === 1 ? match.scheduled[0] : null
```

- **Occurrences** come from `getShiftsByRange` + `expandShiftsForWindow` over the window, with a day of lookback: recurrence, overrides and leave tombstones are resolved, overtime accounts and in-shift cover are included, and sub-account ids compare directly (rule 9h).
- Intervals are **half-open, `[start, end)`**, as `matchSalesToSchedule` already uses. A sale at 15:00:00 on a 07:00–15:00 / 15:00–23:00 handover belongs to the second shift, so a back-to-back handover is never a tie.
- **Departed agents (D8):** apply `withoutDeparted`, **and also clamp each occurrence's end to the agent's departure instant**. Today `withoutDeparted` drops only occurrences that *start* after departure, so a shift that began before someone left would still credit them afterwards. The clamp closes that gap. Test it.
- Outcomes, stored as `attributedBy`:
  - `schedule`: exactly one agent → `sourceUserId` = that agent.
  - `unscheduled`: nobody scheduled → `sourceUserId = null`.
  - `overlap`: two or more scheduled → `sourceUserId = null`, `scheduledUids` stored (index-exempt) so the ledger can offer each candidate.
  - `departed`: the only candidate had left → `null`.
- **Re-derived every run** (it is part of `syncHash`), so a corrected shift re-credits the sale on the next run, subject to the finalised guard. This is today's behaviour.
- **Behaviour change to call out (D2):** in the BuddyX era, a sale with nobody scheduled fell back to BuddyX's chatter. Under the strict rule it is unassigned. The shadow report (Phase 3) counts exactly how much revenue moves from "credited" to "unassigned" under the new rule, per agent, so it can be communicated before cutover.

### 5.3 The `ca-sales` row

The existing `CaSaleDocument` shape is kept, so the engine and every reader are unchanged. New rows:

| Field | Value |
|---|---|
| id | `om-{platformAccountId}_{transactionId}`, minted once, never changed. The spec calls chargeback and link ids "globally unique" but transaction ids only "unique", so the account is part of the key. V15 may relax this, but the id format is fixed before the first write. |
| `source` | `'onlymonster'` (added to the union) |
| `sourceId` | transaction id |
| `transactionId` | link to `of-transactions` |
| `creatorId` | mapped creator or sub-account. Unmapped OnlyMonster accounts are ignored (§4.2), so no row is written for them. |
| `kind` / `type` | §5.1 |
| `grossRevenue`, `signedGross` | `amount`; positive for a sale, negative for a chargeback row |
| `netRevenue` | `round2(gross × 0.8)` (see V3) |
| `occurredAt`, `day`, `month` | transaction `timestamp`, bucketed on `Africa/Harare` (unchanged rule) |
| `sourceUserId` | `shiftHolder` result |
| `attributedBy` | `schedule` · `unscheduled` · `overlap` · `departed` |
| `userId` | `transfer ? transfer.toUserId : sourceUserId` (the invariant, unchanged) |
| `fanId`, `fanName` | `fan.id`; name from the registry (`resolvedFanNames`) |
| `txStatus` | raw OnlyFans status (index-exempt) |
| `syncHash`, `syncedAt`, `removedAt` | as today |

Not written on new rows: `chatterId`, `modelId`, `modelHandle`, `buddyxUserId`, `unmappedChatterId`, `employeeName`, `sourceEmail`. Old rows keep theirs.

### 5.4 Transfers, disputes, reassignment: unchanged in substance

- `disputeTransfer.ts`, `disputeRules.ts`, `reassignSale`, `untransferSale`, `assignmentLog` and the dispute flow all keep working. They key on `ca-sales` fields that new rows also carry.
- `claimRefusal` currently refuses anything not `source: 'buddyx'` after the BuddyX cutover. It is generalised to "after `SALES_CUTOVER_AT`" (BuddyX **or** OnlyMonster), so an agent can dispute across the cutover.
- `attributionConflict`: set when the shift-derived `sourceUserId` later differs from `transfer.sourceUserIdAtTransfer` **and** from the current holder. That is, a shift correction disagrees with a move Bluu made. The transfer stands.
- "Move to {agent on shift}" stays and becomes simpler: under the strict rule it is offered only for `overlap` rows (pick one of the candidates) and for rows a transfer moved off the schedule.

### 5.5 Chargebacks (D7)

1. Classify `/chargebacks` items by `type` (V5). Only tip and message-payment chargebacks reach pay; the rest are account-ledger only.
2. Find the original **transaction** in `of-transactions`: same account, `fan.id`, category, `amount`, and `timestamp == transaction_timestamp` (tolerance per V2). **Attach only when exactly one transaction matches.** Zero or several → `of-chargebacks.matchState = 'none' | 'ambiguous'`, surfaced on CA Admin → Sales and on OnlyFans Analytics. Never guessed.
3. Find the original **sale** in `ca-sales`. This depends on which side of the cutover the original falls:
   - **After `ONLYMONSTER_CUTOVER_AT`:** the transaction's `saleId` (`om-*`).
   - **At or before it:** the original was paid as a `bx-*` or Infloww row, and backfilled transactions never produce a `ca-sales` row. Match it by facts (kind, creator, fan, gross in cents) over the `(creatorId, kind, occurredAt)` index. **Infloww rows match on the exact instant. `bx-*` rows do not:** BuddyX's `occurredAt` runs 18–55 s earlier than `transaction_timestamp` (V14), so the window for them is `[transaction_timestamp − 120 s, transaction_timestamp]`, with the exact tolerance confirmed from the Phase 3 shadow report. **Attach only on a unique match**; otherwise flag it `sale-unmatched` and never guess. BuddyX keeps charged-back sales live (V14), so attaching a chargeback to a `bx-*` row never double-deducts.
4. For a matched tip or PPV: write `ca-sales/om-cb-{chargebackId}` with `status: 'reverse'`, negative `signedGross`, `day`/`month` from **`chargeback_timestamp`**, and `reversesSaleId`. Its `sourceUserId` is **the original sale's current effective holder** (`userId`, transfers included), re-derived each run so it follows a later dispute. It is guarded by the finalised check on its *own* month, not the original's, so a finalised month is never restated.
5. **OnlyFans removes the original once it is charged back (V5), and that removal is not the deduction (P6).** When an `om-*` original's transaction stops being returned and exactly one chargeback matches it, the original row **stays counting** with `chargedBackAt` set, and the chargeback row deducts on the chargeback's day (D7). A vanish with no matching chargeback is soft-removed as in §5.6. **No double deduction:** a chargeback row deducts only while its original sale still counts. If the original row is soft-removed (`removedAt`), because BuddyX dropped a refunded sale or OnlyMonster stopped returning the transaction, the `om-cb-*` row is soft-removed too: the removal already took the money back. Two cases need care:
   - **The original's removal was refused in a finalised month** (`vanishedAfterFinalise`, still counting): the chargeback row applies.
   - **The chargeback's own month is finalised:** it is frozen, as every row is.
   V14 establishes what BuddyX does with a chargebacked sale. This rule is correct either way, and a test pins both orders: the BuddyX removal before the chargeback is seen, and after it.
6. **Corrected after probe run 1:** every chargeback seen reads `status: 'undo'`, so `undo` is the normal state, not a reversal. A chargeback that stops being returned by `/chargebacks` (in a window that paginated to completion) is soft-removed by the normal vanished logic, with the same guards. Any status other than `undo` is surfaced on the ledger, never interpreted.
7. **Matching reads soft-removed `of-transactions` rows too.** OnlyFans stops returning a charged-back original (V5), so the original survives only as our own row. The account-ledger row is marked `chargedBackAt`, not removed, so account revenue nets the chargeback on its own day just as OnlyFans' statements do. Under P6 its `om-*` sale keeps counting and the chargeback row carries the deduction.

### 5.6 Vanished rows and corrections

- A transaction id that the API stops returning, inside a window where `/transactions` paginated to completion for that account, soft-removes its account-ledger row **and** its `ca-sales` row (never inside a finalised month; flagged `vanishedAfterFinalise` there, as today).
- An id that reappears is restored.
- Re-keying (`resolveSaleIdentities`) is **not** ported unless V4 shows OnlyMonster transaction ids change when a status changes. If they do, the BuddyX fact-match re-key is ported with its "unique on both sides or never" rule.

### 5.7 The cutover predicate

```ts
// salaryConstants.ts
export const ONLYMONSTER_CUTOVER_AT = Date.UTC(…);   // set in Phase 4, a 00:00 SAST boundary
export type SalesSource = 'infloww' | 'buddyx' | 'onlymonster';
export function salesSourceFor(ms) {
  return ms <= SALES_CUTOVER_AT ? 'infloww' : ms <= ONLYMONSTER_CUTOVER_AT ? 'buddyx' : 'onlymonster';
}
```

- Until Phase 4 the constant is `Infinity`, so the BuddyX sync is unaffected.
- The BuddyX sync already keeps only rows where the predicate says `buddyx`. Its **vanished-row pass must also be restricted to `≤ ONLYMONSTER_CUTOVER_AT`**, so it doesn't soft-remove its own rows that fall after the cutover. That change ships, tested, **before** the constant is set.
- A 00:00 SAST boundary means no salary day is split across two sources, so each source's day totals stay comparable during reconciliation. This is still mid-month, as D6 requires.

### 5.8 What the ledger UI shows (CA Admin → Sales and the agent's Sales Report)

- The **Source credits** column is generic: BuddyX's credit for `bx-*` rows (historical data, labelled "BuddyX (historical)") and empty for `om-*` rows. The `buddyxUserId` field stays on old documents. The serialiser exposes it as `platformCreditUserId`, and no new code names BuddyX.
- New attention-band anomalies: **Unassigned: nobody on shift**, **Unassigned: overlapping shifts** (with candidates), **Unmapped OnlyFans account**, **Chargeback not matched**, **Pending return**, **Unknown transaction type**.
- Removed anomalies: *Unmapped BuddyX chatter*, *Differs from BuddyX*, and *PPVs with no sender*.
- `SyncStatus` is replaced by a passive `DataFreshness` label ("Updated 13:01 · next 21:01"), with **no button**.

---

## 6. The account ledger and OnlyFans Analytics

### 6.1 `of-transactions/{platformAccountId}_{transactionId}`

Fields: `accountId` (OnlyMonster), `platformAccountId`, `creatorId` (mapped, or `om:{accountId}`), `fanId`, `rawType`, `category` (`subscription` · `renewal` · `tip` · `message` · `post` · `stream` · `other`), `status`, `gross` (null preserved), `net` (V3), `occurredAt`, `day`, `month`, `saleId` (when it produced a `ca-sales` row), `removedAt`, `syncHash`, `syncedAt`.

Indexed: `(creatorId, occurredAt)` for rollups and chargeback matching, and `(fanId, occurredAt)` for the fan report. Every other field is index-exempt.

### 6.2 Rollups

- **`account-days/{creatorId}_{day}`**: gross and net per category, counts, spenders, new and returning subscribers (from `of-subscriptions`, which includes free trials, unlike transactions), chargebacks, and the day's activity (messages, fans chatted, PPVs sent, reply time average) from `account-activity-days`. It is **recomputed from scratch** for every touched day, so it is idempotent and never incremental drift. OnlyFans Analytics reads only these.
- **`creator-fans/{creatorId}_{fanId}`**: replaces `buddyx-fans`. `spendByMonth` now covers **all** categories (subs included), with the tips/PPV split kept. `subscriptions`, `acquisition` (from link users) and `displayName` are written through by the registry as today. It is rebuilt for touched fans only.

### 6.3 Backfill to October 2025 (D9)

- A cursor-driven job pulls `/transactions`, `/chargebacks` and `/subscriptions` per account, month by month, from `2025-10-04` (`CREATOR_HISTORY_START_DAY`) up to the shadow start. It is advanced by the continuation cron in time-boxed chunks. It writes the account ledger and rollups **only**, never `ca-sales` (pay before the cutover is BuddyX's and Infloww's and stays untouched).
- If OnlyMonster's history for an account starts later than October 2025 (V6), the gap is recorded per account. OnlyFans Analytics then shows the old Infloww/BuddyX daily stats for those days, labelled with their source, instead of zeros.
- `creator-stats-days` (Infloww and BuddyX) is **not modified**. It is exported and archived under §9.3 once the new history is verified.

### 6.4 Matching OnlyFans (net), and the reconciliation

- **Net is the default basis**, as today (the toggle stays). Net is computed per transaction and then summed, which is how OnlyFans rounds. That improves on today's `Σgross × 0.8`. V3 confirms the exact rounding against an OnlyFans statement.
- The **21:01 run** calls `/overview-metrics` per account per open month with `earnings_type=net`, `include_subscription_revenue=true`, and `from`/`to` at **Harare offsets**. It compares `total_revenue` and the category splits with the sum of `account-days`, and stores `account-reconciliation/{creatorId}_{month}` = `{ om, ledger, diff, checkedAt }`. Admins see a ✓, or a flag with the difference, on each roster card.
- **Day boundary:** OnlyFans Analytics keeps bucketing on `Africa/Harare` (one company boundary, as pay does). The check against OnlyFans' own dashboard must be done with matching boundaries. The procedure for that one-off sign-off is in Phase 2.

### 6.5 OnlyFans Analytics changes

- It reads `account-days`, `of-links`, `of-subscriptions` and `account-reconciliation`. Every surface that was missing subscription revenue now has it.
- **Link revenue is now computed exactly**: link users give `(link_id, fan.id, subscribed_at)`, and each fan's spend after subscribing comes from the account ledger. This replaces BuddyX's "revenue (as reported)" of unstated basis, so `LINK_REVENUE_NOTE` goes, and link revenue follows the gross/net toggle.
- **Rev share:** BuddyX never had it configured (buddyx.md §9). The fact stays hidden; no change.
- The `buddyx:{modelId}` / *Not in Bluu* card logic becomes `om:{accountId}`.

---

## 7. Chatter Analytics

- **Revenue stays on the `ca-sales` ledger** (it already is, since 2026-10-14), so the sales board, team band, comparison periods and per-agent report are unchanged in substance. After the cutover they reflect shift-attributed sales.
- **Activity moves to `/users/metrics`:** `chatter-days/{day}` holds a row per member (mapped to a uid) with messages, chats, PPVs sent (`paid_messages_count`), sold PPVs (`sold_messages_count`), typed words and reply time average. `chatter-periods/{7d|mtd|prev-month}` holds exact preset aggregates, because averages can't be summed.
  - **Custom ranges:** counts are summed from days. Reply time is shown as a message-weighted mean of daily averages, labelled "≈", and the live **Pull** route is removed.
  - **Relabelling:** "median reply time" → "average reply time"; "unlock rate" → `sold ÷ sent` with a note that sold counts by purchase time (V7).
  - **Regression to decide before Phase 6 (V6 activity):** OnlyMonster has member activity only from **2026-11-01**. Deleting `buddyx-team-days` would turn 27 Sep – 31 Oct 2026 into "—" on Chatter Analytics. Options: carry those BuddyX days into `chatter-days`, labelled "BuddyX (historical)", or accept the gap. The user decides.
  - **Activity history is backfilled from OnlyMonster**, not carried over from BuddyX. `/users/metrics` accepts any window, so `chatter-days` and `account-activity-days` are backfilled to 27 Sep 2026 (`BUDDYX_TEAM_STATS_START_DAY`, renamed `ACTIVITY_START_DAY`). That costs about one call per day, plus one per account-day, through the same backfill job as §6.3. Activity before 27 Sep stays "—", as today. If OnlyMonster has less history (V6), the gap shows "—".
- **Mass messages per agent** come from `of-mass-messages.created_by`. The summary shape is unchanged.
- **Admin cross-check (D13):** for each agent and period, show "OnlyMonster credits $X" (`sold_messages_price_sum + tips_amount_sum`, never posts) beside the ledger figure, with a flag when they differ by more than a threshold (proposed: 15% and $50). It is admin-only, so it never enters `SalesBoardRow`. It is never on the pay path (rule 9k's spirit, made explicit in §14).
- **Removed (D12):** online time, `buddyx-team-hours`, the `never-online` flag (`chatterIntegrityService.ts`, `integrityUi.tsx`, `analyticsTypes.ts`), the BuddyX-by-hour lane in `ShiftTimeline`, and per-hour reads. Input-quality and static-screen flags stay; they are Bluu's own data.

---

## 8. Fan base

- **Registry migration:** `buddyx-fan-names` → **`fans`** (same doc ids and fields). Steps:
  1. Copy with `bulkWriter()`.
  2. Verify count and per-doc hash.
  3. Switch every reader and writer in one deploy (`fanRegistryService`, `fanBaseService`, `fanIdentity` consumers, the sales derivation's `resolvedFanNames`).
  4. Run a final delta copy of anything written between the copy and the switch, keyed on `updatedAt`.
  5. Archive the old collection (§9.3).
  The `source` value `buddyx-link` stays on existing docs as history; new synced names use `onlyfans-link`.
- **Synced names** come from tracking and trial link users (`fan.name`, `fan.username`). This is the only fan-name source in the OnlyMonster API.
- **Handle → id linking gets a suggestion feed.** Link users carry `(fan.id, username)`, which can resolve an `h_<handle>` fan from customs to its numeric id. Merging is an identity decision (fan-base.md: `ca-admin` only), so the sync **suggests** links ("h_jake99 is OnlyFans id 123…") on the fan report and the admin confirms. It never auto-merges.
- Fan Analytics reads `creator-fans` and the registry. Scope rules (an agent sees creators rostered this month; `ca-admin` sees all) are unchanged.

---

## 9. BuddyX removal inventory

### 9.1 Code to delete (Phase 6)

| Area | Paths |
|---|---|
| Client + logic | `src/lib/buddyx/` (all). Move the neutral pieces first: `analyticsFormat.ts`, `chartColors.ts`, `analyticsTypes.ts` (minus BuddyX types) and `analyticsAuth.ts` → `src/lib/analytics/` |
| Services | `buddyxSyncService.ts`, `buddyxStatsSync.ts`, `buddyxSyncContext.ts`, `buddyxMappingService.ts`. `buddyxAnalyticsService.ts` is rewritten as `analyticsService.ts` |
| Routes | `/api/buddyx/{sync,status,creators}`, `/api/admin/buddyx/{config,mapping,runs}`, `/api/cron/buddyx-sync`, `/api/analytics/chatters/pull` |
| UI | `components/buddyx/` → `SyncStatus` deleted. `PeriodPicker`, `SalesBoard`, `SourceMixBar`, `ShiftTimeline`, `chatterPeriods`, `buddyxUi`, `integrityUi` and `CreatorCombobox` move to `components/analytics/`, with BuddyX references removed |
| Hooks | `useBuddyxSync.ts` (deleted; `useBuddyxCreators` → `useOnlyMonsterAccounts` for the dispute dialog if it is still needed), `useBuddyxAnalytics.ts` → `useAnalytics.ts` |
| Pay-path remnants | `scheduleHolder` (the BuddyX-fallback variant), `creditableBuddyxUid`, BuddyX-specific `planSalesSync` branches, `LEDGER_*_ATTRIBUTION` copy, the "BuddyX credits" column |
| Notifications | `notifications.buddyxSyncFailing` → `onlymonsterSyncFailing` (rule 5), the `AUTOMATED_NOTIFICATIONS` entry updated (rule 15), notifications.md table row |
| Tests | `buddyxMapping.test.ts` → `onlymonsterMapping.test.ts`, `salesWrite.test.ts` → ported to `payPlan`, `benchmarks.test.ts` (check whether D8 benchmarks are still used; delete if not) |
| Cron | `src/vercel.json` → the `buddyx-sync` entry is replaced by `onlymonster-sync` (3×) and `onlymonster-continue` (*/10) |
| Env | `BUDDYX_API_KEY` removed from Vercel (all environments); key revoked in BuddyX |
| Spec/docs | `buddyxapi.yaml` and `buddyx-integration.md` deleted. `documentation/buddyx.md` → `documentation/onlymonster.md`. ca-salary.md §4/§13, fan-base.md, data-layer.md, notifications.md and the CLAUDE.md hub (system map, rule 9j, spoke index) updated |

**Stale renderers (rule 9c).** Electron renderers can run a weeks-old bundle, so for one cycle:

- The deleted routes `/api/buddyx/status`, `/api/buddyx/sync` and `/api/analytics/chatters/pull` are replaced by stubs that return a benign shape (`{ configured: false }`, or `410` that the old hook already treats as "not configured" — check this before choosing). They must never 404 in a way that throws.
- Response keys that pages drop (`onlineMs`, `revenuePerOnlineHour`, median reply fields, `earningsMtd`…) are sent as `null` instead of being removed.

Both are deleted once `DeploymentRefresher` has cycled the fleet, about two weeks after Phase 5.

A final `grep -ri buddyx src functions tests documentation CLAUDE.md` must return only the historical-data labels listed in §5.8 and the `source: 'buddyx'` literal that the serialiser reads.

### 9.2 Data kept in place (never touched)

`ca-sales` (all rows and fields), `disputes`, `ca-salary-*`, `ca-sales-imports`, `shifts`, `leave_requests`. BuddyX field names on old documents (`buddyxUserId`, `chatterId`, `modelId`, …) stay and are read only by the serialiser.

### 9.3 Data exported, then deleted on approval

`buddyx-meta`, `buddyx-sync-runs`, `buddyx-chatters`, `buddyx-models`, `buddyx-team-days`, `buddyx-team-periods`, `buddyx-team-hours`, `buddyx-mass-messages`, `buddyx-subscribers`, `buddyx-links`, `buddyx-fans`, `buddyx-fan-names` (after §8's migration), and `creator-stats-days` (after §6.3 is verified). The export goes to `gs://<bucket>/archive/buddyx/{collection}/{date}.ndjson.gz` with `manifest.json`. A script `src/scripts/archive-collection.js --collection X [--verify] [--delete --confirm X]` performs it. Delete requires typing the collection name, mirroring the repo's dry-run/`--write` convention.

### 9.4 Rules and indexes (announced per rule 1)

- **New** collections are all Admin-SDK only (`allow read, write: if false`): `onlymonster-meta`, `onlymonster-sync-runs` (TTL `expireAt`), `onlymonster-accounts`, `onlymonster-members`, `of-transactions`, `of-chargebacks`, `of-subscriptions`, `of-links`, `of-mass-messages`, `chatter-days`, `chatter-periods`, `account-activity-days`, `account-days`, `account-reconciliation`, `creator-fans`, `fans`, `ca-sales-shadow`.
- **New composite indexes:**
  - `of-transactions (creatorId, occurredAt)`
  - `of-transactions (fanId, occurredAt)`
  - `creator-fans (creatorId, …)` (mirroring `buddyx-fans`)
  - `fans (customsCount)` (single field, kept indexed)
  - `ca-sales-shadow (month)`
  - field overrides exempting every bulky or unqueried field (rule 9)
- **Removed at Phase 6:** the `buddyx-*` rule blocks (default deny covers them) and the `buddyx-team-days` indexes.
- Deploy: `firebase deploy --only firestore:rules,firestore:indexes`.

---

## 10. Phased rollout

Each phase has a **gate**. Nothing in a later phase starts until its gate is signed off.

### Phase 0: verification and prerequisites (no product code)

- Create the OnlyMonster API key with **read-only** permissions (§4.3).
- Deliver `src/scripts/onlymonster-probe.js`: GET-only, a handful of calls on one account and one or two days. Fan ids are hashed in the output. **The user runs it and shares the output. Claude never calls the API.** Pasted payloads also work.
- Close every item in §11.
- Take the invariant-6 backup baseline and enable point-in-time recovery.

**Gate:** every V-item has a written answer in this file; the transaction classifier and the chargeback match key are final.

### Phase 1: foundations (no pay impact)

**Status 2026-11-11: built and not yet deployed.** See [`documentation/onlymonster.md`](documentation/onlymonster.md). Shipped:
- the client, limiter, errors, types and classifier;
- the `platform` field on creators and sub-accounts, with all 18 existing accounts backfilled;
- identity mapping and its UI (CA Admin → Sales → OnlyMonster mapping);
- the orchestrator (lease, state, run log with TTL, incident alert, silent skip while unconfigured);
- rules and indexes;
- `DataFreshness`;
- tests (`onlymonsterClassify`, `onlymonsterMapping`).

The numeric-id pin (§4.2) is implemented as `resolveAccountPinned`: a handle rename keeps the creator and warns, and it never switches silently. The continuation cron is deferred to Phase 2 (P3).

**Results against live data:**
- 9 of 11 OnlyFans accounts map, with no ambiguity. The two unmatched accounts are OnlyMonster-only and ignored.
- 8 of 9 members map, and **all 7 active CA agents are matched**. The unmatched member is `dante@bluurock.com`, who is not a CA agent.

**Remaining gate item:** three clean scheduled runs after deploy.

**Temporary (rule 9c):** the create routes accept a missing `platform` from a stale renderer and store it unset. Remove that tolerance once the fleet has reloaded.

- Client, limiter, errors, types, classifier.
- Identity mapping plus the mapping UI.
- Sync orchestrator: lease, state, run log, cursors, continuation cron, time budget, ops alert (`onlymonsterSyncFailing`, once per incident, cleared on the next healthy run).
- Rules and indexes for the new collections, announced.
- `DataFreshness` component (read-only).

**Gate:** every active OnlyFans account and every active agent is mapped; three consecutive clean scheduled runs.

### Phase 2: account ledger and OnlyFans Analytics (no pay impact)

**Status 2026-11-11: built, not deployed.**
- **Stages:** `transactions` (with chargebacks), `subscriptions`, `massMessages`, `metrics`, `rollups` (`account-days`) and `reconcile` (21:01).
- **Backfill and continuation:** the backfill job list runs on the every-ten-minutes continuation cron.
- **Switch and reconciliation:** OnlyFans Analytics reads OnlyMonster behind `config.analyticsSource`, stitched to the archived history. The reconciliation shows on CA Admin → Sales → OnlyMonster mapping.
- **Live check:** the ledger logic matched `/overview-metrics` to the cent on 18 of 18 account-days (2 accounts).
- **Departures from the original plan:** the ledger is bucketed per account-day (D20). Links stay on BuddyX until the fan-registry move.

- `of-transactions`, `of-chargebacks`, `of-subscriptions`, `of-links`, `of-mass-messages`, `account-days`, reconciliation.
- Backfill to October 2025.
- Rewrite OnlyFans Analytics on the new collections behind a server-side read switch (`onlymonster-meta/config.analyticsSource`), so it can be flipped back without a deploy.
- **One-off sign-off procedure:** for three creators and two closed months, compare OnlyFans' own statements page (net, the same date range) with `account-days`. Every difference must be explained (timezone boundary, pending, chargebacks) before the switch flips.

**Gate:** nightly `account-reconciliation` diff is $0.00 (or explained per account) for 7 consecutive days; the sign-off procedure is recorded here.

### Phase 3: pay ledger in shadow

**Status 2026-11-11: built, not deployed.**
- **Derivation:** the `derive` stage (`payPlan.ts`, 19 tests) writes `ca-sales-shadow` while the cutover is unset or writes are off.
- **View:** the Shadow reconciliation view covers all five readings.
- **Gate:** the shadow starts on the first deployed run, and the gate's 7 days count from then.

- `payPlan` derivation writes `ca-sales-shadow/om-*` for every tip and PPV after a shadow start instant (today plus the deploy). `salesWriteEnabled` stays **off**.
- The admin-only **Shadow reconciliation** view on CA Admin → Sales shows:
  1. **Per account-day:** BuddyX tips + PPV gross vs OnlyMonster tips + payment-for-message gross. **Expected equal.** A difference means one source is missing sales. This also answers buddyx.md's open item on PPVs sent outside the team.
  2. **Per agent-day:** current `ca-sales` holder totals vs shadow `sourceUserId` totals. Differences are expected only where BuddyX's chatter fallback applied; each is listed with its reason (`unscheduled` / `overlap` / `departed`).
  3. **Impact per agent:** revenue that would move from credited to unassigned under the strict rule (D2), for communication before cutover.
  4. Chargebacks matched / unmatched, including pre-cutover originals matched to `bx-*` rows (§5.5 step 3).
  5. **Accounts in pay today that OnlyMonster won't cover** (V13): any creator or sub-account with `bx-*` sales in the open months and no mapped OnlyFans account.

**Gate:** V13 resolved (no uncovered account, or an explicit user decision for each), and at least 7 consecutive days with (1) all equal or every difference explained; every unexplained (2) difference resolved; (3) reviewed and communicated to agents. Signed off by the user.

### Phase 4: pay cutover

**Status 2026-11-11: `ONLYMONSTER_CUTOVER_AT` is set to 2026-11-06 01:00 SAST (D25); `salesWriteEnabled` is still off.**
- **Cutover predicate:** `ONLYMONSTER_CUTOVER_AT = Infinity` and the three-way `salesSourceFor`.
- **BuddyX safety:** the vanished pass is restricted to BuddyX's own side (tested).
- **Disputes and switches:** disputes are generalised. `salesWriteEnabled` is refused while the cutover is unset.
- **Rollback and UI:** `scripts/onlymonster-rollback.js` is ready, as are the ledger UI for `om-*` rows and the boundary check in the shadow view.
- **Before the cutover:** V4 id stability (snapshot compare ≥ 2026-11-17) and an invariant-6 backup.

The day-before checklist:
- Invariant-6 backup taken.
- BuddyX vanished-pass restriction (§5.7) deployed and tested.
- Dispute rules generalised (§5.4).

Then:
1. Set `ONLYMONSTER_CUTOVER_AT` to the agreed 00:00 SAST boundary (a future instant) and deploy.
2. Flip `salesWriteEnabled` on (`PATCH /api/admin/onlymonster/config`, admin claim).
3. The next run writes `ca-sales/om-*` for transactions after the cutover. Shadow rows before the cutover stay as evidence and get a TTL of 60 days.
4. Verify on the first run, for the cutover day: BuddyX rows ≤ T plus OnlyMonster rows > T equals the account-ledger tips + PPV for that day. No `om-*` row ≤ T and no `bx-*` row > T. Tier notices fired correctly (no spurious "you dropped a band").

**Rollback.** It is cheap only until a pay decision has been made on an `om-*` row.

- **Before any `om-*` row is transferred, disputed or inside a finalised month:**
  1. Flip `salesWriteEnabled` off.
  2. An admin-claim script soft-removes the `om-*` rows. They are never hard-deleted.
  3. `ONLYMONSTER_CUTOVER_AT` returns to `Infinity`, so BuddyX resumes ownership and re-pulls those days.

  No `bx-*` row was touched.
- **After that point, rollback is not a toggle.** Each `om-*` row carrying a `transfer`, an open `disputeId` or an `assignmentLog` must have them replayed onto its matched `bx-*` row (by `saleMatchKey`, unique match only; anything else is listed for an admin). Before the rows are soft-removed, the script produces a dry-run report of every replay.

The first week live (the gate below) is therefore the period in which to find problems. A finalised month containing `om-*` rows is never rolled back. Any correction then goes forward as an override.

**Gate:** 7 days live with a clean daily cutover-boundary check and no unexplained anomalies.

### Phase 5: analytics and fan-base rewrite

**Status 2026-11-11: built behind the switches.**
- **Chatter Analytics:** activity reads `chatter-days`, with online time null. BuddyX's 27 Sep – 31 Oct days are carried over (D24, done).
- **D13 cross-check:** on the admin report.
- **Fan Analytics:** reads `creator-fans` (every category).
- **Registry move:** to `fans`, a one-line `FAN_REGISTRY` switch after `scripts/migrate-fan-registry.js`.
- **Deferred to Phase 6:** removing the refresh routes and buttons, online time and `never-online`. They serve BuddyX data until BuddyX is gone.

- Chatter Analytics activity on `chatter-days`, the admin cross-check, and the online-time removal (§7).
- Fan Analytics on `creator-fans`, and the registry migration to `fans` (§8).
- Manual refresh routes and buttons deleted.

**Gate:** pages render for agent and `ca-admin` viewers with the expected scopes; the registry hash verification passes.

### Phase 6: BuddyX decommission

**Status 2026-11-13: code removed, ahead of the precondition, on the user's instruction** (the team had stopped using BuddyX, and the key was already removed).
- **The incident that made it urgent:** at 05:01 UTC the BuddyX sync got an empty-but-complete answer and soft-removed all 150 November `bx-*` rows ($13,288). They were restored (only the ids that run removed), and `buddyx-meta/config.salesWriteEnabled` was set to `false` before the next run. The removal itself touched no data (nothing was deployed when it was checked); the real confirmation is to rerun the baseline snapshot after the deploy and after the next OnlyMonster run: 150 rows, $13,288, id hash `e02436496a3e2b24`. See [`documentation/buddyx.md`](documentation/buddyx.md) §3.
- **Done:** steps 1, 2 and 5. The cron, the code (§9.1), the refresh buttons, online time, `never-online` and the `analyticsSource` switch are gone. Compatibility stubs stay until 2026-11-30.
- **Kept on purpose:** `salesSourceFor` / `ONLYMONSTER_CUTOVER_AT` (they stop OnlyMonster double-paying the frozen `bx-*` rows). The `buddyx-*` rule blocks and index exemptions stay until each collection is deleted, because removing an exemption would *start* indexing the archive.
- **Accepted consequence of skipping the precondition:** a shift corrected for 1–5 Nov no longer re-credits those sales. Admin reassignment and disputes still move them. `scripts/onlymonster-rollback.js` was deleted, because rollback relied on BuddyX re-pulling.
- **Left:** step 3 (remove `BUDDYX_API_KEY`, revoke the key); steps 6–7 (export, then delete only on go-ahead, readers first: `creator-stats-days`, `buddyx-links`, `buddyx-subscribers`, `buddyx-models`, `buddyx-team-hours` and the registry are still read as archive).

- **Precondition:** the month containing `ONLYMONSTER_CUTOVER_AT` is **finalised for every agent**. Until then the BuddyX sync keeps running on its own side, because the shift-correction re-derivation of `bx-*` rows depends on it.
- Steps:
  1. Remove the BuddyX cron.
  2. Delete the code (§9.1).
  3. Remove the env var and revoke the key.
  4. Remove rules and indexes, announced.
  5. Update the docs.
  6. Export and verify every §9.3 collection.
  7. Delete each one **only on the user's explicit go-ahead**.

**Gate:** the grep check in §9.1 passes; the archive manifests verify.

### Phase 7: secondary features (§12)

**Status 2026-11-11:**
- **Payout balances:** read-only, built. A separate `statementsClient.ts`, GET-only, on `ONLYMONSTER_STATEMENTS_KEY`, daily, shown to the admin claim.
- **Mass-message listing and stats:** built (`of-mass-messages`).
- **Priority Mass Messages and Auto Messages listing:** not built. It needs `auto_messages.view` and PMM permissions on the key.
- **Sending:** not built. It needs a separate key and approval, per §12.

---

## 11. Verification items (Phase 0)

Each item names what it governs. Answers go inline here before the gate.

| # | Question | Governs |
|---|---|---|
| V1 | Exact `type` strings for tips and PPV. Is it the literal `Tip from` or `Tip from {name}`? Any other spellings seen? | §5.1 classifier |
| V2 | `timestamp` precision and zone. Are `start`/`end` inclusive? Is the cursor stable while new rows arrive? Does `chargebacks.transaction_timestamp` equal the original's `timestamp` exactly? | Window logic, §5.5 |
| V3 | Is `amount` gross on every type? When is it `null`? How does OnlyFans round net: per transaction, and how exactly? Check against one statement. | §5.3, §6.4 |
| V4 | Status lifecycle: does a `loading` row keep its id when it becomes `done`? What happens to a refunded row (status change, disappearance, or a separate entry)? What does `pending_return` mean for pay? | §5.1, §5.6 |
| V5 | Do chargebacks also appear in `/transactions` (as negative or status-changed rows), or only in `/chargebacks`? Values of `type` and `status` (`undo`?). | §5.5, double-counting |
| V6 | Earliest transaction available per account. Does it reach 2025-10-04? | §6.3 |
| V7 | `/users/metrics`: is `creator_ids` the OnlyMonster account id? Do `sold_*` count by purchase time? Are the `total_*` twins team-wide totals? Are amounts gross? | §7 activity, D13 cross-check (display only) |
| V8 | Do OnlyMonster member emails match Bluu `workEmail`s for every active agent? | §4.2 |
| V9 | Do OnlyMonster `username`s match `creators.OFID` handles? Which accounts are sub-accounts? | §4.2 |
| V10 | Volume: transactions per account per month (renewals especially). | Firestore cost estimate, run budget |
| V11 | Mass-message list fields: `created_by`, stats, `status`. | §7 mass messages |
| V12 | Does the account list include every connected OnlyFans account the agency works, including expired-subscription ones (`withExpiredSubscriptions`)? | Completeness of both ledgers |
| V13 | **Does BuddyX currently feed any non-OnlyFans account into pay?** BuddyX models map by handle against creators **and** sub-accounts (`buddyxMappingService.ts`), with no platform check, so a Fansly sub-account with a handle could have `bx-*` sales today. Check by counting `bx-*` rows in the open months whose `creatorId` is a sub-account labelled Fansly (an admin-run, read-only query). If any exist, the "OnlyFans only" scope would silently stop commission on those accounts at cutover. **The user must then decide** whether to keep them on BuddyX or add Fansly `/transactions` (the endpoint supports it). | Scope, the Phase 3 gate |
| V14 | What does BuddyX do with a chargebacked or refunded sale: drop it (our vanished pass then soft-removes the `bx-*` row), keep it, or something else? | §5.5 step 5 (no double deduction) |
| V15 | Are transaction ids unique across accounts, or only within one? The answer only matters for whether ids can be shortened later; the plan keys on `{platformAccountId}_{id}` regardless. | §5.3, §6.1 ids |

### Answers: probe run 1 (2026-11-11)

Accounts probed: 87963 `@itsnoahryder` (2026-11-09, 21 transactions, 6 chargebacks in 30 days) and 87965 `@liamheng` (no transactions that day). The directory and Bluu comparison cover all 16 accounts, with November checked for V13.

| # | Status | Answer |
|---|---|---|
| V1 | **Closed** | The exact strings are `Tip from` (literal, no name), `Payment for message`, `Subscription` and `Recurring subscription`. `Post purchase`, `Live stream` and `Unknown` were not seen; the classifier keeps them, with `other` for anything new. |
| V2 | **Closed** (cursor only lightly tested) | Timestamps are whole seconds sent as `.000Z`, newest first. **`start` and `end` are both inclusive**, so adjoining windows share their boundary instant and rows are deduped by id. Paging at limit 10 and at limit 1000 gave the same 21 ids (a small sample). For chargebacks, see V5. |
| V3 | **Closed** | `amount` is gross on every type, with no nulls in the sample. **Net is `Σ round2(gross × 0.8)` per transaction.** It matched `/overview-metrics` net exactly (490.29); summing first and rounding once was off by 0.02. Gross matched exactly (612.89) using `+02:00` Harare bounds. Overview counts `loading` rows. |
| V4 | **Open** | Every row from 2026-11-09 was `loading`. That suggests `loading` is OnlyFans' pending-earnings hold (about 7 days), not a short transient state. **If so, P1 must count `loading`, or the latest week drops out of pay.** To confirm: probe a day ≥ 10 days old for its status mix, and compare the snapshot on or after 2026-11-17 to check ids are kept through `loading → done`. |
| V5 | **Partly closed** | Chargeback `type` uses the transaction strings (`Subscription`, `Payment for message`). `amount` is positive. **`status` was `undo` on all 6**, so `undo` is the normal state, not a reversal (§5.5 step 6 is corrected below). Nothing showed up in `/transactions` at the chargeback's own time. **0 of 6 originals were found within ±1 s for the same fan.** The cause (original removed, timestamp differs, or fan id differs) is still open; the ±3-day wide search in the probe answers it. |
| V6 | **Closed for 2 of 11** | Both accounts have history back to 2025-09-01, before the D9 start. `--coverage` checks the other 9. |
| V7 | **Closed** | `creator_ids` is the **OnlyMonster account id** (87963 came back). **The `total_*` fields are the whole filter's total repeated on every row** (1596 = 7 × 228), so they must never be summed. `sold_*` is the part OnlyMonster attributes to members: 228 of 308 PPV and 190 of 195 tips, gross. So OnlyMonster leaves about 26% of PPV unattributed on this day. The D13 cross-check will diverge on structure alone, so P4's threshold needs that in view. |
| V8 | **Blocked** | `/members` returned 0 rows, although `/users/metrics` returned 7 user ids and mass messages carry `created_by.id`. Re-run with the probe's shape dump to tell an empty list from a wrong response key. |
| V9 | **Needs an admin decision** | 8 of 11 OnlyFans accounts match exactly one creator or sub-account. **87963 `@itsnoahryder` is ambiguous**, because sub-account "Noah Ryder (Fansly)" stores the same handle as the OnlyFans creator. Sub-accounts have no platform field (only a free-text `label`), so this can't be resolved without guessing: it needs a manual link, or a `platform` on sub-accounts. `colebentley` is the same pattern (Fansly vs JFF), but neither of those is an OnlyFans account in OnlyMonster. **No Bluu match:** 88025 `@yetanotherluca`, 88302 `@jeremy6331`. **Bluu OFIDs with no OnlyMonster OnlyFans account:** Leo `twinkleo`, Sol `solelioxx`, Elliot `elliot.twink`, Jackson Lake `jacksonlake100`, plus the Fansly/JFF sub-accounts. |
| V10 | **Closed** | 87963 has 700–900 transactions a month and 87965 about 100. Subscriptions plus renewals are about 75%. With 11 accounts that is a few thousand a month, roughly one page per account-month at limit 1000. Cost is negligible. |
| V11 | **Closed** | Fields: `id, status (scheduled/sending/done/unsent), can_unsend, created_at, created_by {type, id}, scheduled_at, message, stats`. `created_by.id` is a **string** member id. Mapping it to a Bluu uid needs `/members` (V8). |
| V12 | **Closed** | The `withExpiredSubscriptions` flag made no difference (16 accounts either way): 11 OnlyFans and 5 Fansly. |
| V13 | **Closed for November** | 7 creators or sub-accounts have live `bx-*` sales in 2026-11. 6 are covered. The uncovered one is Noah Ryder (33 sales, $3,039), and only because of the V9 ambiguity. **No Fansly sub-account has `bx-*` sales in November.** October must be checked too if it is still open. |
| V14 | **Open** | Not scriptable. Look at a known charged-back sale in `ca-sales`. |
| V15 | **Closed by id shape** | Ids are 32 hex characters (128-bit, hash-like), so a collision across accounts is negligible. The plan's `{platformAccountId}_{id}` key stays as written. |

### Answers: probe run 2 (2026-11-11, run by Claude at the user's request)

The user authorised Claude to run the probe directly from this point on. The probe stays GET-only, allowlisted and call-budgeted. The rows below supersede run 1 where they differ.

| # | Status | Answer |
|---|---|---|
| V4 | **Status closed; ids open** | 87963 on 2026-10-25: 17 of 17 rows `done`. On 2026-11-09: 21 of 21 rows `loading`. **`loading` is OnlyFans' pending-earnings hold, which turns into `done`**, so P1 must count `loading`. Whether ids survive `loading → done` needs the snapshot compare on or after **2026-11-17**. |
| V5 | **Closed: originals disappear** | Wide search (±3 days, any fan) for 6 chargebacks: **6 of 6 originals are no longer returned by `/transactions`**. That fan has no row in the window at all. `/overview-metrics` gross equals the remaining transactions exactly, so OnlyMonster's totals are net of chargebacks as well. Chargeback statuses are `undo` on all 16 seen; types include `Tip from`. |
| V2 (chargeback key) | **Closed** | `transaction_timestamp` **equals the original's OnlyFans timestamp exactly**. All four Infloww-era originals (2026-10-02; Infloww rows come from OnlyFans statements) matched to the second on kind, gross and instant. |
| V14 | **Closed: BuddyX keeps them** | The three BuddyX-era charged-back PPVs (2026-10-18) are **live `bx-*` rows, not soft-removed**. BuddyX does not drop a charged-back sale. **BuddyX's `occurredAt` runs 18–55 s *earlier* than OnlyFans' timestamp** for the same sale, so an exact-instant `saleMatchKey` will **not** find a BuddyX original (see §5.5 step 3 and §5.7). |
| V6 | **Closed** | 6 of 11 OnlyFans accounts have rows before 2025-10-04. The other 5 begin later: `@twink0108` 2026-01-31, `@arddenlane` 2026-07-11, `@lefty67` 2026-09-30, plus the two OnlyMonster-only accounts. Those starts look like each account's own first sale, not a limit on OnlyMonster's history. The §6.3 labelled-archive fallback covers any day where archived Infloww/BuddyX stats exist and OnlyMonster has none. |
| V6 (activity) | **Closed: activity history starts 2026-11-01** | `/users/metrics` has rows from the week of 2026-10-25 (with no messages) and real activity from **2026-11-01**. **The §7 activity backfill to 27 Sep is impossible.** See the regression note under §7. |
| V8 | **Closed** | `/members` now returns 9 members; run 1's empty list was transient. 8 match a Bluu user by normalised email. `dante@bluurock.com` matches nobody and needs a manual link or no action. The directory stage must never unmap on an empty list (§4.2). |
| V9 | **Resolved by decision** | The user decided (2026-11-11): creators and sub-accounts get a **`platform`** field; OnlyFans accounts map automatically by OFID **against `platform: 'onlyfans'` accounts only**; OnlyMonster accounts with no Bluu match are **ignored for now**. Leo is a Fansly account. Sol, Elliot and Jackson Lake are archived. |
| V13 | **Closed for Oct + Nov** | 8 creators or sub-accounts have live `bx-*` sales in 2026-10 and 2026-11. The one "uncovered" (Noah Ryder, 185 sales, $12,674.99) was only the V9 handle collision, which the platform filter removes. **No Fansly account has `bx-*` sales.** |

**Found while checking V14 (not caused by the migration):** four Infloww-era sales on Noah Ryder from 2026-10-02 (PPV $70 and $150, tips $2 and $100) were charged back on 2026-10-04 and **still count as live `ca-sales` rows**. Infloww was a one-time import, so nothing removed them. This is for the user to decide; the migration does not touch Infloww rows (invariant 1).

**Phase 0 gate status:** every item that governs Phase 1 and Phase 2 is closed. Still open, and blocking only later phases: V4 id stability (17 Nov snapshot), which blocks Phase 4; and the BuddyX timestamp tolerance for matching pre-cutover originals, which needs measuring in Phase 3's shadow report. P3 (continuation cron) is not needed until Phase 2, because Phase 1 has nothing to resume.

### Phase 0 run sheet

Scripts: [`src/scripts/onlymonster-probe.js`](src/scripts/onlymonster-probe.js) (GET-only, allowlisted, call-budgeted, fan ids hashed) and [`src/scripts/archive-collection.js`](src/scripts/archive-collection.js) (export / verify / confirmed delete). Run from `src/`. Paste the output back; answers are written into the table above.

| Step | Command | Closes |
|---|---|---|
| 1 | `node scripts/onlymonster-probe.js --compare-bluu --coverage --months <open months, e.g. 2026-10,2026-11>` | V6 (all accounts), V8, V9, V12, V13 (and the directory) |
| 2 | `node scripts/onlymonster-probe.js --account <busy OF account id> --day <a busy day> --history --volume --save-snapshot /tmp/om-snap.json` | V1, V2, V3, V5, V6, V7, V10, V11 |
| 3 | Same command as step 2 with `--compare-snapshot /tmp/om-snap.json`, **hours later** (so some `loading` rows have settled) | V4 |
| 4 | A second `--account` run on a different account, comparing transaction ids to step 2's | V15 |
| 5 | Not scripted: ask BuddyX / inspect a known chargebacked sale in `ca-sales` | V14 |
| 6 | `node scripts/archive-collection.js --backup phase0-baseline --write`, then `--verify` | Invariant 6 baseline |
| 7 | Enable Firestore point-in-time recovery in the GCP console (`gcloud` is not installed) | Invariant 6 |

---

## 12. Secondary features (Phase 7, outline only)

**Payout balances (read-only).**
- Data: `GET /proxy/v0/platforms/onlyfans/accounts/{id}/statements/balances` and `…/payout-requests`. These are limited to 1 request/s per account, shared across `/proxy/`, so they run sequentially at most once per scheduled run.
- Storage: `account-balances/{creatorId}` (current) and `account-payouts/{id}`.
- UI: an admin-only strip on OnlyFans Analytics.
- Separate key, separate client module exposing GET only. Creating payouts is out of scope permanently: it is irreversible and OnlyFans offers no idempotency.

**Campaign messaging.**
1. **Read:** list Mass Messages, Priority Mass Messages and Auto Messages with their stats per account (`*.view` permissions). This extends `of-mass-messages`, so Chatter Analytics' mass summary and a new campaign view share one sync.
2. **Write** (later, separate key, separate approval):
   - Admin-only actions with a typed confirmation that names the audience size.
   - A server-side idempotency record written **before** the call (`campaign-sends/{clientRequestId}`).
   - After any timeout, 500 or 502, **list before retrying** (the spec requires this), and never retry automatically.
   - Recall/unsend is refused for campaigns not created from Bluu unless the admin explicitly overrides, since the API reaches campaigns people built in the panel.

---

## 13. Testing

- **Pure modules, unit-tested in `tests/salary-engine/`:**
  - `classify`
  - `payPlan`: derivation, `syncHash`, finalised guard, transfer invariant, `attributionConflict`, vanished/restore, chargeback rows
  - `shiftHolder` (half-open boundaries, overlap, departure clamp)
  - `chargebackMatch` (unique, none, ambiguous)
  - net rounding
  - `account-days` rollup
  - `salesSourceFor` across three sources
- **Golden fixtures** built from the Phase 0 probe output: one account-day reproduced end to end (transactions → ledger → pay rows → engine totals).
- **Cutover-boundary test:** a synthetic day split at T produces exactly one owner per transaction.
- Existing suites (`disputeTransfer.test.ts`, `scheduleMatch.test.ts`, `leavePay.test.ts`, the engine) must pass unchanged. A change to any of them is a rule change, and it gets a doc change in the same commit (ca-salary.md §12).
- Run `/simplify` after Phase 2 and Phase 5 (rule 17).

---

## 14. Documentation and rule changes

- **New spoke** `documentation/onlymonster.md` replaces `buddyx.md`. It covers shape, client, sync stages, mapping, both ledgers, attribution, chargebacks, cutover, analytics, collections and alerting.
- **CLAUDE.md:**
  - The system-map block "CA salary → sales synced from BuddyX…" is rewritten.
  - The cron list is updated.
  - The spoke index row is updated.
  - Rule 9j is replaced by **"OnlyMonster is read only through `src/lib/onlymonster/client.ts`, only from a sync, GET only, and never a chat endpoint from a sync (a read marks the chat read on OnlyFans)"**, together with the ported pay invariants (§2.3) and "attribution is the shift schedule; OnlyMonster `/users/metrics` revenue is display-only and admin-only."
  - The ban on calling the API by hand (the 9b/9d/9e pattern) is added explicitly.
- `ca-salary.md`: §4 (three sources, the cutover), §13 (now OnlyMonster), and the strict shift rule.
- `fan-base.md`: collection rename, synced-name source, suggestion feed.
- `notifications.md`, `automatedNotifications.ts`: the renamed sync-failing alert, plus the new "unmapped OnlyFans account" alert.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| The strict rule leaves more sales unassigned than today, so agents lose commission they used to get through BuddyX's fallback. | Phase 3 quantifies it per agent before cutover. Unassigned sales are one click to place for an admin and disputable by agents. |
| The shift schedule is wrong (an agent covered informally). | Same as today: dispute, or an admin moves the sale. The D13 cross-check flags large divergences between OnlyMonster's view and the ledger, so schedule errors surface. |
| OnlyMonster history doesn't reach October 2025. | V6. Per-account gaps fall back to labelled archived stats (§6.3). |
| Transaction ids change on status transitions. | V4. Port the fact-match re-key if so (§5.6). |
| Renewal volume makes the account ledger expensive. | V10 estimate first. Every unqueried field is index-exempt, writes happen only on change, and pages read rollups, never transactions. |
| A run times out mid-stage. | Cursors plus the continuation cron. The lease prevents overlap. Each stage is idempotent. |
| A future write feature fires a real broadcast twice. | §12: a separate key, an idempotency record before the call, list before retry, no automatic retry. The core key can't write at all. |
