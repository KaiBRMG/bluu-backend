---
target: the account panel and the post card
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 5
target_identity: "file:C:\\Users\\kaijn\\Documents\\bluu-backend\\src\\components\\growth\\AccountPanel.tsx"
target_fingerprint: "sha256:31abb2dad5c91041e0e841f9210d3efe7ace656b55bd1dab6636661cde2a5240"
target_path: "C:\\Users\\kaijn\\Documents\\bluu-backend\\src\\components\\growth\\AccountPanel.tsx"
timestamp: 2026-09-17T08-37-51Z
slug: src-components-growth-accountpanel-tsx
---
Method: dual-agent (A: a04c677314e88572a · B: aa98beff7614bcc1e) — isolated, parallel.
Target: src/components/growth/AccountPanel.tsx + src/components/growth/PostCard.tsx. Mode: Operate.

## Design Health Score — 27/40

| # | Heuristic | Score | Note |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Excellent freshness story; `postsLoading` renders no skeleton |
| 2 | Match with the real world | 4 | Strongest dimension; X's own glyphs in X's own order |
| 3 | User control & freedom | 2 | Window forgotten per account switch; Close scrolls out of reach |
| 4 | Consistency & standards | 2 | Eyebrow-as-scaffold vs named rule; h2→h4; hand-rolled `<details>` |
| 5 | Error prevention | 4 | Delete gated behind "stopped", confirm names irreversibility |
| 6 | Recognition over recall | 2 | latest-vs-windowed split unstated; `—`/"Frozen" hover-only |
| 7 | Flexibility & efficiency | 2 | Six-segment window, two options blank most cards; no memory |
| 8 | Aesthetic & minimalist | 2 | Four bands/card, one near-information-free; five eyebrows |
| 9 | Diagnose & recover | 3 | role=alert with full reason; raw provider string, no retry |
| 10 | Help & documentation | 3 | Engagement definition hides inside an opened card |

## Design-specificity verdict
Substance highly specific, form largely generic. The reasoning could not be lifted into
another product (age-derived refresh ladder, `—` not `0`, delete confirm naming the
irreversibility). The composition is the default analytics-panel skeleton. Sharpest version:
the colour vocabulary was correctly rejected for a monotonic series, then the *shape*
vocabulary was copied unchanged.

## Priority issues
P1 — Sparkline is the widest band and encodes almost nothing. PostCard.tsx:238-245.
Cumulative engagement + min/max normalisation means +3 and +1,600 draw identically.
Fix: draw increment-per-refresh, which varies and falls to zero on a settling post.

P2 — Hovering a neighbouring card makes it brighter than the open one. PostCard.tsx:162-176.
Item 0.025 + trigger hover 0.03 composites to ~0.054 vs open's 0.04; borders both 0.12.
Fix: open to 0.08, plus a border hover cannot reach.

P3 — Header scrolls away with the Window control and the Sheet Close button.
AccountPanel.tsx:202-258 in normal flow inside overflow-y-auto SheetContent.
Fix: sticky top-0 header band, opaque ground, hairline.

P4 — Eyebrow-as-scaffold breaks DESIGN.md:241 ("not a per-section scaffold"). Five rendered.
Fix: the section-rail pattern at DESIGN.md:353 — text-xs font-medium zinc-400 + h-px rule.
Also solves the scan-anchor problem (space-y-5 equals intra-section gaps).

P5 — The window's own failure mode has no way out. Under 1d, daily/weekly/frozen posts
render `—` + hairline; the open card offers "widen the window", the list offers nothing.

## Detector-only findings
- `capitalize` at PostCard.tsx:529 renders "Over 7 Days"/"All Time"; lowercase everywhere else.
- figures.totals.quotes computed per card, never read (STRIP has 5; breakdown recomputes).
- Dead `group` class at AccountPanel.tsx:478, zero group-* consumers.
- Strip is flex flex-wrap gap-x-5 → icon x-positions vary by digit width across cards.
  grid grid-cols-5 fixes it; highest value-per-character change on the card.

## Agreed by both assessments
Tooltip-only meaning on `—`/"Frozen" (rule stated verbatim at growthUi.tsx:367-368, followed
at 2 of 3 call sites); h2→h4 with no h3; mixed timezone basis (AccountPanel pins UTC ×3,
PostCard pins nothing ×3).

## False positives rejected
Chevron text-muted-foreground beaten on specificity by [&>svg]:text-zinc-400, not source order.
`last:border-b` is load-bearing — removing it kills the last card's bottom border.

## Clean
Bundled detector 0/0. tsc exit 0. eslint exit 0. Contrast passes (zero zinc-500, zero authored
text-muted-foreground). memo(PostCard) genuinely not defeated on the open/close hot path.

## Strengths
1. Absent-vs-zero discipline enforced across four independent components.
2. Performance discipline as design work (one timer for twenty posts; textContent tickers).
3. The delete confirm is the best-designed object in either file.

## Persona red flags
Picks 1d, sees dashes, concludes the tool is broken. Cannot compare metrics down a column.
Same number in two spellings six inches apart (1.2K strip vs 1,204 table). Will hover a heart.

## Minor
`posted` carries no year. role="alert" fires on mount (role="status" is the right register).
No skeleton while postsLoading. sm: breakpoints inside a fixed-width panel measure the viewport.

## Browser inspection: NOT RUN
Electron-only + OAuth-gated route; middleware rewrites to /desktop-only; panel is ssr:false.
No overlay ran, nothing injected. Responsive figures are arithmetic, not measurement.
