# Chat-Agent Salary & Coverage

The money surface for CA Portal, plus the absence pipeline that feeds it. Replaces a per-agent Google Sheet with one sheet per month.

**Read this before touching anything under `src/lib/salary/`, `src/app/api/ca-salary/`, `src/app/api/ca-coverage/`, or the creator-assignment fields on `shifts`.**

---

## 1. The one rule

**Nothing stores a computed salary.** Every figure an agent or an admin sees is derived on read, by a pure function, from sales + shifts + the time ledger + admin overrides + the rate config.

That is what makes the rest of the subsystem behave:

- A **re-import** of overlapping sales flows through immediately.
- A **corrected shift** re-prices the day it belongs to.
- A **rate change** restates every open month.
- An **admin's edit survives all three**, because it is stored as an instruction, not a figure.

The single exception is `ca-salary-months`, which exists precisely to freeze a month at payout. A finalised month is served from that snapshot and never recomputed — otherwise "what we paid" would silently change.

---

## 2. The calculation

```
  gross ─→ net ─→ ┐
     └─→ cumulative ─→ tier % ─→ commission ─┐
                                             ├─→ salary
  tracked ─→ +grace ─→ capped hours ──┐      │
  accounts ─→ hourly rate ────────────┴─→ wage
```

All of it lives in [`salaryEngine.ts`](../src/lib/salary/salaryEngine.ts). It is pure and synchronous; the API, the payroll grid and the agent's dashboard all call it, so a rule can never be implemented twice and drift.

### Gross → net → commission

- **Gross** is the day's signed sales total. A **reversal is negative** and reduces the day it is dated on — the agent does not keep commission on refunded money. A day can legitimately go negative.
- **Net** is gross less the platform deduction (20% by default). The importer trusts the export's own `Net revenue` column when present, because that is the figure the agent's third-party dashboard shows them.
- **Commission** is net × the tier percentage.

### The ratchet

The commission tier is read from **month-to-date gross including the current day**, so the day a threshold is crossed earns the new rate. Days are walked in ascending order and each keeps the rate it was computed at, so earlier days are never restated.

| Month-to-date gross | Rate |
|---|---|
| $0 – $3,999 | 2.5% |
| $4,000 – $7,999 | 3.0% |
| $8,000 – $11,999 | 4.0% |
| $12,000+ | 5.0% |

**Do not reorder the day loop.** The ratchet depends on ascending order.

### Hours

`min(scheduled shift length, tracked + grace)`, per shift, where grace is 15 minutes.

- The grace is credited to **every worked shift**, not only one that nearly reached full length — a half day gets 15 minutes too.
- A shift with **no tracked time gets nothing**. Grace forgives a short shift; it does not pay for an absence.
- The cap is the **shift's own scheduled length**, not a fixed 8 hours, so a 4-hour overtime shift caps at 4.
- A shift still in progress is credited only up to `now`. Crediting to its scheduled end would pay for hours not yet worked and make today's figure fall as the day goes on.
- Hours come from `computeTimeWorked` in [`shiftAttendance.ts`](../src/lib/utils/shiftAttendance.ts) — the same function the Shift Management timesheet uses. Idle and pause are excluded; break is included.

### Accounts → hourly rate

| Accounts | $/hour |
|---|---|
| 1 | $1.50 |
| 2 | $2.50 |
| 3 | $3.50 |
| 4 | $4.50 |
| 5 | $5.50 |

Clamps rather than interpolates. **Zero accounts pays nothing** — a shift with no accounts assigned is not a shift that was worked, and paying it would quietly reward a missing assignment.

The count comes from the shift's `creatorIds` **minus its `overtimeCreatorIds`** — accounts the agent works inside that shift without extra pay — **unless every account is marked, in which case it is an overtime shift and counts all of them** (§6, `splitShiftAccounts`). For days recorded before creator assignment existed it falls back to **distinct creators with a sale that day**, and the cell is flagged as inferred (orange in the grid, `accountCountSource: 'sales'`).

### Sub-accounts are peers, and cost the engine nothing

A creator often runs more than one account — Cole on OnlyFans, "Cole (Fansly)" on Fansly. These are **assignable peers**: one agent can hold Cole while another holds Cole (Fansly), and each counts as one account toward whoever holds it.

The whole mechanism is one design choice: **a sub-account is just another id in `creatorIds`.** Creator ids are Firebase Auth uids; sub-account ids are Firestore auto-ids. The two spaces are disjoint, so the field needs no discriminator — and the salary engine, the per-shift rate, and the 4/5-account claim cap all required **no change whatsoever**, because every one of them counts ids. `subaccounts.test.ts` pins that: the same agent on Cole + Cole (Fansly) earns exactly what they would on Cole + Adam.

`isSubAccount` exists only for *display* — grouping a picker, naming the parent on a roster. Nothing in the pay path reads it, and nothing should: weighting a sub-account as a fraction of an account is the bug this model was built to avoid.

**A sub-account is not a `creators` document.** A creator doc id *is* an auth uid — creators sign into the Telegram Mini App with it. A sub-account is an account somebody owns, not a person: no login, no Telegram binding, no portal. Modelling one as a creator would mint an auth identity that can never be used and put it in the creator portal's own roster.

| | Creator | Sub-account |
|---|---|---|
| Collection | `creators` | `creator-subaccounts` |
| Id | Firebase Auth uid | Firestore auto-id |
| Portal login | Yes | No |
| Assignable to a shift | Yes | Yes — as a peer |
| Counts toward the wage tier | 1 | 1 |
| Avatar | Its own | Inherits the parent's unless given one |

**Any surface that adds, archives or deletes an account must call `useRefreshCreators()`.** The admin screens fetch `/api/admin/creators`, which is a *different data path* from the shared store every picker reads (`/api/creators` + a 5-minute `sessionStorage` cache). Refreshing only the admin list leaves a deleted sub-account still selectable in the shift picker — and the shift route then rejects it as an account that no longer exists, which is exactly how this was found. `useRefreshCreators` clears the `sessionStorage` entry as well as the timestamp, because that cache outlives a page reload.

Managed in **Creator Management → ⋯ → Sub-accounts**. Archive rather than delete: the id is stored on every shift it was assigned to, and those shifts are what the engine prices, so deleting a used one leaves chips resolving to a raw id. The server refuses that delete (one `array-contains` on `shifts.creatorIds`) and says why.

> **The sales import still keys on creator *names*, not ids.** If the export reports a sub-account's revenue under its own name, the `accountCountSource: 'sales'` fallback counts it correctly; if it reports everything under the parent's, that fallback under-counts for multi-account creators. It only affects days with **no shift on record**, so it is a historical-data concern rather than a live one — but confirm which the export does before relying on a backfilled month.

> **1 and 5 were extrapolated, not observed.** The operated rates are 2/3/4. If payroll ever disputes a figure for a 1- or 5-account day, this is the first thing to check.

### `wageRateBasis` — the one genuinely ambiguous rule

When an agent works more than one shift in a day (a regular shift plus overtime), the source spec does not say whether the rate comes from that shift's accounts or the day's total. It is therefore a **setting**, not a constant, editable in CA Admin → Rates:

- `per-shift` **(default)** — a 3-account regular shift pays $3.50/h; a 2-account overtime shift pays $2.50/h.
- `per-day` — all accounts count toward one rate applied to every hour. Pays materially more.

### A multi-shift day's `accountCount` and `hourlyRate` are roll-ups, not rates

Under `per-shift`, a day with a regular shift *and* an overtime shift has **no single account count and no single rate**. The engine still has to put one number in each column, and both are summaries:

- **`accountCount` is the union** of the paying shifts' *paying* accounts (`creatorIds` less `overtimeCreatorIds`) — a `Set`, so a 4-account regular shift plus a 3-account overtime shift sharing two creators reads **5**, not 7.
- **`hourlyRate` is the hours-weighted blend** — `total wage ÷ total payable hours` whenever more than one shift pays. $3.50 and $4.50 across near-equal hours reads **$3.99**, a rate nobody was ever paid.

`wage` is unaffected: it comes from `wageFromShifts`, the sum of each shift priced at its own rate, **not** `hours × hourlyRate`. (The one exception is a day where `hours`, `hourlyRate` or `accountCount` is overridden — there the engine deliberately recomputes `hours × hourlyRate`, because an admin who edits hours should not have to restate the wage too.)

This is correct and it reads as an error, which is exactly how it was reported: *"5 accounts at $3.99/h"* on a day the agent worked 3 accounts of overtime and 4 of their own. **The fix is disclosure, not a different number** — a roll-up is still the right summary, and changing either column would break the reconciliation against `wage`.

