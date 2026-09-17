---
target: src/app/(main)/ca-portal/dashboard
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\kaijn\\Documents\\bluu-backend\\src\\app\\(main)\\ca-portal\\dashboard"
timestamp: 2026-09-16T20-08-20Z
slug: src-app-main-ca-portal-dashboard
---
Method: dual-agent (A: design review, source-only · B: detector + browser evidence) + isolated technical-audit pass

# Critique + Audit — src/app/(main)/ca-portal/dashboard

**Surface:** the CA agent's home · **Mode:** Operate · **Scope:** `page.tsx` + `SalarySummaryCard`, `LeaveBalanceCard`, `ShiftCalendar`, `FullScheduleDialog`, `RequestLeaveDialog`, `CommissionLadder`, with `/dashboard/salary` as adjacent context.

## Design Health Score — 27/40

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Skeletons shaped block-for-block and boot-gated, but a *failed* overtime fetch renders as "No overtime available this week" (ShiftCalendar.tsx:660). |
| 2 | Match System / Real World | 3 | "Cover", "+2 overtime", "Overtime shift", "In for 2" — four labels for one family of facts; which one you are reading decides whether you get paid, separable only by hover. |
| 3 | User Control and Freedom | 3 | Pending leave withdraws, claims toggle off, "This week" resets. No Undo on a claim toast; a resolved leave request leaves no record once its shift scrolls out of the week. |
| 4 | Consistency and Standards | 2 | Two tooltip systems in one 90px cell — native `title` (CreatorChip.tsx:220) beside Radix `Tooltip`. `text-zinc-500` used as text, which DESIGN.md §2 states fails AA on every ground. |
| 5 | Error Prevention | 3 | Notice period stated in both places; balances gate the radio options; the "after this you will have N days" line is a good pre-commit check. Nothing flags late notice before the dialog opens. |
| 6 | Recognition Rather Than Recall | 2 | Leave button is `opacity-0` until hover (:541) while the line below instructs "Select the icon on a shift" (:651) — the instruction names a control not on screen. |
| 7 | Flexibility and Efficiency | 3 | Week arrows, month dialog reusing warmed cache, deep-linkable salary month. `role="grid"` ships without roving tabindex or arrow keys. |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely restrained; the ladder and hairline-separated `<dl>` are exemplary. A day cell can still stack twelve elements at 10-11px. |
| 9 | Error Recovery | 2 | Salary and roster errors have a real retry. Two hooks expose `error` and neither is destructured — two failure modes with no diagnosis and no recovery. |
| 10 | Help and Documentation | 3 | "Claiming puts your name forward. An admin confirms who covers what." is exactly right. The three-way overtime pay rule exists only in tooltip strings. |
| **Total** | | **27/40** | **Good — craft is high; failures concentrate at the error edges and for new readers** |

## Audit Health Score — 15/20

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 | Two calendar controls ~14-16px sitting 2px apart (WCAG 2.5.8 fail); `role="grid"` promises keyboard navigation never implemented. |
| 2 | Performance | 3 | Well-optimised data layer, undercut by per-shift allocations in the cell map and a `?? []` literal defeating a memo. |
| 3 | Responsive | 3 | Scrolling salary table is a model implementation; the 7-column grid has no width floor; two nav labels carry fixed `min-w`. |
| 4 | Theming | 3 | One hard-coded hex — and it is the stale `:root` canvas, not the `.dark` one. Overlay scale forked to six off-vocabulary alphas. |
| 5 | Implementation Integrity | 3 | Outstanding rationale discipline and one shared cell renderer, undercut by the dropped error flags. |
| **Total** | | **15/20** | **Good** |

## Design Specificity Verdict

**Authored for this product, well above the norm — 8/10.** `CommissionLadder` refuses the obvious progress bar because this commission scale is stepped with unequal bands, drawing the open-ended top band at `TOP_BAND_RATIO = 0.7` so a segment that can never fill does not read as permanent incompleteness. The two-layer calendar merges the overtime marketplace into the roster grid so "is this offer inside the shift I already work?" is answered by adjacency rather than arithmetic. The overtime ring + count contract sorts paid accounts first so truncation hides the exception.

The weak spot is the chrome: `<Button size="sm">Full Schedule</Button>` resolves `--primary` to near-white, so the loudest pixel on a page about someone's pay is a secondary navigation button. DESIGN.md §2 documents this as an outstanding global issue and forbids in-component workarounds — correct, but the consequence lands here as a hierarchy inversion on a high-stakes surface.

