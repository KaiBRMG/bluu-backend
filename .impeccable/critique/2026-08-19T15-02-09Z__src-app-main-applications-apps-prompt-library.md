---
target: src/app/(main)/applications/apps-prompt-library
total_score: 27
p0_count: 0
p1_count: 3
timestamp: 2026-08-19T15-02-09Z
slug: src-app-main-applications-apps-prompt-library
---
Method: dual-agent (A: design review, isolated | B: detector + deterministic evidence, isolated).
Browser inspection unavailable - no browser automation tool exposed; no visual overlay produced.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Home board has no loading skeleton; search answers "No prompt matches" during initial fetch |
| 2 | Match System / Real World | 3 | "v3 of 7" / "Edited from v2" are right. "Uncategorised" is a column no picker can produce |
| 3 | User Control and Freedom | 3 | Best-in-app unsaved-changes guard, but no "Restore this version"; Esc in search deletes the query |
| 4 | Consistency and Standards | 2 | Near-white primary buttons beside #2563eb chips; two input vocabularies; three greys for one role |
| 5 | Error Prevention | 3 | Close guard + focus-first-invalid are real work. Model cap fails silently at 12; zero concurrency detection |
| 6 | Recognition Rather Than Recall | 2 | Cannot compare two arbitrary versions - only current vs basedOn |
| 7 | Flexibility and Efficiency | 2 | No / or Cmd-K to focus search; no bulk actions; no copy-without-opening; v40 to v3 is 37 clicks |
| 8 | Aesthetic and Minimalist Design | 3 | Search adds a result list above a still-complete board rather than narrowing the page |
| 9 | Error Recovery | 3 | FieldError + aria-describedby is a proper pattern; 409 "unchanged" leaks a raw server string |
| 10 | Help and Documentation | 3 | Shortcuts in aria-label not just title - above average |
| **Total** | | **27/40** | **Acceptable - solid foundation, real gaps** |

## Anti-Patterns Verdict

Not AI slop. Authored work with arguments behind its choices (CSS-multi-column masonry, basedOn lineage, monogram fallback chain, progressive disclosure as discipline).

Deterministic scan: detect.mjs exit 2, 1 finding, verified FALSE POSITIVE (LlmMark.tsx:109 text-[10px] is sanctioned by DESIGN.md:187 and :363). Net verified violations: 0. Clean on every ban: zero shadows, gradients, glassmorphism, side-stripes, raw img tags, magic z-indexes; 14/14 JSX maps have keys.

The drift here is semantic, not syntactic - invisible to the detector. Both agents independently landed on the same four text-zinc-500 sites (B by grep, A by contrast measurement).

## Overall Impression

Better than its score. Held back by one architectural decision and one omission.

The decision: the detail card is a 1152px modal that is always a live editor. Its stated rationale (keep the library visible behind) is defeated at w-[min(72rem,96vw)] max-h-[92vh]. Because RichPromptEditor mounts unconditionally, the most common action (read) carries the risk profile of the rarest (edit). Nearly every hard problem descends from that line.

The omission: version history is one-directional. Browsable, not restorable, and arbitrary versions cannot be compared.

Biggest opportunity: a read-first body with an explicit Edit.

## What's Working

1. The one-guard exit architecture (PromptDetailDialog.tsx:72-99, 291-308). Escape, overlay click, Close, beforeunload AND version-switching all funnel through one registerGuard closure, with two separately-worded confirmations for the two consequences.
2. The search is a real combobox (PromptSearch.tsx:118-133, 186-208): role=combobox + aria-activedescendant + aria-controls, role=option on the li itself, permanently-mounted live region, activeIndex clamped not reset. "matched in title, tags" makes fuzzy ranking legible; Highlight uses a white wash not yellow (correct Semantic-Only reading).
3. Progressive disclosure as a discipline: save bar only while dirty, "Create <x>" only when new, Show-archived only when relevant, history fetched only on open. Each argued in a comment at the point of decision.

Honourable mention: PromptKanban is not draggable despite its name. Refusing a fake drag affordance was right.

## Priority Issues

### [P1] Detail card is a near-fullscreen modal nesting three more modals

PromptDetailDialog.tsx:100 - max-h-[92vh] w-[min(72rem,96vw)], containing EditMetaDialog + three AlertDialogs.

Why it matters: justification defeated by its own dimensions; costs a URL for the open prompt (reload loses your place), browser back, shareable links, side-by-side comparison. DESIGN.md section 6 says do not reach for a modal first.

Fix: shrink to a ~560px right-hand Sheet inspector, or restore the route. Cheapest immediate win: ?prompt=<id> in the URL.

Suggested command: /impeccable shape

### [P1] No read mode - opening a prompt drops you into a live contentEditable

PromptDetailDialog.tsx:604-613 mounts RichPromptEditor unconditionally for every viewer. Verified: no read-only branch.

Why it matters: the spoke says the card is "mostly opened to read" but the surface presents an editor. One stray keystroke makes it dirty, which blocks Show-changes (:549), turns Escape into a confirmation, arms beforeunload.

Fix: render read-only by default via promptBodyHtml + dangerouslySetInnerHTML (safe per the total-attribute-strip); add an Edit button in the version rail.

Suggested command: /impeccable distill

### [P1] Version history cannot be restored from, and arbitrary versions cannot be compared

No "Restore this version" anywhere - verified the actions menu holds only Edit details / Archive / Delete. showDiff compares current vs current.basedOn only (:199-203, 600).