[`SalaryDayTable`](../src/components/salary/SalaryDayTable.tsx) therefore **expands**: a chevron on the date opens one sub-row per shift (`SalaryShiftBreakdown`, already on the wire and already frozen into `ca-salary-months`), each carrying its own kind, window, creator chips, accounts, rate, hours and pay. Three details are load-bearing:

- **A blended rate is prefixed `~`.** One character, and it says "summary" before anyone multiplies by it. Suppressed on an overridden rate, which is an instruction rather than a blend.
- **Only days that hide something get a chevron** — more than one shift, an overtime shift, or in-shift cover. A chevron on all thirty rows is noise, and the one-row-per-calendar-date scan is what the table is for.
- **Gross, net, commission rate and commission are one `colSpan` on a sub-row, not four `—`s.** Commission is earned on the day's sales and genuinely is not attributable to one shift; four em-dashes would claim the shift earned nothing.

**A legacy in-shift cover shift (`paysWage: false`) gets a sub-row too**, reading `No extra pay`. It is otherwise invisible — the agent covered accounts and saw no change — and the row is where the §6 rule gets explained at the point someone asks. Cover now merges into the shift instead of creating one of these (§6), so on a current day the same disclosure is the `N overtime` note beside that shift's own chips; the row stays for the documents already written and for `forceInShift` assignments.

---

## 3. Overrides

An admin can replace any of eight fields on any day: `grossEarnings`, `hours`, `accountCount`, `hourlyRate`, `commissionPercent`, `commission`, `wage`, `salary`.

- Stored sparsely in `ca-salary-overrides/{userId}_{day}`, each with **who, when and why**.
- The engine recomputes everything **downstream** of an override unless the downstream field is itself overridden. Overriding `grossEarnings` therefore moves month-to-date gross and can re-tier **every later day**.
- Because of that, the override endpoints return the **recomputed month** and the client applies it wholesale. There is no optimistic patch, and there must not be — no client-side update can reproduce the ratchet.
- Every edited cell shows a pencil, its tooltip carries the calculated value, and reverting is a `DELETE`, not a restore.
- Writes use **dotted field paths** (`fields.hours`), so two admins editing different fields of the same day cannot clobber each other.

---

## 4. Sales import

The manual bridge until sales come from OF Manager. `POST /api/ca-salary/import`, multipart, `.xlsx`.

### Zero-dependency reader

[`xlsx.ts`](../src/lib/salary/xlsx.ts) parses the ZIP with Node's `zlib` and reads the sheet XML directly. It handles shared strings (including rich-text runs), inline strings, numbers, booleans, formula cells and **date-formatted numerics resolved through `styles.xml`**. It does not handle Zip64, encrypted workbooks or legacy `.xls` — each throws a named `XlsxError` the route surfaces verbatim.

### Idempotency

A sale's document id is a **SHA-1 of the facts that identify it**: when, who, which fan, which creator, how much, what type, its status, and an occurrence index that disambiguates genuinely identical rows within one file.

Re-uploading an overlapping export therefore rewrites the same documents instead of double-counting. The exports are cumulative, so this is the normal case, not an edge one. The response separates `imported` from `duplicates` so an admin can see a re-upload did nothing.

### Email mapping

The sales tool identifies agents by their old `@bluurock.com` addresses. Resolution order, first hit wins:

1. `SALES_EMAIL_MAP` → `users.workEmail` (via `normalizeEmail`, the same folding login uses).
2. The raw source address → `users.workEmail`, covering anyone not yet through the personal-email migration.

**An address that resolves to nothing is reported, never guessed.** `jessy@bluurock.com` appears in historical exports and is deliberately absent from the map — that agent has left, and her rows skip with a named, counted entry in the import report.

### Dry run

The admin screen always previews first (`dryRun=true`), showing per-agent gross for reconciliation against the source sheet and every skipped row grouped by reason. The skip list is the reason the preview exists — an agent whose rows silently vanish is an agent who is underpaid and nobody notices.

### Finalised months refuse rows

Rows belonging to an already-finalised agent-month are held back and the months are named. Reopen to accept them.

---

## 5. Month close

An admin with the **admin claim** finalises a month:

- Every derived figure is frozen into `ca-salary-months/{userId}_{month}`.
- Later sales imports for that agent-month are refused; no override can be written.
- **The agent is notified** (`salaryFinalized`) — see §11. Reopening is silent, deliberately.

Reopening keeps the frozen `days` — that is the record of what was paid — and appends to `history`. Again, nobody is notified automatically.

---

## 6. Coverage (the overtime marketplace)

```
  leave approved ─→ occurrence tombstoned ─→ one offer per released creator
                                                     │
                           agent claims ─────────────┤  (first-come, many claimants)
                                                     ▼
                           admin assigns ─→ overtime shift created ─→ offer assigned
```

An offer is **one creator on one date**, not one shift, so two agents can split an absence.

### Approving leave releases automatically

`POST /api/shifts/leave/[leaveId]/approve` calls [`releaseOccurrenceForCoverage`](../src/lib/services/leaveCoverage.ts), which tombstones the occurrence and posts one offer per assigned creator. The **release** itself still notifies nobody — the accounts appear on every agent's calendar and the board is the signal; it is the *assignment* that reaches a person (§11). Withdrawing approved leave reverses all of it — see §11.

It runs **after the commit and is non-fatal**: the leave was approved and the agent has been told, so a failure to release must not 500 and make an admin approve twice. The response carries the outcome, and the approvals UI surfaces `noAssignments` — a shift with no creators assigned releases nothing, which is not an error but *is* something an admin needs to know.

### A leave request is a pinned tuple, and the roster moves under it

A request records `(shiftId, occurrenceStart)` at the moment it is submitted. **Every admin edit path re-homes that occurrence onto a different document** while the request waits in the queue:

| Edit in `PUT /api/shifts/[shiftId]` | What happens to the occurrence |
|---|---|
| `saveMode: 'single'` | A **new override doc** holds it, carrying the new `creatorIds`; the root keeps the old ones |
| `saveMode: 'future'` | The series is truncated and a **new root** is created, with a new id |
| delete + recreate | A new document id entirely |

The release used to read `shifts/{leave.shiftId}` directly, which after any of those reads the **stale** document. That produced both halves of a real failure: accounts added in the edit never reached the overtime board, and the tombstone landed on a series that no longer expanded that date, so the shift stayed on the calendar after the leave was approved.

**Three things hold the line now, and they are one mechanism, not three patches:**

