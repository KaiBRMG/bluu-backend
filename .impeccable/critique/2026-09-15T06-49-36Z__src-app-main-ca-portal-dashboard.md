---
target: src/app/(main)/ca-portal/dashboard
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:C:\\Users\\kaijn\\Documents\\bluu-backend\\src\\app\\(main)\\ca-portal\\dashboard"
timestamp: 2026-09-15T06-49-36Z
slug: src-app-main-ca-portal-dashboard
---
Method: dual-agent (A: design review, source-only · B: detector + browser evidence)

# Critique — src/app/(main)/ca-portal/dashboard

**Surface:** `/ca-portal/dashboard` + `/ca-portal/dashboard/salary` · **Mode:** Operate · **Scope:** both routes plus the components they compose (`src/components/salary/*`, `src/components/shifts/{ShiftCalendar,LeaveBalanceCard,RequestLeaveDialog}`).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Skeletons are layout-shaped everywhere, but `LeaveBalanceCard.tsx:33` has no loading branch — it asserts "**0** unpaid days left" as fact mid-fetch. Wrong status, not missing status, about a balance. |
| 2 | Match System / Real World | 2 | "Have I got Friday off?" renders as the literal string `Off?` (`ShiftCalendar.tsx:382`). `Accts` as a column header. `NET Earnings` hinted with a bare `80%` that never says of what. |
| 3 | User Control and Freedom | 3 | Real exits throughout (back link, "This month" reset, withdraw leave, un-claim). But a day-click hijacks the tab with no route back to the row you left. |
| 4 | Consistency and Standards | 2 | The same figure at two sizes, both above the system ceiling: `text-3xl` (`SalarySummaryCard.tsx:86`) vs `text-4xl` (`salary/page.tsx:133`). Action Blue means three unrelated things here. |
| 5 | Error Prevention | 2 | Neither route passes `earliest` to `MonthPicker`, so the `-24` default makes ~22 empty months reachable — the exact thing the component's own doc comment says the prop exists to prevent. |
| 6 | Recognition Rather Than Recall | 2 | Three memory bridges: orange-means-inferred has no legend; the notice period is stated on the calendar but not in the dialog; the shift length that caps your hours is never rendered. |
| 7 | Flexibility and Efficiency | 2 | `role="grid"` with no `role="row"` and no tabindex management. No sortable columns, no sticky header under `overflow-x-auto`, month not in the URL. |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely disciplined — the ladder over a progress bar, a `<dl>` over four stat cards, magnitude bars behind their labels. Lost points to a 10-column ungrouped table and two identical Overview boxes. |
| 9 | Error Recovery | 2 | `SalesReport` has a real "Try again". The other three error states are bare red sentences, with `refetch` already built and unwired. |
| 10 | Help and Documentation | 2 | The explanations are well written and **every one of them is mouse-only**. No route from "this figure is wrong" to a person. |
| **Total** | | **23/40** | **Acceptable — significant improvements needed** |

Nothing scored `n/a`; all ten apply to an authenticated task surface. The distribution is the story: **nothing below 2, nothing at 4.** Nothing here is broken; nothing here is finished. Seven of the ten losses trace to two root causes — explanations only a mouse can reach, and system rules living in copy or on the server instead of in the control.

## Design Specificity Verdict

**LLM assessment: specific by a clear margin — but it passes on three components, and the page architecture around them is the generic part.**

The authored evidence is concrete. `CommissionLadder.tsx:8-26` names the obvious wrong answer (one progress bar), argues the domain defeats it — the scale *steps*, the bands are unequal, the top is open-ended — and then implements the consequence, including drawing the terminal band at 0.7x so it can actually fill, because "a segment that could never fill would read as permanent incompleteness." `salaryFormat.ts` is a numeric policy layer, not a helpers file: a real minus sign rather than a hyphen, `7h 45m` because decimal hours are not how anyone thinks about a shift, `0` collapsed to an em dash, and `formatUsdCompact` shipping with a written prohibition — "never for a figure someone has to reconcile — a rounded payout is a support ticket." `ShiftCalendar.tsx:30-42` puts offers and own shifts in one grid so "this is inside my shift" vs "this is a second shift that day" is visible without arithmetic — a distinction worth real money under ca-salary.md §6. No unrelated SaaS product could use any of those unchanged.

Where it runs out: `<h1>My Dashboard</h1>` plus "See your earnings, your shift schedule, and available overtime shifts here" is the most generic title available in the product, on the one page belonging to a named role with a named pay structure — and the description is a table of contents for three things already visible below it. The composition is three full-width cards in a `space-y-5` stack; the header comment makes a strong ordering argument and then ordering is the *only* compositional idea on the page. And the Overview's second box congratulates itself in-comment for avoiding "a row of identical cards" while shipping two identical cards. **Any SaaS product could use both page shells unchanged.**

