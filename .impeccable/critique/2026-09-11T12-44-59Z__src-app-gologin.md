---
target: src/app/gologin
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\kaijn\\Documents\\bluu-backend\\src\\app\\gologin"
timestamp: 2026-09-11T12-44-59Z
slug: src-app-gologin
---
Method: dual-agent (A: a77063e5121dac4a5 design review · B: acb2ad861f4a0b563 detector + evidence)

# Design Critique — GoLogin satellite window (src/app/gologin/)

## Design Health Score — 23/40

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | `fetchedAtMs` used only as a cache key (page.tsx:181) — a list that never polls never says how stale it is |
| 2 | Match System / Real World | 3 | `profile.id.slice(-6)` (page.tsx:699) puts a system artefact in the action lane at folder-chip weight |
| 3 | User Control and Freedom | 2 | `unlink` and `force-release` both exist server-side with zero UI callers |
| 4 | Consistency and Standards | 2 | Three skeleton qualities, four greys, status triad retyped inline in four places |
| 5 | Error Prevention | 2 | Selected operator ~1.1:1 from hover (ManagementDialog.tsx:339); `Assign 47` fires with no confirm |
| 6 | Recognition Rather Than Recall | 3 | Great faceted counts and named lock holders; nothing states which GoLogin account is linked after onboarding |
| 7 | Flexibility and Efficiency | 1 | Zero keyboard affordance — no focus-visible anywhere, no `/`, no Enter-to-launch, no sort |
| 8 | Aesthetic and Minimalist Design | 3 | Clean and deferent, but the folder chip row is unbounded (page.tsx:331) |
| 9 | Error Recovery | 2 | Provider's raw message passed through (gologinService.ts:367) with a Retry button, incl. for a revoked token |
| 10 | Help and Documentation | 2 | Onboarding teaches well; after that nothing explains locks or "saving" until a dialog interrupts |
| **Total** | | **23/40** | Competent instrument, unfinished failure paths |

## Design Specificity Verdict

~70% authored, 30% default, and the split is not random. Daily-loop surfaces are genuinely product-specific: the three-way running model (page.tsx:613-632) splits liveHere / lockedByOther / liveElsewhere because GoLogin doesn't lock and Bluu does; the lock chip names the holder; CloseGuard (44-134) changes its option set by consequence; OrbitaGate (25-28) refuses to fabricate a percentage with no content-length.

The generic 30% is the admin half, where money and access are spent. ManagementDialog.tsx:328-517 is a stock two-pane picker that doesn't know a mis-click assigns a live logged-in account to the wrong human. MembersPanel.tsx:257 is a raw native select where ui/select.tsx exists.

Deterministic scan: 0 findings, verified real (--no-config re-run, per-file runs, synthetic positive control fired bounce-easing, recursion control on src/components found 1). The rule set is regex over inline-style slop and does not reach Tailwind-class conformance. Supplementary greps found:

- Four greys for one de-emphasis role: zinc-400 x55 (legal), -500 x6, -300 x7, -200 x2. Four -500 uses are 11px text (sub-AA): CloseGuard.tsx:82, ManagementDialog.tsx:397, MembersPanel.tsx:347-348. Two are search icons (legal).
- Eyebrow step used as a general section scaffold on 7 sites; DESIGN.md section 3 reserves it for the sidebar.
- opacity-80 stacked on Ink Secondary at page.tsx:540.
- Clean: img tags, icon imports, alert/confirm/prompt, onClick on non-interactive (0/26), box-shadow (0), magic z-index (0), text-muted-foreground (0), non-palette hexes (0).
- FALSE POSITIVE: the 10 raw #2563eb hexes are DESIGN.md's documented Action Blue Deep fill with correct #1d4ed8 hover; /gologin is a satellite window with its own shell, matching the sanctioned exception.

Visual overlays: none. No browser-automation tool exposed; /gologin is an Electron satellite window and middleware rewrites non-Electron traffic to /desktop-only, so a localhost visit would not render it anyway.

## Overall Impression

A well-authored instrument with a hole where its failure states should be. The daily loop is better designed than most internal tooling gets. The moment anything goes wrong, the authorship stops. Biggest opportunity: the revoked-token state does not exist, on a subsystem whose entire architecture is a defence against a revoked token.

## What's Working

1. The row's three-way running model (page.tsx:613-632, 645-672) — each fact has a different remedy, each gets its own mark.
2. CloseGuard's consequence-shaped option set (CloseGuard.tsx:44, 100-134) — removes the unsafe option when it would orphan a browser; derives its list live so it counts down.
3. The count line (page.tsx:351-394) — four states, one 11px line, tabular-nums, never a box.

## Priority Issues

### [P0] The revoked-token state does not exist

gologinService.ts:367-370 returns GoLogin's error verbatim; page.tsx:430-438 renders it as grey text plus a Retry button. SESSION_ERRORS (session.ts:23-44) has no invalid-token code. `unlink` (useGoLoginAccount.ts:110) is called by nothing — verified. This is the failure the architecture exists to prevent (rule 9e: a 429 permanently revokes the token), and there is no route back to entering a key.

