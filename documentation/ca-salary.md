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

The count comes from the shift's `creatorIds`. For days recorded before creator assignment existed it falls back to **distinct creators with a sale that day**, and the cell is flagged as inferred (orange in the grid, `accountCountSource: 'sales'`).

> **1 and 5 were extrapolated, not observed.** The operated rates are 2/3/4. If payroll ever disputes a figure for a 1- or 5-account day, this is the first thing to check.

### `wageRateBasis` — the one genuinely ambiguous rule

When an agent works more than one shift in a day (a regular shift plus overtime), the source spec does not say whether the rate comes from that shift's accounts or the day's total. It is therefore a **setting**, not a constant, editable in CA Admin → Rates:

- `per-shift` **(default)** — a 3-account regular shift pays $3.50/h; a 2-account overtime shift pays $2.50/h.
- `per-day` — all accounts count toward one rate applied to every hour. Pays materially more.

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
- **The agent is not notified** — see §11. The finalise dialog says so, because somebody has to tell them.

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

`POST /api/shifts/leave/[leaveId]/approve` calls [`releaseOccurrenceForCoverage`](../src/lib/services/leaveCoverage.ts), which tombstones the occurrence and posts one offer per assigned creator. It does not notify anyone — see §11.

It runs **after the commit and is non-fatal**: the leave was approved and the agent has been told, so a failure to release must not 500 and make an admin approve twice. The response carries the outcome, and the approvals UI surfaces `noAssignments` — a shift with no creators assigned releases nothing, which is not an error but *is* something an admin needs to know.

### The two kinds of overtime pay differently

| | Inside the agent's own shift | Outside it |
|---|---|---|
| Extra hours paid | No | Yes |
| Counts toward the wage tier | No | Yes |
| Keeps the sales | Yes | Yes |
| How it is stored | A shift with `paysWage: false` | A real shift, `isOvertime: true` |

In-shift cover is recorded as its **own zero-wage shift** rather than by appending the creator to the agent's real shift. Appending would raise that shift's account count and therefore its hourly rate — precisely the wage increase this case must not produce.

Outside-shift assignments **merge** into an overtime shift the agent already has for the same window. Two one-account shifts would pay the 1-account rate twice instead of the 2-account rate once, which is both wrong and worse for the agent.

### One surface: the calendar absorbed three pages

Everything an agent does with their own roster happens on the dashboard calendar. Two surfaces were deleted as redundant once it could:

- **`/applications/time-tracking` → "Upcoming Shifts" tab** existed only to host leave requests. Requesting time off is something you do *to a particular shift*, so the control is a `CalendarX2` button on the shift itself — beside the creator accounts that approving it would release.
- **`/ca-portal/shifts`** (My schedule · Overtime · Time off) duplicated the calendar, the overtime board and the leave balance. Its `page.tsx`, `CoverageBoard`, `MyLeavePanel`, `useUserShifts` and its `ca-shifts` entry in `definitions.ts` are all gone.

What remains on the dashboard, in order: salary card → leave balance → calendar. The balance sits **above** the calendar because it is the constraint you read before picking a day to request off.

> **A dashboard card must not link to a page the viewer may not hold.** The leave balance briefly linked to `/ca-portal/shifts`; `ca-dashboard` and `ca-shifts` are granted separately, so for anyone without the second one `AppLayout` redirected the click to the home page. It is now plain information with no link at all.

### Overtime lives on the calendar, not beside it

The agent-facing board is a **second layer inside `ShiftCalendar`**, not a section of its own. Their own shifts are primary — filled cell, solid time, full-size avatars, always first in the cell; available cover is secondary — no fill, a dashed rule above it, an orange dot, dimmed faces. The ordering is load-bearing: a board that competes with the real roster is one people misread on a Monday morning.

It also answers the question a separate board could not — *can I actually take this?* An offer on the 14th sitting under the shift you already work on the 14th makes "inside my shift" versus "a second shift that day" visible without arithmetic, which is exactly the distinction that decides whether it pays hours.

Claiming happens in a popover off the day cell: a month cell is ~90px and the decision needs the creator, the window, whose absence it is, and who else is already in. There is no separate list view — `/ca-portal/shifts` and its `CoverageBoard` were deleted once the calendar could do everything they did.

### Limits, enforced server-side

- **5 accounts** during the agent's own shift, **4** outside it. The check counts what they are already committed to **plus everything else they have claimed for that day and not yet been assigned** — otherwise five separate claims each pass individually and blow the cap the moment an admin approves them.
- **1 day's notice** to claim overtime. Enforced.
- **4 days' notice to request leave is stated, not enforced.** Leave can be requested right up until the shift starts; the only hard boundary is a shift that has already begun. Blocking a late request would push an agent who is ill tomorrow into telling someone off-system, where no admin can see it — the approvals queue shows how much notice each request actually carries ("in 1 day") and an admin decides. The UI states the expectation in both places it appears.
- Paid leave requires a stated reason; unpaid does not.

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

**All of it is Admin SDK only, in both directions.** This is the only subsystem where a client-side read would expose one employee's pay to another. Every figure is assembled server-side by `/api/ca-salary/*`, which resolves the subject from the verified token and **never from a query parameter**.

`ca-coverage-offers` is closed too even though the board is meant to be seen by every agent: the API does something a rule cannot, which is strip the other claimants' identities for non-admin readers.