The two type-scale breaks are the sharpest tell. DESIGN.md §3 sets Display at `text-2xl` as the ceiling, names oversized display type a Don't, grants exactly one exception (the time-tracking Instrument step) and adds "do **not** cite this step to justify another big number." This is that — and it is the *same number* at two different sizes on two screens, which reads as hero-metric instinct overriding the house voice.

**Deterministic scan: clean.** `impeccable detect --json` returned literally `[]` at exit 0 on all three trees — the dashboard route (recursively, covering `salary/`), `src/components/salary` (6 files), and `src/components/shifts` (3 files). A non-JSON re-run printed zero lines, confirming no suppressed advisory findings. Nothing to adjudicate as a false positive. Worth stating plainly: **the detector agreeing with nothing does not vindicate this surface.** Every issue below is a judgment the pattern-matcher cannot make — a contrast ratio DESIGN.md itself publishes, a tooltip that forwards no `tabIndex`, a month prop that is silently not passed, copy that forbids what the policy permits.

**Visual overlays: none.** No browser-automation or page-mutation tool is exposed in this session, so no overlay exists and none was claimed. `live-server` was correctly not started. This is a source-only critique of an auth-gated Electron surface; where a judgment would have needed pixels, that is said so.

## Overall Impression

This is the work of someone who thought hard about the domain and then stopped one step short of the people using it. The commission ladder, the number formatting and the two-layer calendar are better than most production code; each one names the lazy answer and refuses it in a comment. Then the same surface tells a person earning $1.50–$5.50/hour that an administrator changed their pay, and explains it only to a mouse.

**The single biggest opportunity: the explanatory layer exists, is well written, and is undeliverable.** Nine Radix tooltips wrap non-focusable spans and icons — including who overrode your figure and why, and whether your time off is approved. Fixing delivery costs almost nothing and recovers the two lowest heuristic scores. Everything else is downstream of that same pattern: rules stated in prose instead of built into the control.

## What's Working

**1. `CommissionLadder` is authored from the domain outward and shows its work.** `flexGrow: segment.span / totalSpan` sizes each band to its real width; `fill` is computed per band so passed bands are complete, the current one partial, the ahead ones empty; the rate labels sit above their own band so no legend needs mapping; the visual layers are `aria-hidden` and replaced by one `sr-only` line rather than a dozen announced segments; the only motion is a 300ms width transition on a console people sit in front of for eight hours. Every one of those could have gone the lazy way.

**2. `salaryFormat.ts` makes number presentation a policy layer instead of a per-component habit.** `signedMoneyClass` refuses green-for-gain on a stated palette-economy argument — every ordinary day is a gain, so colouring them all spends the palette and leaves nothing for a reversal to mean. That is a correct reading of DESIGN.md §2 applied without being told. The effect is that the agent's dashboard and the payroll grid *cannot disagree about what a dollar looks like* — the design system and the data architecture enforcing one invariant by one method.

**3. The surface refuses to gamify someone's income.** The "best day" line is guarded to `grossEarnings > 0` and framed in-comment as "a fact about their work, not a manufactured streak." A lesser version of this screen would have shipped streaks, badges and a green up-arrow on a person's wage. The restraint is the design.

## Priority Issues

### [P1] Every explanation on the money surface is mouse-only

**Why it matters.** Nine `TooltipTrigger asChild` wrap non-focusable elements. `tooltip.tsx:27-31` is a bare pass-through (verified) — it forwards props and adds no `tabIndex`, so with `asChild` every one of these is hover-only: the definitions of Gross, Net, Rate, Hours and Accts; **the override explanation** (who changed this figure on your pay, why, and what the system had calculated, `SalaryDayTable.tsx:184`); the missing-shift warning on an `AlertTriangle` that is *additionally* `aria-hidden`, so a screen reader gets neither the mark nor the reason; and **the leave status**, whose only expansion from `Off?` to real words is this tooltip. These are not decorations — they are the entire explanatory layer of a payroll screen, and two of them carry facts a person would escalate over. Anyone who doesn't discover that a dotted underline is hoverable is equally locked out.

**Fix.** Make every explanation-bearing trigger focusable: `SalaryDayTable.tsx:184` becomes a `<button type="button">` named "Edited value — press for details", and its content *also* renders as a visible `text-[11px] text-zinc-400` row line at `md:` and up, because "an admin changed this" is not supplementary. Drop `aria-hidden` from the warning triangle and give it `role="img"` + `aria-label="No shift on record"`. Replace `Off?` / `Off` / `Denied` with `Off — pending` / `Off` / `Off — denied` and keep the tooltip as reinforcement, not as the only carrier.
**Suggested command:** `/impeccable harden`