Why it matters: the only route to promoting v2 is to open it, perturb it to trip dirty, and save - fabricating a fake edit. basedOn means adjacent version numbers are not adjacent edits, so the missing pair-picker bites harder than in a linear history.

Fix: (1) "Restore this version" in the menu when not latest - exactly saveVersion({text: current.text, textHtml: current.textHtml, editNote: 'Restored from v2', basedOn: current.version}). No API change. (2) Turn the "v3 of 7" counter into a Popover changelog with author/date/note, from which you pick compare-from and view. wordDiff already accepts any two strings.

Suggested command: /impeccable craft

### [P2] Four contrast failures on text-zinc-500, one is a field's only visible name

#71717a on #09090b = 4.0:1, fails AA:

- NewPromptDialog.tsx:129 + EditMetaDialog.tsx:100 - "(pick one or more)", the only text stating cardinality
- PromptDetailDialog.tsx:631 - the length/2000 counter, the only surface stating that limit
- PromptDetailDialog.tsx:648 - placeholder:text-zinc-500, and the real label is sr-only, so this failing placeholder is the field's only visible name

Plus opacity-50 at :548 - passes at ~4.9:1 but violates DESIGN.md's explicit "never stack opacity" clause.

Fix: all four to text-zinc-400; make the edit-note label visible; drop the opacity-50.

Suggested command: /impeccable polish

### [P2] Search lies during load, has no debounce, does not narrow the page

page.tsx:139 renders PromptSearch while loading with an empty prompts array, so any query during fetch returns "No prompt matches every word. Try fewer words." PromptSearch.tsx:56 re-scores synchronously per keystroke, no debounce or useTransition. The board renders unconditionally, so searching lengthens the page and can show the same prompt twice in two card designs.

Fix: pass loading in and render a skeleton list; separate "library is empty" from "no match"; wrap scoring in useTransition with aria-busy; collapse the board while searching.

Suggested command: /impeccable harden

## Persona Red Flags

**Alex (power user)**: No / or Cmd-K on the page whose reason to exist is finding a prompt. Escape in search deletes his query (PromptSearch.tsx:87-90, verified) - every other Escape dismisses; this one destroys input with no undo. No copy without opening a 1152px modal. No bulk anything. No j/k on the board though DESIGN.md section 5 establishes it for the satellite shell. Credit: Ctrl+S works with a blocked gate behind open AlertDialogs; the Cmd-B/sidebar collision is closed from both ends.

**Sam (screen reader + keyboard)**: The focus-indicator cluster is the biggest a11y gap - model chips, every board card, every model tile, the clear-search button and every tag-removal chip define no focus-visible styling, and there is no global focus rule in globals.css. Acute on ModelPicker, where selection is signalled by bg-[#2563eb] alone. page.tsx:103 does have focus-visible:ring-2, so the team knows the pattern. role=toolbar (RichPromptEditor.tsx:196) has four tab stops where APG specifies one with arrow traversal. Nothing announces the document became dirty. document.getElementById('prompt-models')?.focus() is a no-op - verified the target is a fieldset, not focusable without tabindex, so focus-first-invalid silently fails for the first field (same bug at EditMetaDialog.tsx:81/98). DiffView passes cleanly (ins/del + underline/strike + visible legend).

**Riley (stress tester)**: Concurrency is the sharpest gap - no detection at any layer. A saves v4; B still sees v3 labelled "Latest" while the save bar promises "saving creates v4 from v3". The server appends safely at versionCount+1 so nothing is destroyed, but the UI made a factual promise it cannot keep and never corrects, with no refresh path from the detail card. At 1000 prompts PromptKanban renders every card with no virtualisation; break-inside-avoid over 1000 nodes is a known layout-thrash case. Paste from Word is forced to plain text (correct) but has no length guard - a 200k paste hangs the DOM then fails after a round trip. At 0 items the user sees three different framings of empty. Column headings are truncate with no title attribute.

## Minor Observations

- LlmMark.tsx:74 - name.trim().charAt(0) splits surrogate pairs; a model named with a leading emoji renders tofu. Fix: spread the string and take index 0.
- DiffView.tsx:23 - fallback copy references a summary that was removed with describeChange
- PromptDetailDialog.tsx:534 - word count includes the list markers htmlToPlainText injects
- Edit-note field has two names (placeholder "Edit Notes", sr-only label "Edit note")
- PromptSearch.tsx:206 - onMouseEnter relocates the keyboard cursor, firing spurious announcements
- Archive has no Undo toast, though DESIGN.md section 7 makes Undo-in-toast the house pattern
- Heading drift: text-2xl font-bold tracking-tight in three places vs DESIGN's 600 weight / normal tracking
- The model-tile volume bar runs at duration-500 (4x the 120ms budget) and at 2px/35% white is nearly invisible
- PromptKanban.tsx:33 creates an "Uncategorised" column no picker can produce

## Questions to Consider

1. If the detail card were a page again, what would actually be worse? Is the real requirement "do not lose my scroll position", and is that not solved by a scroll-restoring route?
2. What if reading and editing were different objects, and the editor were the rare one? Every hard problem descends from contentEditable being the default view.
3. Is "category" the right axis for the board? It admits to being "a recently-updated view that happens to be grouped". Why not group by model, as the home tiles already do?
4. The version doc stores editNote, author, timestamp, basedOn and ChangeStat - none exposed as a list. What if "v3 of 7" opened into the changelog this data is already shaped for?