Fix: add an invalid-token code to SESSION_ERRORS and goLoginErrorResponse; render a dedicated state with a Replace key action calling unlink() into GoLoginOnboarding step 3; surface glEmail in the header.

Command: /impeccable harden, then /impeccable clarify

### [P1] The selected operator in the assignment pane is effectively invisible

ManagementDialog.tsx:339-341: selected bg-white/[0.06] vs hover bg-white/[0.03], ~1.1:1. DESIGN.md section 5 documents this exact failure on the sibling satellite and prescribes the remedy. Every toggle in the right pane writes to that selection, and `selected = users.find(...) ?? users[0]` (:146) silently falls back to the first person.

Fix: Action Blue tint bg-[#3b82f6]/15, text-white font-semibold on the name, keep aria-current; selected name in the pane header.

Command: /impeccable bolder (or /impeccable audit for the whole dialog)

### [P1] No keyboard path on a surface an operator lives in all day

focus-visible / focus: appear nowhere in src/app/gologin. No `/`, no row focus model, no Enter-to-launch, no sort, no "running first". DESIGN.md section 5 already specifies j/k + focus-visible:ring-2 ring-inset for the sibling satellite.

Fix: focus rings on all four hand-rolled controls; `/` focuses search; j/k move DOM focus; Enter activates the row's primary action. Do NOT build a parallel React cursor (a keystroke firing a billed call).

Command: /impeccable adapt

### [P1] Four greys in one surface, the lowest carrying the load-bearing sentences

ManagementDialog.tsx:397 ("Copies what the folder holds now" — the most consequential caveat in the assignment model) in the least legible grey; CloseGuard.tsx:82 mixing -300/-400/-500 in one dialog; MembersPanel.tsx:347-348. Plus -200 and -300 as unnamed text tokens.

Fix: sweep text to zinc-400; keep zinc-500 only for non-text marks; one de-emphasis token per component.

Command: /impeccable audit

### [P2] Filter-empty, skeletons and primitives right in one half, wrong in the other

ManagementDialog.tsx:458 "Nothing matches that search." with no way out, while page.tsx:442-453 gets it right. Skeletons at three quality levels (page.tsx:745-777 correct; ManagementDialog.tsx:306 and MembersPanel.tsx:222 are identical bars matching no layout). MembersPanel.tsx:257 native select where ui/select.tsx exists (DESIGN.md section 6 + rule 13).

Command: /impeccable polish

## Persona Red Flags

Marta (operator, 8 profiles/day): mouse-bound for "filter then press one button"; staleness invisible (page.tsx:78,181); no "running first" sort so her own live sessions scatter through 400 rows; useOrbita().installed computed but unused in page.tsx, so OrbitaGate can seize the window for a 400MB download with no warning.

Dev (new hire, day one): accepts the invitation in Gmail, returns, step 2 still unticked — joined is fetched once on mount and reloadAccount is wired to onRetry (page.tsx:249) but NOT passed to GoLoginOnboarding (page.tsx:272-280), verified. No Check again. Steps 2 and 3 can never tick, so progress reads "1 done, 2 unknowable". page.tsx:260-267 instructs him to "reopen this window".

Sam (admin): cannot see whose row is selected while assigning live account access; Assign 47 (ManagementDialog.tsx:225-247) fires with no confirm while removing one seat gets a full AlertDialog — blast radius backwards; no force-release UI (route at api/gologin/session-lock/route.ts:45, service at gologinLockService.ts:200, zero .tsx callers — verified), so his only remedy is the Firestore console; a partially-failed reconcile shows only result.failed[0].reason (MembersPanel.tsx:182).

## Minor Observations

- page.tsx:405 saving banner uses text-blue-200, not the -400 triad foreground.
- page.tsx:639 status dot goes green for liveHere || blocked || isRunning — someone else's profile reads the same as yours.
- ManagementDialog.tsx:499-502 "Assigned x" puts a dismissal glyph in a span; the click target is the whole row.
- Status triad retyped inline in four places (page.tsx:646,667; session.ts:14-21; MembersPanel.tsx:456-460) instead of imported.
- CloseGuard.tsx:50 and OrbitaGate.tsx:32 use z-50 literals; these two overlays deliberately stack and the intent rests on source order.
- Two Notice components (GoLoginGuard.tsx:45-52 and page.tsx:787-807) with different markup — already drifting.
- Eyebrow type step used as a general section scaffold on 7 sites.

## Questions to Consider

1. If the job is "launch one profile", why is Launch the smallest, lowest-contrast control on the row (page.tsx:719, outline/xs/h-7, subordinate to the folder chips)?
2. Why a Management dialog but no Account surface? unlink was written and never wired.
3. The list never polls — correctly. So why does nothing say when it was last read?
4. Folder assignment is a one-time copy, stated once in 11px grey. Caveat, or a drift count ("3 profiles added to JORGE since you assigned it")? The data is already in the overview payload.