### [P1] The dashboard shows two different months at once and never says so

**Why it matters.** Verified: `dashboard/page.tsx:32` holds `month` and passes it only to `ShiftCalendar`, while `SalarySummaryCard.tsx:26` pins itself to `currentMonthKey()` and takes no `month` prop. Step the picker to August and the salary card stays on September — both correctly labelled, so the two labels *do* contradict each other on screen, with the picker sitting 200px below the card it does not control. The section's only heading is an `sr-only` "Schedule" while `ShiftCalendar` renders its own visible "My schedule" — two `<h2>`s for one section, and the picker attached to the invisible one. A control positioned as page-level that is actually section-level produces confident wrong readings, and on a payroll surface a month mismatch is the shape of a real dispute.

**Fix.** Lift the month: pass `month` into `SalarySummaryCard` and hoist the picker onto the `<h1>` row per DESIGN.md §3's page-header pattern, so one month governs the page — an agent checking August wants August's pay, which is the whole reason they opened it. Delete the `sr-only` duplicate heading and its wrapper `<section>`. While in there, pass `earliest` on both routes; neither does (verified), so the `-24` default makes ~22 pre-system months reachable that render as empty tables looking like data loss.
**Suggested command:** `/impeccable clarify`

### [P1] The pay table conveys data-quality caveats by hue alone, and sets its hardest-to-read rows below AA

**Why it matters.** Three colour failures on figures that determine pay. (1) `SalaryDayTable.tsx:276` marks an account count *inferred from sales rather than read from the shift* — a data-quality caveat ca-salary.md §2 flags explicitly — with `text-orange-400` and nothing else: no mark, no tooltip, no legend on the route. That hue is the difference between $2.50/h and $3.50/h. (2) `text-zinc-500` appears **13 times** across this scope, including whole empty pay rows and the date numeral of every unworked calendar day. DESIGN.md §2 publishes its own measurement — **4.12:1, "Not a text colour… it fails AA on every ground in the app."** The rows an agent squints hardest at are set closest to invisible. (3) An overridden figure renders `text-[#3b82f6]` — ~4.3:1, under the floor at 14px — and breaks the One Voice Rule, since the same hue means "today" two lines down and "magnitude" over in `SalesReport`. The proof the right pattern was available: a reversal gets a row wash **plus** a red "Reversed" pill. Hue plus text, done correctly, in the same folder.

**Fix.** Keep the orange and add the mark — reuse the `AlertTriangle` + tooltip already sitting a few lines above, so inferred cells self-describe ("Counted from sales, not from a shift assignment"). Replace every listed `text-zinc-500` with `text-zinc-400`; an empty row is already distinguished by its column of em-dash glyphs and doesn't need a second, illegal de-emphasis. Drop `text-[#3b82f6]` on override cells and let the now-focusable control from P1 #1 carry the signal — mark plus text, and Action Blue returns to one meaning.
**Suggested command:** `/impeccable colorize`

### [P1] The schedule hides the number that sets the pay, and its one instruction forbids the case it was written to permit

**Why it matters.** Two gaps, one cause — the surface stating rules instead of supporting them. First, **shift end times are never rendered**: `ShiftCalendar.tsx:238` formats `occurrenceStart` and stops, while `occurrenceEnd` exists on `ExpandedShift` and is computed for every occurrence. Meanwhile the salary page tells the agent their hours are "capped at the length of the shift." **The number that decides their wage is not visible anywhere in the product** — and the *offers* layer does show a full window, so the shifts an agent might take carry more information than the shifts they actually work.

Second, the copy conflict is verified: the calendar reads "Leave needs 4 days' notice" while `canRequestLeave` permits a request right up to `shift.occurrenceStart > now`, and ca-salary.md §6 states the 4 days are "**stated, not enforced**" — because blocking a late request "would push an agent who is ill tomorrow into telling someone off-system, where no admin can see it." *Needs* is a prohibition. An agent who wakes up ill reads it, concludes the system will refuse them, and messages a manager on Telegram. **Four words defeat the policy they were written to serve**, and the dialog where the decision is made never mentions notice at all.