**Deterministic scan:** 0 findings, exit 0, across all seven files. Verified not a suppression artifact (re-run with `--no-config`; config holds only a hook-consent key; a control scan of `src` returned 14 findings across three rules, none in this surface). **Weak evidence, not a clean bill of health:** the detector gives `.tsx` regex matching only — resolved contrast, hit-target size, overflow, focus rings and rendered type scale all require a URL and could not run. Every contrast and target finding below is manual, computed against the real `.dark` tokens.

**Visual overlays:** none. No browser-automation tool exposed; `src/middleware.ts` rewrites `/ca-portal/*` to `/desktop-only` for non-Electron user-agents, and the route sits behind OAuth with derived-on-read salary data. Nothing started, injected, or authenticated.

## Overall Impression

A surface that has clearly been through prior passes — nearly every decision carries a comment naming the measured problem it solved. The failures are not craft failures but completeness failures at the edges: two hooks compute careful error messages that die at the destructure, an instruction that names an invisible control, an ARIA role making a promise the widget does not keep. The biggest opportunity is that the correct pattern for every one already exists in the same file.

## What's Working

1. **The salary card's information ladder** (SalarySummaryCard.tsx:122-154) — one Earnings-step figure, a hairline-separated `<dl>` of four supporting terms, then the ladder. The `aria-label` at :89 is the detail that proves the care.
2. **Colour is never the sole state cue anywhere in the calendar** — overtime is ring + glyph + literal text; leave status is hue + distinct wording ("Off — pending" / "Off" / "Off — denied"). Load-bearing; keep it.
3. **The data layer is unusually well optimised for rule 9** — module-scope stores over `useSyncExternalStore`, month-level caching so week-arrow scrubbing is one request, one `Intl.DateTimeFormat` per timezone.

## Priority Issues

### [P0] A failed fetch is rendered as a confident factual negative — twice
**Where:** ShiftCalendar.tsx:197-204 (destructure) to :660 (render). Found independently by both assessments and verified in source.
`useCoverageOffers` and `useLeaveRequests` each build careful error messages preserving the server's wording; both are dropped at the destructure. On an overtime failure the panel renders "No overtime available this week." On a leave failure every "Off — pending" badge vanishes **and** `canRequestLeave` becomes true for a shift that already has a pending request.
**Why it matters:** these decide whether the agent earns extra money and whether they can take a day off. The board is first-come, so a false "none" costs real money; the leave gap permits a double-request. It violates the file's own standard — :394-404 does this correctly for the roster.
**Fix:** destructure `error` from both; `text-red-400` line + `size="xs" variant="outline"` retry matching :398; one quiet line above the grid for leave, and suppress the leave button while that is true.
**Suggested command:** /impeccable harden

### [P1] The outcome of a leave request has nowhere to land
**Where:** LeaveBalanceCard.tsx:92-96, ShiftCalendar.tsx:721-791.
`ca-salary.md` §11 confirms there is no notification for leave approved or denied. This dashboard is the only channel, and the answer appears only on that shift's calendar cell, possibly three weeks out and invisible in the default week view. The pending pill carries no date, no link, and vanishes when decided — the pending-to-denied transition produces zero signal.
**Fix:** pending pill carries the date and becomes a control that jumps `weekStart` to that week; add a dismissible status-coloured pill for anything decided in the last ~14 days, reusing `LEAVE_STATUS_STYLE`.
**Suggested command:** /impeccable onboard

### [P1] The page's own instruction points at an invisible control
**Where:** ShiftCalendar.tsx:541 vs :651. The leave button rests at `opacity-0` while the line below instructs the reader to select it. DESIGN.md's reveal-on-hover rule is written for action lanes on list rows; this is the opposite case — a handful of shifts, the panel's primary user-initiated action, the one thing a first-week agent is told to look for. `focus-visible` does nothing for the mouse user.
**Fix:** rest at `opacity-60 text-zinc-400`, step to `opacity-100` on hover/focus.
**Suggested command:** /impeccable clarify