1. **`resolveLiveOccurrence`** ([leaveCoverage.ts](../src/lib/services/leaveCoverage.ts)) expands the roster around the pinned instant and matches, rather than trusting the id. What gets released and tombstoned is whatever the roster says that occurrence is *now*.
2. **[`matchLeaveToOccurrences`](../src/lib/utils/leaveMatch.ts)** is that match, and it is **shared** — the release, the admin week view, and the agent calendar all use it, so what an admin sees badged and what approval releases cannot disagree. It degrades in tiers (exact tuple → same series, same day → the day's only shift) and **refuses to guess** when a day holds more than one candidate: badging or releasing the wrong shift is worse than showing nothing, because it pays the wrong person.
3. **A tombstone beats an override** in [`expandShiftsForWindow`](../src/lib/utils/recurrence.ts). Edit-then-release leaves *both* documents on the same `(seriesId, date)`; overrides used to be included unconditionally, which kept a released shift on the roster.

**The release records where it landed.** `releasedShiftId` / `releasedOccurrenceStart` are written onto the leave document by the approve route, and `revertOccurrenceCoverage` restores **that** document. Restoring the pinned one instead would un-delete a shift nobody released and leave the released one tombstoned. Both fields are index-exempt (rule 9); requests approved before this shipped simply fall back to the pinned pair.

> **Do not "fix" this by storing a creator → agent map.** It was considered and rejected: a map keyed by agent answers *which accounts does this agent work*, while release needs *which accounts was this agent covering on this occurrence*. Those differ whenever a roster is not identical day to day, and the difference is money — a released account the absent agent was not covering that day still creates an offer somebody gets paid to cover. The assignment is already on the shift; derive it from there on read (rule 9f's posture, applied to rostering).

### The two kinds of overtime pay differently

| | Inside the agent's own shift | Outside it |
|---|---|---|
| Extra hours paid | No | Yes |
| Counts toward the wage tier | No | Yes |
| Keeps the sales | Yes | Yes |
| How it is stored | `overtimeCreatorIds` on the shift the agent already works | A real shift, `isOvertime: true` |

**An agent on 3 regular accounts who picks up 2 more during those same hours is still paid the 3-account rate.** Working a *second* shift outside their hours is the other case entirely, and there the overtime accounts do pay — two shifts in a day, each priced on its own accounts.

Outside-shift assignments **merge** into an overtime shift the agent already has for that window. Two one-account shifts would pay the 1-account rate twice instead of the 2-account rate once, which is both wrong and worse for the agent.

Three rules make that merge safe, and each was a way of paying the wrong number:

0. **The finders expand recurrence.** They used to run a bare `startTime` range query, and a recurring root's `startTime` is its *first* occurrence — so a weekly roster created in January was invisible to a query for a day in September. An agent on a recurring roster therefore looked like an agent with **no shift at all**: cover landed on a brand-new *paying* overtime shift stacked on the shift they were already being paid for, and the day billed **16 hours instead of 8** — $40 where $28 was owed. Both finders now read `getShiftsByUserAndRange` + `expandShiftsForWindow`, the same read `resolveLiveOccurrence` does, because what the roster says on a date is the expansion and never a document. `getShiftsByRange` carries a second query for exactly this reason; a bare query does not.
1. **"Overtime shift" is one predicate, `isOvertimeShift`, not a flag read.** `isOvertime` means *created from an offer* — a shift an admin built by hand in Shift Management has no offer to point at and is overtime because every account on it is marked. Both `findCoveringShift` and `findOvertimeShift` ask the one predicate, so the same situation cannot be in-shift cover on one path and a merge on the other. It was: a hand-built overtime shift paid $10 where a board-built one in the same spot paid $14.
2. **The merge matches an exact window first, then a *containing* one.** Exact-only was sufficient while every overtime shift was minted from an offer's own window. A hand-built one almost never matches exactly (18:00–22:00 against an offer released from 19:00–23:00), and a missed merge does not fail quietly — it creates a **second paid shift overlapping the first**, billing the same hours twice at two low rates. A *partial* overlap is still not merged: those hours are genuinely extra.
3. **The merge preserves which kind of overtime shift it is.** The invariant is *an overtime shift pays on all of its accounts*, and the two kinds express it in opposite ways — a board-built shift marks **none** of its accounts, a hand-built one marks **all** of them. So the new id joins `creatorIds` alone on the first and **both fields** on the second. Adding to `creatorIds` only would make a hand-built shift *mixed*, which stops its original accounts counting toward the rate: a 2-account shift at $2.50 becomes a 1-account shift at $1.50, and the agent is **paid less for being given more work**.

### In-shift cover joins the shift — it is not a second shift

Both doors now write the **same thing**: the account is added to the shift the agent already works, and marked in `overtimeCreatorIds`.

| Door | What it writes |
|---|---|
| **Coverage board** (CA Admin → Coverage) — an offer released by someone's leave | The released account joins the covering occurrence, marked overtime |
| **Shift Management** — an admin editing the shift directly | The admin marks accounts **Regular / Overtime** on the shift itself |

The board used to write **its own zero-wage shift** (`paysWage: false`) instead, for one stated reason: appending the creator to the agent's real shift would have raised that shift's account count and therefore its rate — the exact raise this case must not produce. **`overtimeCreatorIds` is precisely the mechanism that removes that objection.** Once it existed the parallel document bought nothing and cost the agent a duplicate card on their calendar for a shift they work once, so the board merges too.

> **`paysWage: false` is now legacy, and the engine must keep honouring it.** Documents written before the merge still exist, still price correctly (the engine excludes such a shift wholesale), and still render their own row. One live writer remains: `forceInShift: true` on an assignment where no shift can be found — an admin asserting cover inside hours the calendar cannot see. There is nothing to merge into there, so a zero-wage record is still the only way to say *worked, pays no hours*.

**The two doors price identically**, which is the whole point, and a merged cover pays exactly what the parallel document did: a 3-account shift covering a 4th reads **3 accounts at $3.50**, not 4 at $4.50.

**Merging into a recurring occurrence writes a per-occurrence override, never the series root.** The root's `creatorIds` are the assignment for *every* occurrence, so appending there would turn an account borrowed for one Tuesday into a permanent one. `addAccountToOccurrence` writes the same kind of override document a single-occurrence edit produces.

**Revert deletes a shift only when coverage created it** (`coverageOfferId` set), not when it has no accounts left. `assignedShiftId` now routinely points at the agent's *own* rostered shift, and the old "nothing left, drop it" rule would have deleted a working day nobody released. One decision function, [`detachAccountFromShift`](../src/lib/utils/coverageDetach.ts), shared by all three revert paths — `cancelOffer`, `unassignOffer` and `revertOccurrenceCoverage` — and deliberately kept free of Firebase imports so it can be tested.

**One exception, and it is the one that matters most: a shift where *every* account is marked overtime pays on all of them.** That shift is not free labour — it is the outside-hours case, a second shift in a day, and subtracting its whole assignment would hand an agent **$0/hour** for honestly marking their overtime shift as overtime. So the marking means two things depending on what sits beside it:

| Shift | Marked | Pays on |
|---|---|---|
| 3 regular + 2 overtime | a subset | the 3 regular — the agent keeps the sales, not a raise |
| 2 overtime, nothing else | all of them | all 2 — an overtime shift like any other |

In the second case the marking is **display only**, which is what it is for there: the agent opens their calendar and sees at a glance that this one is overtime. Both readings live in [`splitShiftAccounts`](../src/lib/salary/shiftAccounts.ts) — one function, because five surfaces ask this question and a second copy of it is a second answer to "what does this shift pay". A fully-overtime shift therefore reads as **Overtime** on the admin grid, the agent's calendar and the salary breakdown even though it carries no `isOvertime` flag; that flag means "created from a coverage offer", and a hand-built overtime shift has no offer to point at.

Three constraints on the field:

- **It is always a subset of `creatorIds`, enforced server-side.** `intersectOvertimeIds` runs on every write, because this set is *subtracted* from money: an id left behind after an account was removed from the picker would dock the agent a tier for work nobody does.
- **It is written only alongside `creatorIds`, never on its own.** The two are one fact — which accounts, and which of them pay — and letting them drift is how a ghost id survives.
- **It is empty on an overtime shift created from the coverage board.** Those carry `isOvertime` instead, and their accounts pay either way — the two routes agree by construction rather than by the admin remembering which one they used.

**Marked on both schedules.** An overtime account renders with an orange ring on its avatar — on the admin grid ([`ShiftCard`](../src/components/admin/shift-management/ShiftCard.tsx)) and on the agent's own calendar ([`ShiftCalendar`](../src/components/shifts/ShiftCalendar.tsx)) — beside a count (`+2 OT` / `2 overtime`) that says what the ring means. **On the calendar that count is a label, not a hover target**, and must stay one: a day cell is ~90px with the faces directly above it, so a hover card opens on top of the week and hides what the agent came to read. The only thing worth hovering in that cell is an avatar, and the only question a hover is asked there is *which account is that*. The explanation lives in the screen-reader text and, in full, on the salary breakdown, where there is room for it. The ring alone would be colour encoding nothing, which DESIGN.md §2 forbids; the count is also the figure a reader is actually after, since it is the *difference* between the faces they can see and the rate the shift is on. `CreatorChipList` orders paid accounts first so its `max` truncates the overtime ones rather than the ones that set the rate.

### One surface: the calendar absorbed three pages

Everything an agent does with their own roster happens on the dashboard calendar. Two surfaces were deleted as redundant once it could:

- **`/applications/time-tracking` → "Upcoming Shifts" tab** existed only to host leave requests. Requesting time off is something you do *to a particular shift*, so the control is a `CalendarX2` button on the shift itself — beside the creator accounts that approving it would release.
- **`/ca-portal/shifts`** (My schedule · Overtime · Time off) duplicated the calendar, the overtime board and the leave balance. Its `page.tsx`, `CoverageBoard`, `MyLeavePanel`, `useUserShifts` and its `ca-shifts` entry in `definitions.ts` are all gone.

What remains on the dashboard, in order: salary card → leave balance → calendar. The balance sits **above** the calendar because it is the constraint you read before picking a day to request off.

### The dashboard shows a week; the month is a dialog

The calendar has **two views off one cell renderer** ([`ShiftCalendar`](../src/components/shifts/ShiftCalendar.tsx), `view="week" | "month"`), and the dashboard leads with the **week**:

- `view="week"` draws **seven full-width rows**, one per day, with its own **‹ › arrows** and a "This week" reset.
- **Full Schedule** (the one prominent button on the panel) opens [`FullScheduleDialog`](../src/components/shifts/FullScheduleDialog.tsx) — the same component with `view="month"`, `bare`, and a `MonthPicker` in the dialog header, at `sm:max-w-5xl`. The month is still a **7-column grid**.

**The week is rows and the month is a grid, and the split is the point.** Every hard constraint the old seven-column week imposed traced back to one number — a day cell is ~90px — which forced avatars without names, pushed all three overtime pay explanations into tooltips and `sr-only` text, truncated the start time, and drove pay-relevant labels to 10px, below the smallest step DESIGN.md allows to carry real content. A week has only seven days and the full panel width, so a row gives each one ~700px: names render, the pay consequence is visible prose, and the leave button rests visible instead of appearing on hover. The month keeps the grid because it is read for **shape** ("which weeks am I heavy") rather than for detail.

Three things about this are load-bearing:

- **It is still one component, and the shift body is still one renderer.** [`ShiftEntry`](../src/components/shifts/ShiftCalendar.tsx) takes a `dense` flag — avatars and 11px type for the grid, names and readable type for the row — and `OfferCell` and `LeaveBadge` are shared unchanged. `dense` is the *only* thing any of them branch on. That preserves what the original single-cell renderer was protecting (one definition of leave, in-shift cover and the claim popover) while letting the two layouts differ in the one way they genuinely do. **A change to what a shift means goes in `ShiftEntry`, never in a layout branch.**
- **The week arrows have no forward cap, and the dialog's `MonthPicker` has a raised one** (`latest`, 12 months out). The picker's default ceiling is the current month because a future *salary* month has no data by definition — a roster is the opposite, it is published ahead. Money surfaces keep the default; this is the only caller that raises it.
- **The overtime layer is fetched for the visible range**, not for a rolling window around today. `useCoverageOffers` defaults to `today-1 → today+45`, which was right while the only view was the current month and wrong the moment the arrows can leave it — a week three arrows out would draw the roster and silently claim no cover was going spare.

A week is also the only view that can **straddle a month boundary**, which is why [`useShiftCalendar`](../src/hooks/useShiftCalendar.ts) takes a *list* of months and merges them on `(shiftId, occurrenceStart)` (the padded windows of two adjacent months overlap). It still fetches and caches whole **months** rather than the seven days asked for: scrolling through September is then one request rather than five, and the dialog's month view reuses the entry the week view already warmed (rule 9).

### Keeping the dashboard current — one surface, one staleness policy

The calendar caches the roster in `sessionStorage` for two minutes; the overtime layer beside it caches **nothing**. Left alone, that asymmetry is visible as a bug: approving leave put the released accounts on the board instantly while the shift they came from stayed on the calendar. Same panel, same second, two answers.

Three rules keep them in step, and a new surface that changes a roster has to honour them:

1. **A write invalidates what it changed.** [`invalidateShiftCalendarCache(uid)`](../src/hooks/useShiftCalendar.ts) and [`invalidateLeaveRequestsCache(uid)`](../src/hooks/useLeaveRequests.ts) are exported for callers **outside** these hooks, because the writes live elsewhere: leave is approved from the CA admin queue (`useAdminLeaveQueue`) **and** from a card on the shift-management grid (`ShiftCard`) — two call sites, both of which must invalidate, and the second is the one that gets forgotten. Withdrawing approved leave invalidates too: it puts the occurrence *back*.
2. **`sessionStorage` is per-renderer, so invalidation only reaches the acting user's own tab.** That is what fixes approving your *own* leave. It can do nothing for the absent agent's dashboard, which is what rule 3 is for.
3. **The calendar revalidates on `focus` / `visibilitychange`.** Without it the roster is read once per mount and never again, and this renderer stays open for weeks (rule 9c) — an admin's schedule edit reached a dashboard that had been sitting on its answer since it was opened. The handler calls `load()`, not `load(true)`: a hit inside the TTL costs nothing, so the refresh is free for someone alt-tabbing and is one request for someone returning later. Staleness is bounded by the TTL rather than unbounded.

**The dashboard has no month picker any more, and must not regain one.** It used to have one governing the page, because a picker that moved only the calendar could put August's roster above September's pay with both labels correct and nothing saying the two scopes differed. That risk is gone by construction rather than by coordination: the schedule navigates itself, and `SalarySummaryCard` renders the current unfinalised month — the only month a dashboard summary should mean. History has its own picker on `/ca-portal/dashboard/salary`.

> **A dashboard card must not link to a page the viewer may not hold.** The leave balance briefly linked to `/ca-portal/shifts`; `ca-dashboard` and `ca-shifts` are granted separately, so for anyone without the second one `AppLayout` redirected the click to the home page. It is now plain information with no link at all.

### A failed read is a state, never an empty list

Three surfaces on this dashboard render facts the agent acts on, and each hook builds a real error message. **Dropping one at the destructure turns a failure into a confident negative**, which on this dashboard costs money or a day off:

- **Overtime.** `useCoverageOffers` exposes `error`; ignoring it rendered *"No overtime available this week. Accounts appear here when someone's leave is approved."* for a request that failed. The board is first-come, so that is an agent losing a claim to a network error nobody told them about.
- **Leave.** `useLeaveRequests` exposes `error`; ignoring it dropped every "Off — pending" badge from the grid **and** re-enabled the request button on a shift already booked off (the API then 409s). `ShiftCalendar` now reports it once for the whole grid and withdraws the leave button while it is true — *unknown* must not render as *none*.
- **The balance card.** `LeaveBalanceCard` shows the same error with a retry rather than silently rendering no pending count and no decisions.

The correct shape already existed in the same file — `useShiftCalendar`'s error branch with its `Try again` — and is what all three now match.

### The agent is never told a leave decision, so the dashboard has to say it

There is **no notification for leave approved or denied** (§11) — the approver hears about the request, the agent never hears the answer. Before this, the only rendering of an outcome was the badge on that shift's calendar cell, which may be weeks out and invisible in the default week view: an agent could be denied a day and find out by not being on the roster.

`DecisionPills` in [`LeaveBalanceCard`](../src/components/shifts/LeaveBalanceCard.tsx) is that missing channel. Every request resolved in the last **14 days** shows as a pill naming the date and the outcome in words, until dismissed. Dismissal is `localStorage`, not a Firestore write — it is an acknowledgement, not a fact anyone else needs — and every access is wrapped, because a browser that refuses storage must still show the pill rather than hide the only place a denial appears. **If a leave-decision notification is ever added, this is the thing to reconsider, not to duplicate.**

### Overtime lives on the calendar, not beside it

The agent-facing board is a **second layer inside `ShiftCalendar`**, not a section of its own. Their own shifts are primary — filled cell, solid time, full-size avatars, always first in the cell; available cover is secondary — no fill, a dashed rule above it, an orange dot, dimmed faces. The ordering is load-bearing: a board that competes with the real roster is one people misread on a Monday morning.

It also answers the question a separate board could not — *can I actually take this?* An offer on the 14th sitting under the shift you already work on the 14th makes "inside my shift" versus "a second shift that day" visible without arithmetic, which is exactly the distinction that decides whether it pays hours.

Claiming happens in a popover off the day cell: a month cell is ~90px and the decision needs the creator, the window, whose absence it is, and who else is already in. There is no separate list view — `/ca-portal/shifts` and its `CoverageBoard` were deleted once the calendar could do everything they did.

### Limits, enforced server-side

- **5 accounts** during the agent's own shift, **4** outside it. The check counts what they are already committed to **plus everything else they have claimed for that day and not yet been assigned** — otherwise five separate claims each pass individually and blow the cap the moment an admin approves them.
- **1 day's notice** to claim overtime. Enforced.
- **4 days' notice to request leave is stated, not enforced.** Leave can be requested right up until the shift starts; the only hard boundary is a shift that has already begun. Blocking a late request would push an agent who is ill tomorrow into telling someone off-system, where no admin can see it — the approvals queue shows how much notice each request actually carries ("in 1 day") and an admin decides. The UI states the expectation in both places it appears.
- Paid leave requires a stated reason; unpaid does not.

### Leave balances — the entitlement, and who spends it

**[`src/lib/leave/leaveBalance.ts`](../src/lib/leave/leaveBalance.ts) is the only place the allotments are written down, and `resolveLeaveBalances` is the only sanctioned way to read a balance off a user document.** Both matter: the numbers were previously spelled out at six call sites, and two of them disagreed — `AdminLeave` and `UserDetailContent` read a missing balance as `4`/`10` while the request route, `LeaveBalanceCard` and `RequestLeaveDialog` read the same missing field as `0`. An admin and the agent saw different numbers for one person. `resolveLeaveBalances` also gates the paid figure on `hasPaidLeave`, because `remainingPaidLeave` holds `10` whether or not the entitlement is switched on.

- **Unpaid: 4 days, reset on the 1st of each month.** **Paid: 10 days, reset on 1 January**, for users with `hasPaidLeave`. A reset **assigns** the allotment — balances do not carry over.
- **The period boundary is `Africa/Harare`**, the same as §7's salary day, so a day off cannot land in one month's roster and spend another month's balance. The period keys come from `salaryDate.ts` for exactly that reason.

**Approval spends the day. Requesting does not.** This was the other way round and was wrong in three ways: a request an admin never got to held the balance hostage indefinitely, a denied request needed a refund to undo a charge it should never have made, and requesting-then-withdrawing refunded a day that was never spent. Now:

| Transition | Balance effect |
|---|---|
| Request created | none — but the request counts against what is left |
| Approved | **−1**, in a transaction |
| Denied | none |
| Approved leave withdrawn | **+1**, capped at the allotment |
| Pending or denied request withdrawn | none |

- **The request gate is `remaining − pending`, not `remaining`.** Since a request no longer spends anything, the balance alone is not what an agent has left to commit; four pending requests against four days is fully spent, and checking only the balance would let them queue a fifth.
- **Every mutation is a `runTransaction`, reading the user document inside it.** The old code paired an unrelated read with a blind `FieldValue.increment(-1)`, so two requests landing together both saw "1 left" and both decremented — a balance that could go negative.
- **An approval against a zero balance is refused (409), never clamped.** Approving leave an agent cannot afford is a payroll decision: it either grants a day the company did not, or (clamped) records an absence against a balance that never moved. The message names the fix — raise the balance in CA Admin → Leave — so the override leaves a trail.
- **The withdrawal refund is capped at the allotment**, so a day approved in March and withdrawn in April cannot push the new month above four.
- **Both approval call sites must surface the refusal.** `useAdminLeaveQueue` and `ShiftCard` both POST to the approve route (§6 — `ShiftCard` is the one that gets forgotten). `ShiftCard` used to ignore the response entirely, which would have made a refusal look identical to a successful denial.

**The reset is a daily cron with a stored marker, not a job scheduled for the 1st.** [`/api/cron/leave-reset`](../src/app/api/cron/leave-reset/route.ts) runs every day at 22:30 UTC (00:30 Harare) and resets a user when their `unpaidLeaveResetMonth` / `paidLeaveResetYear` stamp is not the current period. A date test would make correctness depend on the job firing on one specific day — a missed run silently skips a month for everyone, which is the failure the whole mechanism exists to prevent. The marker makes it **idempotent** (a second run the same day writes nothing) and **self-healing** (a run missed for three days catches up on the fourth). A user with no stamp and an existing balance is *stamped without being reset*, so the first run after deploy does not undo an admin's hand-set value. Both marker fields are index-exempt (rule 9); the cohort is `permittedPageIds array-contains 'time-tracking'`, which needs no new index. It notifies nobody, deliberately — see the route's own comment.

---

## 7. Timezone

**`Africa/Harare` (UTC+2, no DST) is the salary day boundary for every agent**, regardless of where they live. The export is stamped in it and the roster is managed in SAST. One company-wide boundary is what makes a month reconcile exactly against the source sheet and stops a sale landing on a different day than the shift that earned it.

[`salaryDate.ts`](../src/lib/salary/salaryDate.ts) uses **fixed-offset arithmetic**, which is exact here and nowhere else. **Do not copy those helpers to a timezone that observes DST** — they would silently mis-bucket two days a year.

Displayed *clock times* still render in the viewer's own timezone. Only the bucketing is fixed.

### Never hand a raw timezone to `Intl`

`ensureUserExists` seeds `timezone: ''`, and only the onboarding profile step fills it in — so **an empty string is a normal state**, not corruption. `??` does not catch it (`''` is not nullish), and `Intl.DateTimeFormat` rejects it with `RangeError: Invalid time zone specified:` rather than ignoring it. That crashed the CA dashboard for a user who had never set one.

Two rules, and both are load-bearing:

- **Resolve at the source.** Client surfaces read `useViewerTimezone()`; server code calls `safeTimezone(...)`. Never `userData?.timezone ?? 'UTC'` — it looks correct and is not.
- **Defend at the leaf.** Every formatter that takes a timezone and passes it to `Intl` calls `safeTimezone` itself, so no caller can crash it. Defence in depth, because these helpers are reached from many surfaces.

`useViewerTimezone` also returns `isConfigured`, which drives [`TimezoneNotice`](../src/components/TimezoneNotice.tsx) — mounted app-wide in `AppLayout`, because a user with no timezone reads *every* time in the product in UTC and nothing else would say so.

---

## 8. Collections

| Collection | Doc id | What |
|---|---|---|
| `ca-sales` | content hash | One imported sale row |
| `ca-sales-imports` | auto | Audit record for one upload |
| `ca-salary-overrides` | `{uid}_{YYYY-MM-DD}` | An admin's edits to one day |
| `ca-salary-months` | `{uid}_{YYYY-MM}` | Frozen payout record |
| `ca-salary-config` | `current` | The rate tables |
| `ca-coverage-offers` | `{shiftId}_{start}_{creatorId}` | One account needing cover |
| `ca-coverage-notices` | `{kind}__{uid}__{day}` | Coalescing queue for the two coverage notifications (§11) |
| `ca-coverage-withdrawals` | `{leaveId}` | A cancelled absence, for the Coverage band (§11) |
| `ca-salary-tier-notices` | `{uid}_{month}` | The commission band an agent was last told about (§11) |
| `ca-notification-latches` | `payday-{month}` | Once-a-month guard on the payday reminder (§11) |
| `creator-subaccounts` | auto-id | A creator's secondary account, assignable as a peer |

**All of it is Admin SDK only, in both directions.** This is the only subsystem where a client-side read would expose one employee's pay to another. Every figure is assembled server-side by `/api/ca-salary/*`, which resolves the subject from the verified token and **never from a query parameter**.

`ca-coverage-offers` is closed too even though the board is meant to be seen by every agent: the API does something a rule cannot, which is strip the other claimants' identities for non-admin readers.

New fields on `shifts`: `creatorIds`, `overtimeCreatorIds`, `isOvertime`, `coverageOfferId`, `paysWage`. Only `creatorIds` is queried (one `array-contains`, by the sub-account delete guard); the rest are index-exempt (rule 9). `leave_requests` gained `releasedShiftId` / `releasedOccurrenceStart` (§6) on the same terms.

---

## 9. Authorization tiers

Three, deliberately not two (rule 3):

| Tier | Gates | Why |
|---|---|---|
| **Self** | An agent reading their own month | The whole point. Never widened by a query parameter — a missing `userId` means "mine", not "everyone's". |
| **`ca-admin` page permission** | Importing sales, editing a day, assigning cover | Day-to-day payroll a CA manager runs without being a system admin. |
| **Admin claim** (`token.admin`) | Rate tables, finalising and reopening | Policy and money-locking. A rate change silently restates every open month; finalising decides what was paid. Neither should ride on a permission granted in two clicks on the Sharing page. |

Helpers: [`salaryAuth.ts`](../src/lib/salary/salaryAuth.ts).

---

## 10. Where things live

**Page split is by object, not by team.** Shift Management keeps shift CRUD and gains creator assignment on the shift itself — it already owns the calendar, the modal and recurrence. CA Admin owns money and the absence pipeline.

```
/admin-portal/shift-management
  Shifts        ← creator chips on each card + the picker in the modal,
                  each account marked Regular or Overtime (unpaid, in-shift)
  Active Users · Timesheets · Screenshots · Leave (balances) · Analytics

/ca-portal/admin            (tabbed)
  Overview      the month above the roster — agent × creator matrix,
                creator leaderboard, payroll share, attention band
  Salaries      roster → one agent's editable month
  Sales data    .xlsx upload with dry-run preview, import history
  Coverage      leave approvals → offer board → assign
  Rates         tiers, wage table, grace, deduction, rate basis
  Disputes      (existing, unchanged)

/ca-portal/dashboard        salary card · leave balance · shift calendar
                            (own shifts + overtime + request leave)
/ca-portal/dashboard/salary Overview · Daily breakdown · Sales report
```

### The Overview tab

The **first** tab of CA Admin and its landing view. Payroll answers "what do I pay this agent"; Overview answers the two questions that only exist one level up — **which creators the money came from**, and **whether any of it rests on one person**. It is the individual sales report's `By creator` breakdown lifted to the whole roster, which is the read that breakdown could never give: an agent's own top creator says nothing about whether that creator has anyone else on them.

Four parts, in reading order:

- **Header strip** — gross, payroll cost, **payroll share of gross**, hours, agents earning. Payroll share is the only figure on this surface that appears nowhere else, and it is why the strip earns its space: gross and payroll each mean something only next to the other.
- **Attention band** — the ways a month is quietly wrong, rolled up across the roster: days with sales but no shift, agents with no sales at all, creators with exactly one agent earning on them, creators that earned last month and nothing this month, and admin-edited days. Takes the *attention needed* tint and **no motion** (DESIGN.md §5). Each line **names its rows**, not just a count. It states plainly when there is nothing to check — a check that vanishes when it passes is indistinguishable from one that never ran.
- **Agent × creator matrix** — gross per intersection, shaded against **one scale shared by the whole grid** so a cell reads both along its row (this agent's earners) and down its column (who carries this creator). Per-row scaling would destroy the second read, which is the one not available anywhere else. Ten creator columns, the rest folded, expandable. The agent column is sticky; the grid scrolls sideways at the 1024px floor and a matrix whose row labels scroll away is unreadable.
- **Creator leaderboard** — gross, share, sales, **agents covering**, and the month-over-month move. A creator at 30% of the month with one agent on them is a very different fact from the same 30% split four ways.

**The agent sub-label is a roster fact, not a sales one.** Under each name in the matrix sits how many accounts that agent *works* — `accountCount`, the distinct `creatorIds` across their own shifts for the month. It used to be `Object.keys(byCreator).length`, the number of creators that produced sales, which reported an agent on four accounts as "1 creator" in a month where one of them sold. The bars along the row already say which creators earned; the sub-label is the denominator you read them against, so it must not be the same number.

Three things about how it counts:

- **Ids, never grouped.** A sub-account is an assignable peer and counts as one account toward its assignee (rule 9h). The creator and sub-account id spaces are disjoint, so a `Set` of ids is the whole implementation — do not fold sub-accounts under a parent before counting, and do not weight one as a fraction.
- **Cover is named separately** (`coverAccountCount`, rendered as `+N covered`), because an overtime shift or in-shift cover is somebody else's account for a day, not part of this agent's standing roster — the same split the wage engine makes (§6). An account both covered and held counts once, as held.
- **Month-scoped.** An account added mid-month is included. That is the honest answer on a surface whose every other figure is a month.

Three calls worth not re-litigating:

- **Month-over-month is gross, never payroll.** A payroll comparison needs a second `buildSalaryMonthForUsers` — six more queries — for a figure nobody reconciles against. Gross costs one extra query for the previous month's sales.
- **Deltas carry no hue.** A fall is information, not an error state; colouring every row green-or-red spends the palette on the ordinary case, exactly as `signedMoneyClass` already argues. The few movements that need acting on are escalated into the attention band.
- **The matrix shades, the leaderboard bars.** Both ramp from the same Action Blue token against the same kind of shared scale. A bar inside an ~80px matrix column degenerates into a two-pixel sliver beside a right-aligned number, so the matrix uses a tint; the leaderboard's rows are wide enough to keep the sales report's bar-behind-the-row idiom.

**Read budget.** `GET /api/ca-salary/overview` reads the month's sales **once** and passes them to `buildSalaryMonthForUsers` via its `salesByUser` option, which would otherwise query them again — so the matrix and the totals are built from the same rows, cannot disagree, and cost one query between them. The previous month adds exactly one more query, for sales only. Creator photos cost nothing: the client joins the roster from `useCreators` (a module-level shared store) on the **folded stage name**, since sales carry a creator *name* typed into the export, not a creator id. A name that matches no creator still renders — `CreatorAvatar` hashes its initials colour from that same string (rule 7), so an unrecognised creator looks like a creator rather than a rendering failure.

**A finalised month shows live revenue against frozen payroll, on purpose.** Its `totals` come from the snapshot while its sales rows stay live, so a late import moves the revenue columns and not the payroll ones. That is the honest pairing — the header strip says how many months are frozen.

**One month governs each page, and so does one day.** In CA Admin the month is owned by **the page**, not by either panel, and Overview and Payroll share it — they are read together, and a month that only moved on one of them is how a figure gets quoted from the wrong one. The dashboard's `MonthPicker` drives the salary card *and* the calendar; on `/salary` the month lives in `?month=YYYY-MM` so a link can point at one. A month change also **clears the inspected day** — the day picked from the Daily breakdown to filter the Sales report. Left alone it outlived its month and the tab requested September's sales for a day in August: an empty list under a banner naming the August date. Any new control that changes the month has to clear it too.

**`SalesReport` is cached and capped.** Radix unmounts an inactive `TabsContent`, so every visit to the Sales tab used to be a full re-fetch of the month's transactions; it now reads through `queryCache` on the same 60s TTL `useSalaryMonth` uses, and a write (a payroll delete) forces past it. The table renders the first 150 rows with a "show the rest" step, filters through `useDeferredValue`, and both tabs' scroll containers are focusable, named regions — a table that only scrolls under a pointer is a WCAG 2.1.1 failure, and at the 1024px window floor the rightmost column is off-screen.

### Key files

| File | What |
|---|---|
| [`salaryEngine.ts`](../src/lib/salary/salaryEngine.ts) | The whole calculation. Pure. |
| [`salaryDate.ts`](../src/lib/salary/salaryDate.ts) | Day/month keys in the salary timezone |
| [`salaryConstants.ts`](../src/lib/salary/salaryConstants.ts) | Defaults + the email map |
| [`xlsx.ts`](../src/lib/salary/xlsx.ts) | Zero-dependency workbook reader |
| [`salesImport.ts`](../src/lib/salary/salesImport.ts) | Rows → sales + skip report |
| [`caSalaryService.ts`](../src/lib/services/caSalaryService.ts) | Firestore + the assembler |
| [`caCoverageService.ts`](../src/lib/services/caCoverageService.ts) | Offers, claims, assignment |
| [`leaveCoverage.ts`](../src/lib/services/leaveCoverage.ts) | Leave approval → release, and withdrawal → revert. `resolveLiveOccurrence` re-resolves a pinned request against the live roster first — see §6 |
| [`leave/leaveBalance.ts`](../src/lib/leave/leaveBalance.ts) | The leave allotments, the one sanctioned balance reader (`resolveLeaveBalances`), the reset period keys, and the pure `computeLeaveReset` the cron applies — see §6 |
| [`leaveMatch.ts`](../src/lib/utils/leaveMatch.ts) | The tiered leave ↔ occurrence matcher, shared by the release, the admin week view and the agent calendar |
| [`caNotifications.ts`](../src/lib/services/caNotifications.ts) | Recipients, delivery, the tier gate and the payday latch |
| [`coverageNotices.ts`](../src/lib/services/coverageNotices.ts) | The coalescing queue and the withdrawal record |
| [`AdminOverview.tsx`](../src/components/ca-admin/AdminOverview.tsx) | The Overview tab — the matrix, the leaderboard and the attention band |
| [`CommissionLadder.tsx`](../src/components/salary/CommissionLadder.tsx) | The stepped scale, drawn as steps |
| [`SalaryDayTable.tsx`](../src/components/salary/SalaryDayTable.tsx) | The month grid, read-only and editable |
| [`useLeaveRequests.ts`](../src/hooks/useLeaveRequests.ts) | **Module-level shared store**, like `useCreators`. The CA dashboard mounts it twice by design (balance card + calendar); per-instance state meant two identical requests on mount and a badge that went stale while the calendar beside it refreshed. Exports `invalidateLeaveRequestsCache` for writers on other surfaces — see §6. |
| [`useShiftCalendar.ts`](../src/hooks/useShiftCalendar.ts) | The agent's own roster, cached per month and revalidated on window focus. Exports `invalidateShiftCalendarCache` — see §6. |
| [`CreatorChip.tsx`](../src/components/creators/CreatorChip.tsx) | **The house pattern for showing a creator** — `Avatar` + profile picture, initials fallback seeded from the stage name |
| [`creatorAccountService.ts`](../src/lib/services/creatorAccountService.ts) | Creators + sub-accounts as one assignable list; validates ids across both collections |
| [`useCreators.ts`](../src/hooks/useCreators.ts) | Module-level shared store behind every creator chip — one fetch, one parse, one `Map` per page |

---

## 11. Notifications

**They are in.** Eight events notify, restored after the deliberate pre-launch silence — the figures have been trusted long enough to tell people about them. Copy lives in `notificationContent.ts` and the catalogue in `automatedNotifications.ts`, under the `Coverage` and `Salary` categories (cross-cutting rule 15); the full event → factory table is in [notifications.md](notifications.md#notification-events--factory-functions).

| Event | Who is told | Gate |
|---|---|---|
| Leave requested | One named approver | — |
| Approved leave withdrawn | One named approver | Only for leave that was **approved** — a pending request nobody acted on changes nothing |
| Overtime assigned | The assignee | **Coalesced** per agent per day · fires from **both** assignment routes |
| Overtime cancelled | Each agent who was covering | **Coalesced** per agent per day |
| Sales imported | Every chat agent | Only a real import that wrote rows |
| Payday in 3 days | Every chat agent | Once per month, latched |
| Salary finalised | That agent | — (reopening notifies nobody) |
| Commission tier reached | That agent | Once per band per month, and only upwards |

Five decisions inside that table are load-bearing.

**The leave alerts name one uid.** `CA_LEAVE_ALERT_RECIPIENT_UID` in [`caNotifications.ts`](../src/lib/services/caNotifications.ts), one definition, the same carve-out from "never hardcode a uid" as the OF Manager diagnostics. Leave approval is one person's queue; every admin hearing about every request is noise.

**Coverage notifications are coalesced, and the delay lives in a cron.** One absence releases every creator the agent was covering, and an admin assigns them one at a time — so an assignment **queues** into `ca-coverage-notices` (one doc per `kind`+agent+day, names merged with `arrayUnion`) and `/api/cron/ca-notifications` sends it once the queue has been quiet for 3 minutes, then deletes it. Assigning four accounts to one agent produces one message naming four creators. There is no "sent" flag: a notice either exists (owed) or does not (delivered). The delay cannot sit inside the request — a serverless function is not going to still be there in three minutes, and a message that never arrives is worse than one eight minutes late.

**Both doors to overtime send it, not just the board.** Assigning released accounts on the Coverage board queues the notice, and so does an admin marking accounts **Overtime** on a shift in Shift Management — `queueOvertimeAssignedForShift` in the same file, called by `POST /api/shifts` and `PUT /api/shifts/[shiftId]` after the write and non-fatally. For a long time only the first did, so an agent given overtime by a roster edit was never told and found out by looking at their calendar, if they looked. Three things make the second route safe to add:

- **It sends only what is *newly* overtime**, diffed against the marks the shift already carried. Without that, moving a shift by an hour re-announces cover the agent was told about last week, which is how a notification becomes one people mute.
- **A shift reassigned to a different agent announces all of them.** The diff is against the *document*, and the previous holder's marks say nothing about what the new person knows.
- **It shares the queue**, so a board assignment and a roster edit landing on the same agent and day merge into one message rather than racing to send two.

Its one honest limitation: a **recurring** shift is announced by its first occurrence's date, because the copy names a single date. That understates a standing arrangement rather than misstating it, and the message already sends the agent to their calendar. There is deliberately **no** counterpart when an admin *un*-marks an account — `overtimeCancelled` states that the absent agent withdrew their leave, which would be a lie here, and inventing copy is a decision rather than a fix (rule 5).

**Reopening a month is silent on purpose.** Finalising says "your salary is on the way", which is the thing the agent has been waiting to hear. Reopening is an admin correcting something mid-flight, and telling an agent their locked month has come unlocked — before anyone knows what it will settle at — invites a question nobody can answer yet. The finalise that follows is the message.

**The tier notice needs memory, because salary is derived.** Recomputing a month says what band an agent is *on*, never what band they were last told about, so `ca-salary-tier-notices/{uid}_{month}` holds that. First sight of an agent-month writes a **baseline** rather than announcing one, or the 1st of every month would greet everyone with "you are now earning 2.5%". Only an increase notifies; a band that falls (a large reversal dated mid-month) lowers the stored mark silently, so re-crossing notifies again. It fires from the sales import — the one thing that moves a whole roster's gross at once — and from the override endpoints, which already recompute the month.

### Withdrawing approved leave

The mirror image of the release, in [`revertOccurrenceCoverage`](../src/lib/services/leaveCoverage.ts). `DELETE /api/shifts/leave/[leaveId]` on an **approved** request has to undo three things, in this order of importance:

1. **The overtime someone else was assigned goes away**, with the shift that pays for it — the one write here that touches money. Leaving it would pay two people for the same accounts on the same day. An overtime shift carrying several merged offers loses the creator, not the shift, until the last one goes.
2. **The offers leave the board**, *deleted* rather than marked `cancelled`. Offer ids are derived from the occurrence, so re-approving the same leave has to be able to post them again and `createOffersForOccurrence` writes with `merge: false`.
3. **The original occurrence comes back** with the creator assignment it always carried — the tombstone override is deleted for a recurring series, `isDeleted` is lifted for a one-off. Nothing ever removed `creatorIds` from that shift, so restoring the occurrence restores the assignment.

The offers are found by the indexed `day` equality and filtered on `leaveId` in memory: `leaveId` is index-exempt (rule 9) and a day holds a handful of offers, so buying an index for it would be the wrong trade.

All of it runs **after** the withdrawal commits and is non-fatal, the same shape as the release on approval — the agent asked to cancel, the cancellation succeeded, and a board that could not be tidied must not surface as "could not cancel your leave".

**Because the offers are deleted, the Coverage tab needs a record.** `ca-coverage-withdrawals/{leaveId}` holds who withdrew, the day, every account that came off the board, and each agent whose overtime was taken back with what they lost. `GET /api/ca-coverage/offers` serves it to admins only (it names people, which is roster information rather than board information) and `AdminCoverage` renders it as an interrupt band on the DESIGN.md §5 recipe — attention tint, static dot, no motion. It names the reverted agents in full rather than counting them: "2 reverted" does not tell an admin whether to go and speak to anyone.

### Collections added

| Collection | Doc id | What |
|---|---|---|
| `ca-coverage-notices` | `{kind}__{uid}__{day}` | A coalescing queue waiting for its quiet period. Deleted on send. |
| `ca-coverage-withdrawals` | `{leaveId}` | A cancelled absence — the Coverage tab's band |
| `ca-salary-tier-notices` | `{uid}_{month}` | Which commission band the agent was last told about |
| `ca-notification-latches` | `payday-{month}` | The once-a-month guard on the payday reminder |

All four are Admin-SDK-only (`allow read, write: if false`) and every field on them is index-exempt except `ca-coverage-withdrawals.withdrawnAt`, which the band orders by.

---

## 11c. Admin Overview: sales names vs creator ids

`GET /api/ca-salary/overview` is the one place in this subsystem that has to join **sales** to **shifts**, and the two do not share a key. A sale carries a creator *name* typed into the `.xlsx` export ([`salesImport.ts`](../src/lib/salary/salesImport.ts) trims the `Creator` column and stores it verbatim); a shift carries `creatorIds`, real creator document ids. Anything spanning both needs `buildCreatorIdResolver`.

The export's names are also routinely shorter than the roster's stage names — "Liam" for Liam Heng, "Adam" for Adam Horváth, "Cole" for Cole Bentley — so an exact folded match resolves only some of them. The resolver takes an exact match first, then a **word-boundary prefix**, and **only when exactly one creator matches**: "noah" is a prefix of both Noah Green and Noah Ryder, and guessing there would attribute one creator's coverage to another. Ambiguous or unmatched resolves to `null`.

**The distinction the `attention` findings turn on.** `agentCount` counts agents who *recorded a sale* on a creator — a revenue fact. `assignedAgentCount` counts agents *rostered* onto them — a coverage fact. The solo-coverage finding once used the first while claiming the second, and reported "nobody to fall back on" for a creator three agents were working, because only one of them had closed a sale that month. At low revenue that check inverts entirely: it fires hardest on the accounts where a lone seller means least. It now reads shift assignments.

**The Creators-by-revenue table names both facts, in two columns.** `Sellers` is `agentCount`, `Cover` is `assignedAgentCount`, and the `Sole cover` chip beside the creator's name fires on the second. They were one "Agents" column and a `One agent` chip reading the sales number, which is how the table came to contradict the finding above it. Do not collapse them again — they disagree routinely, and the disagreement is the useful part.

`assignedAgentCount` is `null`, not `0`, when coverage cannot be read — the name matched nothing, or no shift that month carried an assignment (`creatorIds` is absent on every shift created before assignment existed, which is also why the engine has an inferred-account-count fallback). Those creators are **omitted from the solo finding and reported in `unmeasuredCreators`** instead. Assuming they were uncovered would manufacture exactly the false alarm this replaced; omitting them silently would give a coverage check that skips rows and still looks complete.

---

## 11b. Creator avatars: format, caching and render cost

Avatars went from a handful of rows to **every cell of the shift calendar**, which turned two latent inefficiencies into real ones.

**The format.** Every creator avatar is a **256px WebP**, encoded server-side by [`creatorPhotoService`](../src/lib/services/creatorPhotoService.ts) — the single place that decides how one is stored. Whatever an admin uploads is decoded by `sharp`, EXIF-rotated, square-cropped (`fit: 'cover'` — an avatar is drawn in a circle, so cropping at encode time means no pixel is downloaded to be thrown away), and re-encoded. A phone JPEG drops from megabytes to single-digit KB.

**The thumbnail, and why avatars no longer hit the network.** Each upload also produces a **64px WebP as a `data:` URI**, stored on the creator doc as `photoThumb` and returned inline by `/api/creators`. This is the fix for "creator avatars take forever and sometimes never load", and the diagnosis is worth keeping: the bytes were never the problem. Thirty avatars on a shift calendar were thirty separate cross-origin requests to `firebasestorage.googleapis.com` — a host that is **not a CDN** and validates the `?token=` on every request — so the cost was thirty round trips of *latency*, and thirty independent chances to fail. Inlining the thumbnail removes the request class entirely: the face arrives in the same payload as the name and paints in the same frame.

64px is chosen, not rounded: the largest place the shared roster is rendered is `size-8` (32px, the creator-management table) and every other call site is 16–24px, so 64 covers the biggest of them exactly on a 2× display and is never upscaled. Quality is 68 rather than 88 — these bytes are paid by every consumer of the roster, and the difference is invisible in a 20px circle. `encodeCreatorThumb` derives from the **stored 256px object**, not the original upload, so the thumbnail is guaranteed to be the same crop as the full image (two independent `position: 'attention'` passes at different resolutions can legitimately pick different windows, which would show as the face jumping when a surface upgrades). It returns `null` rather than throwing, and anything over `MAX_CREATOR_THUMB_BYTES` (6KB) is dropped — a creator without a thumbnail simply renders from `photoURL` as before, so this degrades the optimisation and never the feature.

Validation is by **decode, not MIME**: the client's `contentType` is ignored and `sharp` must report a whitelisted format, which rules out renamed archives and polyglot files. Re-encoding also strips EXIF, including GPS (rule 10). Same pattern as `modelSubmissionService.ingestImage`.

**The cache header.** Creator photos were uploaded with no `cacheControl`, so Firebase served the download URL as `private, max-age=0` and the browser re-fetched every avatar on every page load. They are now written with `private, max-age=604800, immutable`. `immutable` is safe *because* the URL carries a `firebaseStorageDownloadTokens` value regenerated on every upload — replacing a photo yields a different URL, so a cached copy can never be the wrong one.

All three only apply to new writes, so `POST /api/admin/creators/photo-cache` (admin claim, `?dryRun=true` to preview) normalises the existing fleet: a non-WebP photo is re-encoded, which changes its path (`avatar.jpg` → `avatar.webp`) and mints a new token, so `photoURL` is rewritten and the old object deleted; one already in the right format is **repaired in place** — `setMetadata` for a missing cache header, a thumbnail derived from the existing object for a missing `photoThumb` — leaving bytes, token and URL alone. It converts **sequentially** — decoding eight full-resolution images at once is how a serverless instance meets its memory ceiling. **Run it once**; idempotent, and deletable once the fleet is converted. Until it has run, every avatar is still on the `photoURL` path, which is what the preconnect below covers.

**The read.** `useCreators` was per-consumer `useState` + `useEffect`, which meant thirty chips did thirty `sessionStorage` reads, thirty `JSON.parse`s and thirty fetches-or-cache-checks. It is now a module-level store read through `useSyncExternalStore`:

- One `sessionStorage` parse per page load, at module init.
- One request for N simultaneous mounts, via an in-flight promise guard.
- One array identity, so `getSnapshot` is stable and React does not loop.
- `useCreatorMap()` exposes a shared id→creator `Map`, rebuilt only when the snapshot changes — O(1) lookup per chip instead of a `.find()`.

That store still fetched **lazily**, from the effect of its first consumer — and its first consumer is a chip inside a page body. So the roster could not start until the RSC payload had landed and the page had rendered, and the avatars could not start until the roster came back: three serial stages before a single face appeared. [`CreatorRosterPrefetch`](../src/components/CreatorRosterPrefetch.tsx) is mounted in `(main)/layout.tsx` to collapse that, firing the roster request at app-shell mount where it overlaps the route payload instead of queueing behind it. It costs one `/api/creators` query per *app session* (the layout outlives every navigation, and an Electron renderer runs for days) for employees who never see a creator — the trade rule 9 asks you to weigh, taken deliberately.

`CreatorAvatar` prefers `photoThumb` over any `photoURL`, **including one the caller passed explicitly**. Several pages hold their own creator list and pass `name` + `photoURL` from it; `name` is honoured as a display override, but the picture is resolved from the roster whenever the `creatorId` hits, because the roster is the only place the thumbnail lives. The consequence to remember: `admin-portal/creator-management` must call `useRefreshCreators()` after a save, or an admin uploads a new photo and is still shown the old face from the five-minute-cached roster.

**The retry.** Radix's `Avatar.Image` preloads through `new window.Image()` and, on any error, swaps to the fallback for the life of the mount with **no retry** — so one transient 5xx from Storage stranded that creator on their initials, visually indistinguishable from having no photo at all. `CreatorAvatar` now retries once with a cache-busting parameter (without it Chromium may hand back the same failed entry). A `data:` URI is never retried: it cannot fail for a network reason. There is also a `preconnect` to `firebasestorage.googleapis.com` in the root layout, so the fallback path does not pay DNS + TLS to a host nothing else in the app talks to.

**One component, everywhere.** [`CreatorAvatar`](../src/components/creators/CreatorChip.tsx) is the primitive (just the face) and `CreatorChip` the pill (face + name). Every creator avatar in the internal app goes through one of them. Before this, six call sites hand-rolled `Avatar` + `AvatarFallback` and three of them used `stageName.charAt(0)` on a plain grey circle — neither the right initials nor the hashed colour that rule 7 requires, so the same creator looked different on different screens.

The one deliberate exception is [`PortalHeader`](../src/app/creator/components/PortalHeader.tsx) in the Telegram Mini App: it renders the signed-in creator's *own* avatar in the portal's Deep Ink palette (DESIGN.md §7), has no roster to be consistent with, and cannot reach `useCreators` anyway — that surface authenticates on Telegram `initData`, not the employee allowlist. It still gets the WebP, because that is a property of the stored file.

`CreatorChip` and `CreatorChipList` are `memo`ised. **Pass a stable `creatorIds` array** — an inline `.map()` in the parent defeats the memo, which is why `ShiftCalendar` memoises the offer ids.

One non-optimisation worth knowing: `loading="lazy"` on the avatar does nothing. Radix's `Avatar.Image` preloads through `new window.Image()` and forwards only `referrerPolicy` and `crossOrigin`, so the attribute never reaches a fetch decision. The HTTP cache is what does the work.

---

## 12. Tests

```bash
cd tests/salary-engine && npm install && npm test
```

81 assertions over the pure engine, the date helpers, the importer, shift serialisation and timezone resolution, including an **end-to-end run of the real August export** that asserts the figures the spreadsheet produced (Queen: $12,621.99 gross, 5% tier, $337.78 commission). The engine is pure, so this is cheap and exact — and it is the money path.

`shiftSerialise.test.ts` pins a regression worth knowing about: `recurrence.endDate` had two writers that disagreed — `createShift` stored the ISO **string** the shift modal sends, while `truncateSeriesAt` wrote a real `Timestamp` — and the reader assumed `Timestamp`, so one recurring shift with an end date 500'd the **whole** week view with `r.endDate.toDate is not a function`. The write side now normalises (`normaliseRecurrence`) and the read side tolerates every shape ever written (`toIsoString`). Keep both: one stops new bad documents, the other keeps existing ones from taking the roster down.

The export fixture lives at the repo root. If it is ever removed the end-to-end block **skips rather than fails**, so the rest of the suite keeps running.

When a rule genuinely changes, change the assertion **and** this document in the same commit.

---

## 13. When OF Manager lands

Sales will arrive with a uid already attached. At that point:

- `SALES_EMAIL_MAP` and `buildUserResolver` disappear.
- `xlsx.ts`, `salesImport.ts` and `/api/ca-salary/import` disappear with them.
- **Everything else stays.** The engine takes `SalaryDayInput`, which is source-agnostic — write the OF Manager rows into `ca-sales` with the same shape and nothing downstream changes.

Keep `signedGross` as the only column the engine sums; it is what makes reversals work without a special case.