**Fix.** Render the window on the agent's own shift. At `text-[10px]` in a ~90px cell it won't fit — which is the right forcing function to raise those five `text-[10px]` instances to the documented `text-[11px]` Meta floor; if it still won't fit, show start plus duration (`9:00 AM · 8h`), since the duration is the figure that matters. Rewrite the notice to "Leave is normally requested 4 days ahead. You can still ask later — an admin decides," and repeat it inside `RequestLeaveDialog` beneath the type fieldset.
**Suggested command:** `/impeccable clarify`

### [P2] Three of four error states are dead ends, and a month is not addressable

**Why it matters.** The salary page, the summary card and the calendar each render the error string and nothing else — while `useSalaryMonth` already exposes `refetch` and `useShiftCalendar` already exposes `load(force)`. `SalesReport` wires a real "Try again" in the same folder, so the pattern exists and simply wasn't applied to the three more important states. On a screen people reach for at month end, already anxious about a number, the app's answer to its own failure is a sentence with no verb — in an Electron window with no reload button. Separately, `month` is component state on both routes, so no month is linkable — contradicting the salary page's own stated reason for being a route ("a notification can point at it") and pre-breaking it for the manager who, per ca-salary.md §11, must tell each agent by hand that their month was finalised and cannot paste a link to it.

**Fix.** Lift `SalesReport`'s error block to all three sites, wired to `refetch` / `load(true)`. Move `month` to `useSearchParams` + `router.replace` (`?month=2026-08`), defaulting to `currentMonthKey()`.
**Suggested command:** `/impeccable harden`

## Persona Red Flags

Selected per the reference table — this surface is both Dashboard/admin and Data-heavy/analytics, which nominates **Alex** and **Sam** twice; **Riley** is added because it's a money surface whose own docs flag inferred data. Two project-specific personas are derived from ca-salary.md §§2/6/7, not invented.

**Alex (Power User).** `role="grid"` with no `role="row"` and no tabindex management — reaching Friday the 14th means tabbing through every interactive child of every preceding cell. No sortable columns, so "which day paid best" means reading 31 rows — while the page *already sorts for `bestDay`* and spends the result on one prose line. Month in `useState`, so no bookmark, no two windows, no link to send. Every sale rendered unpaginated with no "Showing 24 of 61" line. Scrolled right to `Salary` under `min-w-[820px]`, they have lost both the date and the column labels. And nothing to copy but a screenshot, which is their actual workflow on a disputed figure.

**Sam (Accessibility-Dependent).** Locked out of all nine explanations. The missing-shift `AlertTriangle` is `aria-hidden`, so the fact is invisible, not just awkward. Orange-means-inferred is meaning by colour alone. `text-zinc-500` at 4.12:1 on empty pay rows and calendar date numerals. `Off?` vs `Off` — one character distinguishing pending from approved, at 10px, hover-only. The ARIA grid is invalid (`gridcell`s with no `row` ancestors), so NVDA and VoiceOver degrade it to a flat run of text and buttons. And the day-click sets `inspectedDay` *and* flips the tab, unmounting the button just activated — **focus falls to `<body>` with no live-region announcement.** The disabled Request button has no `aria-describedby` and no inline reason.

**Riley (Stress Tester).** Both server-enforced limits are invisible until violated — the 1-day claim cutoff and the 4/5-account cap reach the user only as `toast.error`, from a fully enabled Claim button on a shift starting in three hours. `reset()` forces `leaveType: 'unpaid'` regardless of availability, so an agent with 0 unpaid and 3 paid opens the dialog onto a preselected unavailable option and a dead submit — a form booting into an invalid state. `LeaveBalanceCard` has no loading branch (verified), so a throttled connection watches it assert "0 unpaid days left" as fact. And `useState(() => Date.now())` is captured once per mount — under CLAUDE.md rule 9c, where a renderer running for weeks is the *norm*, the calendar keeps offering "Request time off" on shifts that started days ago.

**Thandi — Chat Agent, Manila** *(ca-salary.md §7: half the team is in the Philippines; §2 hourly table; §1 derived-not-stored).* She reconciles this screen against her own records, which is the entire reason it exists. **She cannot verify her own hours** — the cap is the shift's scheduled length and that length is never rendered. **The salary day boundary is `Africa/Harare` for her too**, while `formatSaleDateTime` renders each sale in *her* zone: a sale she remembers at 1 AM Tuesday Manila is bucketed to Monday in Harare, and nothing on either route names the company boundary or explains the mismatch. The screen built for reconciliation does not mention the one discrepancy it will produce. An orange `2` in Accts means her rate was guessed — unlabelled. Her overridden figure is blue text with a hover-only reason. Her month is finalised without notifying her, and the banner announcing the figures can no longer change offers no query path. And the currency is `$` with no "USD" anywhere.

