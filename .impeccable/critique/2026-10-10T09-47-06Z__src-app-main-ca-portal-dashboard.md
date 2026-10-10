---
target: chat agent salary and sales tracking (CA Admin + CA Dashboard)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/kai/Projects/bluu-backend/src/app/(main)/ca-portal/dashboard"
timestamp: 2026-10-10T09-47-06Z
slug: src-app-main-ca-portal-dashboard
---
# Critique: chat-agent salary & sales tracking (CA Admin + CA Dashboard)
Method: dual-agent, code-only (no browser per user rule). Detector: 0 findings.

## Heuristics: 24/40 (Acceptable)
1 Status 3 · 2 Real world 3 · 3 Control 2 · 4 Consistency 2 · 5 Error prevention 2 · 6 Recognition 2 · 7 Efficiency 1 · 8 Minimalist 3 · 9 Recovery 3 · 10 Help 3

## Priority issues
- [P1 Admin] Month close is a per-agent loop (AdminSalaries.tsx:120-131) — bulk "Finalise N ready", prev/next agent, ?tab=&agent= URL, surface the leave-reset side effect. /impeccable shape
- [P1 Admin] Rates save + "Write sales" switch (AdminSales.tsx:567) commit without impact preview — server dry run + AlertDialog, client tier validation. /impeccable harden
- [P1 Dashboard] Ratchet derivation never shown to agent; override reason optional; calculated value unformatted (SalaryCellEditor.tsx:199-206, SalaryDayTable.tsx:612). /impeccable clarify
- [P2 Both] Stale/contradictory copy: .xlsx upload (AdminOverview.tsx:256, salary/page.tsx:266), hard-coded 20% (AdminSales.tsx:301, SalesReport.tsx:282), "so far" on finalised month, Salaries vs Payroll. /impeccable clarify
- [P2 Admin] Attention findings are dead text; make names/conflicts actionable. /impeccable layout

## Persona red flags
Alex: no sorting, 150-row cap, Clear filters misses Removed toggle (AdminSales.tsx:216), uncached roster refetch, reopen doesn't undo leave reset.
Sam: title-only definitions/chips, aria-label on bare span (AdminOverview.tsx:804), mouse-only chart day select (SalesReport.tsx:323), 10 header tab stops.
Thandi: two "rate" columns, unexplained orange account count, 10px pay chips below 11px floor, no finalisation notification.

## Minor
CommissionLadder.tsx:79 still keys current on percent; SAST label vs Africa/Harare; text-zinc-500 helper text in Rates; hard-coded #3b82f6; SalesReport.tsx:425 hard-coded cutover date; WorkedExample duplicates engine lookup; dev-note subtitle on admin page; /salary deep link defaults to calendar month; ca-salary.md MonthPicker contradiction.

## Questions
Open Admin on Salaries during close week? Decouple leave reset from finalise? Mark current-month figures as provisional?
