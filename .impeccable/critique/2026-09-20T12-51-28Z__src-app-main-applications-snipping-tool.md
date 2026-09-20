---
target: the snipping tool (page + components)
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:C:\\Users\\kaijn\\Documents\\bluu-backend\\src\\app\\(main)\\applications\\snipping-tool"
timestamp: 2026-09-20T12-51-28Z
slug: src-app-main-applications-snipping-tool
---
Method: dual-agent (A: design review · B: detector + browser evidence)

# Critique + Audit — Snipping Tool (page + components)

Target: in-app library `/applications/snipping-tool` (Operate) + `SnipController` (app-wide chrome) + public `/s/[shareId]` (Read).
Note: uncommitted in-flight work adding video recording was in the tree at assessment time.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Capture feedback exemplary; automatic drain's "quiet" path toasts anyway |
| 2 | Match System / Real World | 2 | Page promises a microphone that does not exist; /s titles a video "Shared Screenshot" |
| 3 | User Control and Freedom | 2 | No per-snip retention override, no per-row retry, no undo; drain clobbers clipboard |
| 4 | Consistency and Standards | 2 | Duplicated formatBytes; UTC date among viewer-zone siblings; destructive = near-white |
| 5 | Error Prevention | 2 | Link is a bearer token and nothing on owner's surface says so |
| 6 | Recognition Rather Than Recall | 2 | No search, no kind filter, no date grouping across a 500-row paged grid |
| 7 | Flexibility and Efficiency | 1 | Nothing for the 30x/day user; one in-flight save disables all settings controls |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained; minor glass/opacity drift, two prose paragraphs above the fold |
| 9 | Error Recovery | 3 | Nine reason-specific failure toasts — strongest work in the subsystem |
| 10 | Help and Documentation | 2 | Retention re-stamp consequence exists only inside a transient toast |
| **Total** | | **22/40** | **Acceptable — significant work needed** |

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | /s has no heading at all; progress bar has no accessible name |
| 2 | Performance | 3 | SnipSettingsPopover re-mirrors a snapshot object every ~10 min |
| 3 | Theming | 3 | s/layout.tsx:19 hard-codes what tokens already resolve |
| 4 | Responsive | 3 | Reflows correctly; 28px row actions pass AA, fail AAA |
| 5 | Implementation Integrity | 3 | Dead share link answers HTTP 200 |
| **Total** | | **15/20** | **Good — address weak dimensions** |

## Implementation Integrity Verdict — PASS

Detector: 0 findings across all three target dirs. Proven live (re-run with --no-config; config's single ignoreValues entry scoped to electron/snip-record.html only; detector demonstrated firing on a pulsing-dot elsewhere). Code implements two patterns CLAUDE.md lists as outstanding elsewhere: signed-URL upload (rule 9i) and the abort/sequence-guard on paged fetches.

## Design Specificity Verdict

Public /s page is authored. Library page is a generic grid with authored microcopy bolted on. Sentence-level craft is unmistakably this house (live accelerator interpolation, empty state naming the way out, snipExpiryLabel). Composition is the default: h1 + prose + right-aligned buttons + 3-col equal-weight card grid. Nothing in the layout knows this is a work tool used 30x/day. House already owns the right pattern (DESIGN.md section 5 faceted index, apps-resources).

Video bolted on rather than designed in: phantom microphone, /s title still "Screenshot", formatBytes duplicated verbatim with a comment acknowledging the copy. Counter-example done right: SnipCard's play badge + duration chip.

## What's Working

1. Failure taxonomy as user-facing copy (SnipController.tsx:335-407) — nine reasons, nine remedies, withholds "Open Settings" off macOS.
2. snipExpiryLabel (snips.ts:200-263) — a duration not a date; sidesteps timezones by being true in every zone at once.
3. PendingUploads leads with reassurance then the real error; orange not red; delete confirm names the stake.

## Priority Issues

[P1] Page promises a microphone the product does not have (page.tsx:324-326; snip.html:240 has one audio control; snip.html:346 shows macOS has none). Echoed SnipVideo.tsx:28-30. Also s/layout.tsx:4 "Shared Screenshot". -> /impeccable clarify
[P1] Nothing tells the owner the link is public/unauthenticated. "read only" pill misleads toward safety. Copy toast prints the full secret URL (SnipController.tsx:125) — in a screenshot tool. -> /impeccable clarify
[P1] Automatic drain hijacks clipboard and toasts while claiming to be quiet (SnipController.tsx:281; announce unconditionally copies). Runs 4s after mount and on every online event. -> /impeccable harden
[P1] Dead share link answers HTTP 200 (verified dev; needs prod re-confirmation). Shell renders outside Suspense so headers flush before notFound(). No s/not-found.tsx. -> /impeccable harden
[P2] Library has no way to find a snip — no search, kind filter or date grouping. -> /impeccable layout
[P2] Both destructive confirms render as near-white default buttons; DESIGN.md section 5 specifies variant="destructive". -> /impeccable polish
[P2] A11y gaps: /s has no heading (2.4.6 AA); progressbar has no accessible name (4.1.2 A); shortcut recorder swallows Tab without advising Escape (2.1.2/3.3.2 A); Loader2 freezes under prefers-reduced-motion. -> /impeccable harden
[P2] SnipSettingsPopover:52 reintroduces the snapshot-identity trap page.tsx:102-105 documents avoiding. -> /impeccable optimize

## Persona Red Flags

Ada (support lead, 30 snips/day): scroll hunt to find anything; no keyboard copy route; global settings lock; tokens in toasts while screen-sharing; no bulk delete against a 500 cap.
Tom (new hire, Mac): promised a mic that does not exist and system audio that is unsupported on his platform; never told the shortcut is global; learns about auto-delete from a text-xs clause; retention re-stamp warning vanishes with the toast.
Priya (external recipient): tab says "Shared Screenshot" for a video; "read only" answers the wrong question; expired link = bare framework 404, no branding, no "ask the sender"; no document outline for a screen reader.

## Minor Observations

- backdrop-blur-[2px] play badge is decorative glass (DESIGN.md section 1).
- text-orange-300/90 stacks opacity on de-emphasised text.
- PendingUploads.formatWhen renders a UTC date among viewer-zone siblings; relative stamps and snipExpiryLabel both freeze for the life of the mount.
- toast.success('Recording deleted') claims a deletion it cannot confirm on an old shell.
- Doc/impl mismatch (rule 11): spoke documents three per-row actions incl. "Retry now"; Retry exists only in the panel header.
- s/layout.tsx:19 hard-codes bg-[#09090b] text-white.
- checking-state skeleton not shaped to the layout it becomes.
- Count line's aria-live announces the retention clause on every page append.

## Questions to Consider

1. If the share link is a bearer token, why is copy silent and delete confirmed? The confirmation is on the wrong verb.
2. Should the copy toast be where a snip gets a name? Solves retrieval, search and recipient context at the only moment the user remembers what it was for.
3. Why does the owner never learn their link died?
4. Is a card grid right at all for objects with no names? A date-headed timeline makes retrieval ordinal, not visual.