**Marlize — CA Manager** *(§§9–11; holds `ca-admin` page permission, not the admin claim).* She must tell each agent by hand that a month is finalised and cannot send them a link to it. She has **no view of what her own override looks like to the agent** — her screens pass `editable`, so she never sees the blue-text-plus-hidden-tooltip rendering her edits produce and cannot know it is illegible. Coverage claims show `claimCount` as a bare number with no cap context on her side. And the inferred-account caveat is equally unlabelled in her mode, so a disputed figure's provenance depends on her remembering what a hue means.

## Minor Observations

1. `Math.round(100-config.deductionRate * 100)` renders a bare `80%` under "NET Earnings" in 11px `text-zinc-500` — never says 80% *of what*, and the reader must invert it to learn the deduction is 20%. Missing spaces around the `-` also make correct precedence read as a bug.
2. Three casings in one four-item row: `Gross Earnings`, `NET Earnings`, `Hours worked`, `Days worked`.
3. Overview uses bare `formatUsd(totals.grossEarnings)` while the table wraps the same figure in `signedMoneyClass` — a net-negative month (legal per §2) renders white in one place and red in the other.
4. The total Salary cell is `text-base` among nine `text-sm` siblings — a half-step of emphasis used nowhere else.
5. `CommissionLadder` keys segments on `segment.percent` and matches `isCurrent` by percentage, not index. A duplicate percent in CA Admin → Rates lights two bands as current *and* collides React keys.
6. `SalesReport` gives filtered-empty a way out, but filtered-with-results offers no clear-filters control — the escape hatch appears only after the dead end.
7. `rows.slice(0, 6)` with `+N more` as text, not a control, on both breakdown lists.
8. `opacity-70` on `CreatorChipList` — DESIGN.md §3 bans stacking opacity on de-emphasised content. Avatars, so not a contrast failure, but it is the banned mechanism where a smaller `size` would do.
9. `useCoverageOffers` is not month-scoped: it fetches all available offers and buckets by day, so "No overtime available this month" conceals that overtime exists next month.
10. The Claim button — the most consequential action here — renders **near-white**, because `--primary` resolves to `oklch(0.92 …)`. This is the documented app-wide defect and DESIGN.md correctly forbids inking around it locally; noted because on *this* surface that near-white button sits beside Action Blue doing three other jobs, which is where the global fix would pay off most.
11. An inline lucide icon in prose points at a `CalendarX2` button that is `opacity-0` until hover — the instruction describes a control the reader cannot see while reading it.
12. `LeaveBalanceCard` dims the unpaid figure to `text-zinc-400` when it hits **zero** — the most consequential value that field can hold, de-emphasised. Hierarchy inverted.

## Questions to Consider

1. **The dashboard orders three cards by importance and calls that the composition. What if the calendar *were* the dashboard?** Every fact on this page is already dated — a day's earnings, a shift, an offer, a leave request. The salary card is a monthly sum of the same rows; `SalaryDayTable` is that calendar unrolled into a list. One month grid carrying the shift, the offer layer already there, and the day's earnings would answer "what am I earning", "when am I working" and "why was Tuesday low" in a glance — and would make the missing shift-end time impossible to omit. Is the three-card stack the design, or the absence of one?
2. **ca-salary.md §1 makes derivation the founding rule — every figure recomputed so nothing can drift. Why does the interface stop one link short of the sources?** The table shows Hours but not the shift they were capped against, Accts but not which creators, Gross but not the sales until a focus-stealing tab switch. An agent sees a pure function's outputs and almost none of its inputs. What if every derived figure expanded to the rows that produced it — the UI mirroring the engine's structure instead of just consuming its output?
3. **This surface has no idea what it costs to be wrong.** A disputed figure currently exits the product entirely — into Telegram, into a manager's DMs. What if "this doesn't look right" were a first-class control on a day row, capturing the figure, the month and the visible inputs into an admin queue? The `/ca-portal/disputes` decision-queue pattern already exists in this codebase and is already the reference shape for exactly this.
4. **DESIGN.md grants one sanctioned oversized number — the time-tracking Instrument — because "the timer *is* the page's reason to exist."** This page overrode the ceiling twice without claiming the exception. So: is the earnings figure this page's reason to exist, in which case argue it and add it to §3 as a second named step at **one** size — or is it not, in which case both drop to `text-2xl`? A half-claimed exception at two different sizes is the one outcome that is wrong either way.
5. **`Off?` versus `Off` is one character deciding whether someone's plans are real.** What is the smallest honest unit for a leave state in a 90px cell — and if the answer is "more than fits", is the month grid the wrong place for leave status at all? The claim popover already established the pattern of putting the decision where there is room.