### [P1] `role="grid"` without the grid keyboard contract, and targets below the WCAG floor
**Where:** ShiftCalendar.tsx:422-426; targets at :526 and :761. Both assessments hit these independently.
Structure is correct (rows own cells, `display: contents`), but no cell is focusable, no roving tabindex, arrows/Home/End do nothing — ~60 tab stops to reach the last week of a month. Blank cells are `role="gridcell" aria-hidden`, leaving rows with fewer cells than column headers. Request-leave is ~16x16px, leave-withdraw ~14x14px against WCAG 2.2 AA 2.5.8's 24x24px; the spacing exception does not rescue either.
**Fix:** step down to `role="table"`/`row`/`columnheader`/`cell` (~10 lines, honest), or implement roving tabindex. Expand hit areas via `after:absolute after:-inset-1.5` on a `relative` wrapper (DESIGN.md §7 rule 10).
**Suggested command:** /impeccable harden

### [P2] Orange means seven different things in one panel
**Where:** :501, :557, :600, :611, :704, :851, :657. Orange encodes an overtime marker, "Cover", an overtime count, "Overtime shift", pending leave, an available-offer dot and the legend dot — three with different pay consequences. Separately `mine > 0` flips the offer state to **green** at :851, where green means approved/complete everywhere else but a claim is pending an admin — the same overstatement the `Off?` to `Off — pending` rework fixed.
**Fix:** decide which single fact orange owns; move the rest to shape or text. Step the claimed state off green.
**Suggested command:** /impeccable colorize

## Persona Red Flags

**Power agent (8h/day):** the most-checked figure is behind a full page of skeletons every visit, and `useBootPhase` holds the whole page until it lands — the fastest check gated on the slowest. No keyboard path to jump weeks. The week label drops the year with no forward cap; fifteen arrow presses reads an empty 2027 week indistinguishable from "roster not published yet".

**First-week agent (day 3):** cannot find the leave button despite the instruction naming it. Sees `Cover`, `2 overtime`, `Overtime shift`, `+3`, `In for 2` with no way to learn which pay hours — the explanations are tooltip/`sr-only` strings. Claims an offer, gets a green toast, then nothing; admin assignment is cron-coalesced and there is no "1 claim pending" state here.

**Tired night-shift / low-vision agent:** `text-[10px] text-orange-400` carries a pay-relevant fact below DESIGN.md's own 11px floor. `text-zinc-500` on "No accounts yet" measures 3.96:1, under the 4.5:1 AA floor, on a colour DESIGN.md §2 already documents as not a text colour. `Off` vs `Off — denied` hangs on two words and a hue at 11px on a dimmed screen.

## Minor Observations

- ShiftCalendar.tsx:666 — `totalShifts === 0 && !showOvertime` means "Nothing scheduled this week." never renders on the dashboard, which always passes `showOvertime`. An empty week reads as seven blank cells.
- LeaveBalanceCard.tsx:42 — `useUserData` has no error channel and sets `loading: false` on a Firestore error, so a failed read renders "0 unpaid days left" as fact: the bug its own comment says it exists to prevent, one layer up.
- CreatorChip.tsx:213 — `ring-offset-[#0A0A0A]` is a literal where `ring-offset-background` exists, and it is the stale `:root` canvas rather than `.dark`'s `#09090b`; in a calendar cell it punches a dark halo through the cell's overlay.
- The white-overlay scale has forked to six off-vocabulary alphas; `HAIRLINE` is imported by none of these files and all eleven `border-white/[0.07]` occurrences are hand-typed. The 0.045 divider measures 1.08:1.
- Loading skeletons are not shaped to what replaces them — 35 cells where a Sat/Sun-starting month needs 42, both heights 8-12px short, so the page reflows as data lands.
- Tooltips fire at `delayDuration={0}` inherited from the sidebar provider; a mouse crossing a week pops a chain of them over the content being read.
- `CommissionLadder` animates `width` (a layout property) at 300ms, 2.5x the 120ms budget. Reduced-motion is correctly handled.
- `RequestLeaveDialog` builds a fresh `Intl.DateTimeFormat` per render and passes the raw `timezone` where the calendar re-applies `safeTimezone()`.
- "Payout Processed" is Title Case where every neighbouring string is sentence case.

## Questions to Consider

1. The cell is doing the job of a row. Every hard constraint traces to "a day cell is ~90px". What if the week view were seven full-width rows instead of a grid, with the month staying a grid in the dialog?
2. Is orange one signal or seven? If hue could encode only one fact here, which would the agent most want?
3. The system tells an approver that leave was requested and tells nobody it was decided. Why is the agent's own outcome the one event that does not notify?
4. What does an agent do with "$1,240 more in sales to reach 3%"? The ladder answers how far; the overtime layer 400px below offers the only lever they control. Same conversation, separate sections.