New fields on `shifts`: `creatorIds`, `isOvertime`, `coverageOfferId`, `paysWage`. Nothing queries them, so all four are index-exempt (rule 9).

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
  Shifts        ← creator chips on each card + the picker in the modal
  Active Users · Timesheets · Screenshots · Leave (balances) · Analytics

/ca-portal/admin            (tabbed)
  Salaries      roster → one agent's editable month
  Sales data    .xlsx upload with dry-run preview, import history
  Coverage      leave approvals → offer board → assign
  Rates         tiers, wage table, grace, deduction, rate basis
  Disputes      (existing, unchanged)

/ca-portal/dashboard        salary card · leave balance · shift calendar
                            (own shifts + overtime + request leave)
/ca-portal/dashboard/salary Overview · Daily breakdown · Sales report
```

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
| [`leaveCoverage.ts`](../src/lib/services/leaveCoverage.ts) | Leave approval → release |
| [`CommissionLadder.tsx`](../src/components/salary/CommissionLadder.tsx) | The stepped scale, drawn as steps |
| [`SalaryDayTable.tsx`](../src/components/salary/SalaryDayTable.tsx) | The month grid, read-only and editable |
| [`CreatorChip.tsx`](../src/components/creators/CreatorChip.tsx) | **The house pattern for showing a creator** — `Avatar` + profile picture, initials fallback seeded from the stage name |
| [`useCreators.ts`](../src/hooks/useCreators.ts) | Module-level shared store behind every creator chip — one fetch, one parse, one `Map` per page |

---

## 11. Notifications

**There are none yet, and that is deliberate.**

Six were built and then removed before launch — salary finalised/reopened, commission tier reached, overtime available/assigned/passed-over. They will go back in once the subsystem has run in production and the figures have been trusted for a month or two; a notification that tells eight people a wrong number is worse than no notification.

What that means in the meantime:

| Event | Who needs telling | How |
|---|---|---|
| A month is finalised | The agent | The admin, by hand. The finalise dialog says so. |
| A month is reopened | The agent | The admin, by hand. |
| Leave releases accounts | Every chat agent | Nobody is pushed. The accounts appear on everyone's calendar. |
| Cover is assigned | The claimant, and anyone passed over | The admin, by hand. The board shows the outcome. |

Leave approval and denial **do** still notify (`leaveApproved` / `leaveDenied`) — those predate this subsystem and were never removed.

When they are added back, rule 15 applies: the factories go in `notificationContent.ts`, the catalogue entries in `automatedNotifications.ts` (which needs its `Salary` and `Coverage` categories restoring to both the union type *and* `AUTOMATED_NOTIFICATION_CATEGORIES`), and the rows in the event → factory table in [notifications.md](notifications.md). The tier-crossing one also needs its `ca-salary-tier-notices` collection back — a "once per tier, per month" gate cannot be derived from the salary data, because the trigger is a *change* and nothing remembers what was last said.

---

## 11b. Creator avatars: format, caching and render cost

Avatars went from a handful of rows to **every cell of the shift calendar**, which turned two latent inefficiencies into real ones.

**The format.** Every creator avatar is a **256px WebP**, encoded server-side by [`creatorPhotoService`](../src/lib/services/creatorPhotoService.ts) — the single place that decides how one is stored. Whatever an admin uploads is decoded by `sharp`, EXIF-rotated, square-cropped (`fit: 'cover'` — an avatar is drawn in a circle, so cropping at encode time means no pixel is downloaded to be thrown away), and re-encoded. A phone JPEG drops from megabytes to single-digit KB.

Validation is by **decode, not MIME**: the client's `contentType` is ignored and `sharp` must report a whitelisted format, which rules out renamed archives and polyglot files. Re-encoding also strips EXIF, including GPS (rule 10). Same pattern as `modelSubmissionService.ingestImage`.

**The cache header.** Creator photos were uploaded with no `cacheControl`, so Firebase served the download URL as `private, max-age=0` and the browser re-fetched every avatar on every page load. They are now written with `private, max-age=604800, immutable`. `immutable` is safe *because* the URL carries a `firebaseStorageDownloadTokens` value regenerated on every upload — replacing a photo yields a different URL, so a cached copy can never be the wrong one.

Both only apply to new writes, so `POST /api/admin/creators/photo-cache` (admin claim, `?dryRun=true` to preview) normalises the existing fleet: a non-WebP photo is re-encoded, which changes its path (`avatar.jpg` → `avatar.webp`) and mints a new token, so `photoURL` is rewritten and the old object deleted; one already in the right format has only its header rewritten via `setMetadata`, leaving bytes, token and URL alone. It converts **sequentially** — decoding eight full-resolution images at once is how a serverless instance meets its memory ceiling. **Run it once**; idempotent, and deletable once the fleet is converted.

**The read.** `useCreators` was per-consumer `useState` + `useEffect`, which meant thirty chips did thirty `sessionStorage` reads, thirty `JSON.parse`s and thirty fetches-or-cache-checks. It is now a module-level store read through `useSyncExternalStore`:

- One `sessionStorage` parse per page load, at module init.
- One request for N simultaneous mounts, via an in-flight promise guard.
- One array identity, so `getSnapshot` is stable and React does not loop.
- `useCreatorMap()` exposes a shared id→creator `Map`, rebuilt only when the snapshot changes — O(1) lookup per chip instead of a `.find()`.

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
