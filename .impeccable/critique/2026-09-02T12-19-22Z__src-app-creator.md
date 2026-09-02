---
target: src/app/creator (Creator Portal, post mobile/PWA pass)
total_score: 23
p0_count: 1
p1_count: 2
timestamp: 2026-09-02T12-19-22Z
slug: src-app-creator
---
Method: dual-agent (A: design review · B: detector + static measurement), isolated and parallel. Browser visualization did not run — no browser automation tool is exposed in this session, so no dev server, no live-server, no overlay. All rendered claims are inferred from source and arithmetic, and every contrast figure below was recomputed independently by the parent.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Firestore listener errors never resolve the loading flags — dashboard skeletons spin forever. No navigation feedback anywhere in the segment. |
| 2 | Match System / Real World | 3 | "Mark Completed" actually routes the record to *Awaiting Approval*. The button names an outcome the system does not produce. |
| 3 | User Control and Freedom | 2 | Undo exists only on the dashboard. `content-requests` has no revert path at all — a creator can never un-complete a content item from that page. |
| 4 | Consistency and Standards | 2 | Three labels for one action; two empty-state vocabularies; due-date colour means opposite things on two cards in the same scroll. |
| 5 | Error Prevention | 2 | The two-step customs confirmation is bypassed entirely by `all-customs`' dropdown, which completes the same high-ticket record in one tap. |
| 6 | Recognition Rather Than Recall | 3 | The CR-code upload convention lives in a popover on the dashboard, not in the dialog that holds the Upload button. |
| 7 | Flexibility and Efficiency | 2 | No search, filter, sort, page-size or bulk action on either list page. 20/page, paging only. |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely restrained and one accent voice held portal-wide — undercut by the eyebrow/greeting/install stack and three identical tiles, two usually empty. |
| 9 | Error Recovery | 1 | A failed query renders as "No custom requests found." The creator is told they have no work. |
| 10 | Help and Documentation | 3 | Welcome page and info popovers are strong. Login errors say "contact your administrator" with no way to do so. |
| **Total** | | **23/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**Does this look AI-generated? The interior does not. The front door does.**

**LLM assessment.** `theme.ts`, `nav.ts`, `InstallPrompt.tsx` and the two shared dialogs are visibly hand-reasoned — they encode constraints rather than describe them. Against that, two real slop tells:

- **The login page is outside the design system.** `login/page.tsx:65` is `bg-zinc-900/80 backdrop-blur-md` over a photo with a `bg-black/50` scrim — decorative glassmorphism, and specifically the construction DESIGN.md §5 forbids for stepped flows ("over a photo it drops body text under 4.5:1"). It imports nothing from `theme.ts` but `PRIMARY_BTN`. The first screen a creator ever sees is the one screen that isn't the product.
- **The eyebrow is a scaffold, not a kicker.** DESIGN.md:205 permits it as "a deliberate, single-use brand device, **not a per-section scaffold**," at 11px/`0.06em`. The portal runs it at 12px/`0.2em` — louder than the system's own spec — on the dashboard *and* the welcome page, alongside a second uppercase treatment on every dialog field label and the "Fan" label. Four uppercase-tracked treatments in a four-page portal. The tell: "Creator Portal" sits directly beneath a sticky header whose only content is the Bluu logo. It names the thing the user is already inside, and on a phone it costs the vertical inch that decides whether the first outstanding item is above the fold.

Clear on: side-stripes, gradient text, gradient fills, hero-metric template (notably absent — the obvious reflex on this surface), numbered markers. Partial on identical card grids (three structurally identical `TypeTile`s, two usually empty).

**Deterministic scan.** `detect.mjs` on `src/app/creator` → exit 2, **8 findings: 6 × `design-system-font-size`, 2 × `gray-on-color`. All 8 are false positives.** The six font-size hits are `text-[10px]` badges, which DESIGN.md §7 documents as this skin's dense-caption step. The two `gray-on-color` hits are both `dashboard/layout.tsx:46` — the detector flattened one `className` string and paired the resting `text-zinc-400` with the `data-[active=true]:bg-sky-500/15` tint, which never co-occur; the real active pair is `sky-100` on `sky-500/15` at 13.42:1. **Net: the detector found nothing real here.** That is a meaningful signal in itself — the deterministic layer is clean and every genuine problem below required reasoning to find.

**Where the detector beat the review.** One finding Assessment A missed entirely and B caught by measurement: **`COMPLETE_BTN` is white on `emerald-600` = 3.77:1** (`theme.ts`), applied at 14px/500 weight — not large text, so 4.5:1 applies. It fails at all four call sites. This is the portal's success action. `emerald-700` (already the hover colour) measures 5.48:1 and passes.

**Visual overlays.** None. No browser automation is exposed in this session, so no overlay was injected and none is visible in a browser. Reported as a genuine gap, not a skipped step.

## Overall Impression

This is a well-built portal with a hole in its floor. The craft on display is real — the optimistic-complete path restores a card to its *correct sorted position* on failure, `InstallPrompt` dodges three separate platform traps in fifty lines, `nav.ts` makes sidebar/tab-bar divergence structurally impossible. Someone was thinking.

But the product has exactly one job: tell an external creator what they owe the agency. And when the query fails, it tells them they owe nothing. Everything else in this report is cosmetics next to that.

The single biggest opportunity is not on this list of fixes: **the dashboard is organised by the agency's taxonomy (CR / Call / Item) rather than by the creator's question (what's due first?).** A creator merges three lists sorted by two different keys in their head, and one of those card types has no overdue calculation at all.

## What's Working

**1. `nav.ts` encodes its own constraint.** Two fields — `title` for the sidebar, `shortTitle` for the tab bar — with the reason for the second stated in the header comment. Both navs read the same array, so the classic dual-nav failure (two arrays that agree on ship day and diverge a month later) is impossible rather than merely discouraged.

**2. The optimistic-complete path is correct, not merely present.** `dashboard/page.tsx:372-404` captures the entry before mutating, restores it *through `sortCP`* so a failed complete returns the card to its right position rather than the end of the list, and `revertCp` is idempotent against a snapshot that may have already re-added the row. Restoring position is the part everyone skips.

**3. `InstallPrompt` is the best-engineered file in the segment.** It excludes Chrome/Firefox/Edge on iOS because those browsers *cannot* add to the home screen; it reads the environment through `useSyncExternalStore` with a `false` server snapshot so it cannot hydrate-flash; and it dismisses after `userChoice` regardless of outcome, so a declined install never leaves a dead button.

## Priority Issues

### [P0] A failed query is rendered to the creator as "you have no work"

**What.** `dashboard/page.tsx:316-318` and `:364-366` — the `onSnapshot` error callbacks only `console.error`; `entriesLoaded`/`cpLoaded` are never set, so the skeletons spin indefinitely with no message and no retry. Worse, `all-customs/page.tsx:56-59` and `content-requests/page.tsx:87-90` *do* call `setLoading(false)` in the error path, which falls straight through to the `entries.length === 0` branch and renders **"No custom requests found."** (Confirmed by my own read, not passed through.)

**Why it matters.** A permission change, an index rebuild, a dropped connection or an expired token is presented to an external creator as an authoritative statement that they are caught up. They close the app. Missed deadlines on high-ticket work follow, and neither the creator nor the agency gets any signal that anything failed. It is silent, plausible, and it inverts the product's one job.

**Fix.** Add an `error` state to all four listeners. Render a distinct state — one line plus a Retry that re-subscribes: *"Couldn't load your requests. Check your connection and try again."* The empty branch must be reachable **only** from a successful snapshot with zero docs. On the dashboard, set the `*Loaded` flags in the error path so the skeletons resolve.

**Suggested command:** `/impeccable harden`

### [P1] Completion is irreversible on one page, undoable on another, and the moment itself says nothing

**What.** Verified directly:
- `content-requests/page.tsx:97-99` sends no body, shows a bare `toast.success`, and the dropdown offers no action for `Completed` items. **A content item completed there can never be un-completed by the creator.** The identical record completed from the dashboard is fully undoable. This violates DESIGN.md portal rule 5.
- `all-customs/page.tsx:63-71` *does* have a revert path (dropdown → "Mark as Incomplete") — Assessment A overstated this — but its toast carries **no Undo action**, so recovery requires knowing to reopen a dropdown.
- Success copy is `"Marked completed"` everywhere. The system moves the record to *Awaiting Approval* — the revert toast says so — but the success path never tells the creator their work reached a human.

**Why it matters.** Reversibility is what makes a one-tap action safe, and here it is strongest where stakes are lowest and weakest where they're highest. A creator who just submitted a $600 custom gets a two-word grey toast that expires in four seconds. This is the peak moment of the product.

**Fix.** Give `content-requests` the `{revert:true}` path the endpoint already supports, plus a `Completed → Mark as Incomplete` item. Add the Undo action to `all-customs`' toast. Change success copy to name the real outcome — *"CR0042 sent to your manager for review."* Standardise on **"Mark Completed"** everywhere.

**Suggested command:** `/impeccable clarify`

### [P1] The portal's default de-emphasis colour fails AA, and the new tab bar's active state fails the non-text floor

**What.** Both agents landed on identical numbers and I recomputed all of them:

| Pair | Ratio | Needs | |
|---|---|---|---|
| `text-zinc-500` on the `#09090b` ground | **4.12:1** | 4.5:1 | ✗ |
| `text-zinc-500` on `SURFACE.card` | **3.92:1** | 4.5:1 | ✗ |
| white on `emerald-600` (`COMPLETE_BTN`) | **3.77:1** | 4.5:1 | ✗ |
| `placeholder-zinc-500` on `bg-zinc-800` | **3.08:1** | 4.5:1 | ✗ |
| active `sky-300` vs inactive `zinc-500` (tab state) | **2.90:1** | 3:1 | ✗ |
| `text-zinc-400` on the ground | 7.76:1 | 4.5:1 | ✓ |

DESIGN.md:161 already says this outright — Ink Muted "fails AA on every ground in the app, including the near-black one… **Not a text colour**" — and the portal uses it as its default de-emphasis step in **18 places**, including every dialog field label, every mobile list-card meta line, `InstallPrompt`'s entire body copy, and the inactive tab labels I just added.

**The tab bar has a second failure, and it's the interesting one.** Active-vs-inactive measures 2.90:1, under WCAG 1.4.11's 3:1 for a state indicator — and **the obvious fix makes it worse**: raising inactive to the compliant `zinc-400` collapses state separation to **1.54:1**. That proves colour cannot carry this state alone. My `strokeWidth` 1.75→2.25 delta is not a legible cue at 20px on a phone. This one is mine and it needs a shape.

**Fix.** Swap `text-zinc-500` → `text-zinc-400` for anything carrying text in the segment (near-mechanical). Re-ink `COMPLETE_BTN` to `emerald-700`. Give the active tab a **shape** cue — a 2px `sky-400` bar on the top edge, or a filled pill behind the icon — *then* raise inactive to `zinc-400`. Add `focus-visible:ring-2 ring-inset` to the tab links.

**Suggested command:** `/impeccable audit`

### [P2] Touch targets: the bar I added passes; most of the buttons around it don't

**What.** The bottom nav measures 64 × ~97px per tab — comfortably clear. But B's enumeration found the `after:-inset-N` hit-expansion trick applied in only 7 places, and absent from every one of these: **"Mark Completed"** (`h-8` = 32px on `CPCard`, `h-9` = 36px in both dialogs), **"Mark Incomplete"** (32), **"Open Drive"** (32), **"Open Folder"** (28), **`InstallPrompt`'s Install** (32), **`ProfileMenu` trigger** (36), **Sign Out** (36), **the dialog close X** (16 × 16, unpadded), and **all pagination controls** (36 — and they render on mobile with no responsive treatment at all).

The completion button is the portal's primary action, and on a phone it is 32px.

**Why it matters.** The whole point of the bottom-nav change was one-handed reachability. Fixing navigation while the action at the end of every journey stays 32px is half a job.

**Fix.** `size="lg"` or explicit `h-11` on every completion/primary action in the segment; `py-3` on the Drive/Folder/Upload links; `after:-inset-2` on the dialog close; gate pagination behind `md:` or give it 44px controls.

**Suggested command:** `/impeccable adapt`

### [P2] The toast lands on the tab bar — the Undo sits under the thumb that just tapped

**What.** Both agents found this independently, which is why I rate it above the other polish items. `<Toaster />` is mounted in `src/app/layout.tsx:43` with **no props**, so sonner's defaults apply: `bottom-right`, mobile offset `16px`, z-index ~999999999. `CreatorBottomNav` is `fixed bottom-0 h-16`. Every toast therefore renders **directly over** the tab bar — including the Undo button, positioned exactly where the thumb that completed the item is resting, and over the "Customs"/"Content" labels. On iPhone it also intrudes into the home-indicator zone.

A second, related gap: there is no `NavigationProgress` equivalent in `/creator`. A `<Link>` transition keeps the current page mounted and interactive, so on a slow connection a tab tap produces *nothing*. CLAUDE.md documents this exact failure and its fix for the console; the phone-first portal didn't get it.

**Fix.** `mobileOffset={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}` on the Toaster (or `position="top-center"` for this segment). Mount a portal-scoped navigation hairline in `dashboard/layout.tsx`.

**Suggested command:** `/impeccable polish`

## Persona Red Flags

**Casey (distracted, one-handed, slow connection — the primary user of this surface)**
- Taps "Customs" on 3G and **nothing happens**. No progress, no skeleton, no state change. She taps again.
- Completes a content item and her **Undo is under her thumb, on top of the "Content" tab**. Four seconds later it's gone.
- **56px of dead sticky chrome on three of four pages.** On `welcome`, `all-customs` and `content-requests`, the header's only interactive element was the `SidebarTrigger` I just made `hidden md:inline-flex` — and the logo beside it is explicitly `pointer-events-none`. Those headers now contain **zero tappable pixels on a phone** while permanently occupying the top of the viewport. The logo isn't even a link home.
- **64px of phantom scroll on every page.** B confirmed my `pb-[calc(4rem+env(safe-area-inset-bottom))]` matches the bar exactly — but every page ground is `min-h-dvh` *inside* that padded container, so minimum document height is `100dvh + 64px`. Even an empty `all-customs` scrolls, and the pull yields flat ground. Fix: `min-h-full` on the page grounds, or move the padding onto each page's `<main>`.
- Her **overdue custom looks identical to one due in three weeks** — `CustomCard` paints every due date `text-rose-300` unconditionally, while `CPCard` two sections below uses red to mean *late*. Same scroll, opposite meanings. Customs have no overdue calculation at all.
- Scrolls past **two "All caught up!" panels** to reach her actual work (three `TypeTile`s stack below `sm`; Calls and Items are usually empty).

**Sam (screen reader / keyboard)**
- Every de-emphasised line in the portal is 3.9–4.1:1. Not an edge case — the default.
- **Two `<main>` landmarks on every dashboard page.** Verified: `SidebarInset` renders `<main>` (`sidebar.tsx:324-326`) and each page renders its own inside it.
- **`/creator/login` has no heading of any kind** and no `<main>`.
- `CreatorDialog` never renders a `DialogDescription`, and `CustomRequestDialog`'s title is a `<span>` holding **only the CR code** — the dialog announces as "CR0042, dialog", with no indication it is a detail view containing a completion action.
- The two `MoreHorizontal` dropdown triggers have **no `aria-label` and no `sr-only` text** — unnamed icon-only buttons.
- **No focus styling on the primary navigation.** My tab links carry only `active:bg-white/5`; `CustomCard` has `active:scale-[0.98]` and no ring.
- `aria-current` is on the new tab bar but **absent from the desktop sidebar** (`isActive` renders as `data-active`, a styling hook with no ARIA mapping).
- Pagination uses `href="#"` + `preventDefault` with `aria-disabled` but no `disabled` — at page 1, "Previous" is focusable and announces as an available link that does nothing.
- `InstallPrompt`'s iOS instruction puts `aria-label="Share"` on a role-less `<svg>` while the paired glyph is `aria-hidden` — most readers announce "Tap then Add to Home Screen", with both referenced controls silently missing. That one is mine.

**Jordan (first-timer)**
- The front door looks like a different product from what's behind it.
- **The first screen tells them they're finished.** With no assignments yet, the dashboard is four identical "All caught up!" seals and nothing saying *"Your manager will add requests here."* Empty-because-nothing is indistinguishable from empty-because-done.
- **"Welcome" as a permanent tab is a riddle** — a document they read once, holding 25% of the primary navigation forever. And "Content" sits one 11px word from "Customs": both abstract nouns, both starting with C, icons that don't disambiguate at 20px.
- Asked to install the app **before knowing whether it's useful** — the banner is the second element below their own name, on visit one.

## Minor Observations

- `content-requests/page.tsx:92` uses `[creatorUser]` (object identity) as the effect dep while every other listener uses `[creatorUser?.creatorID]` — the Firestore subscription tears down and re-subscribes on any provider re-render. Mobile data and battery, and it runs against CLAUDE.md rule 9.
- **Due dates are timezone-naive.** `isCPOverdue` uses `dueDate + "T23:59:59Z"` — UTC for everyone. A creator in UTC+10 sees an item flip to Overdue ten hours late. Due dates are this product's core mechanic.
- `contentStatusBadge` paints **"Outstanding" in red**; DESIGN.md assigns orange to awaiting/pending and red to error/rejected. Twelve planned items render as twelve red badges saying something is wrong when nothing is.
- `text-rose-300` is not in `theme.ts` and not in the DESIGN.md palette — an inline hue, against portal rule 1.
- Both list pages wrap their empty state in a bordered box (`rounded-2xl p-12` + `SURFACE.panel`); DESIGN.md:381 forbids a border around a single sentence.
- Both list pages' skeletons are six loose `h-14` pills standing in for a bordered table on desktop and ~92px cards on mobile — both jump on data arrival.
- Dialog `grid-cols-2` (`CustomRequestDialog`, `ContentPlanDialog`) has **no mobile treatment** — fixed 2-up inside a dialog that is `max-w-[calc(100%-2rem)]` on a phone.
- `dashboard/page.tsx:500` jumps `grid-cols-1 → sm:grid-cols-3` with no 2-column step.
- `CreatorDialog.tsx:44` — `max-h-[85vh]` is the one `vh` unit left reaching this segment after the `dvh` sweep. On iOS `vh` is the *large* viewport, so with the URL bar expanded it can exceed 85% of what's visible.
- `z-40` literals on both the sticky headers and my tab bar; the `--z-*` scale in `globals.css` exists and is referenced nowhere in this segment (Named-Layer Rule).
- `manifest.webmanifest` sets `"orientation": "portrait"` — on an installed iPad that locks the `md`-and-up sidebar/table layout to portrait. Mine; probably wrong.
- No `apple-touch-startup-image`, so the installed iOS app shows a blank splash before a first paint that is itself a spinner.
- `login/page.tsx:24-28` — a correct password against a missing `creators` doc returns a different message than a wrong password. That's an account-enumeration oracle.
- Sign-out exists in exactly one place: `ProfileMenu`, rendered only on the dashboard. Not stranded (one tap via the tab bar) but nothing signals where account controls live — and on desktop the sidebar has no footer block at all, so it's the same detour with no tab bar to make it cheap.
- `PRIMARY_BTN` appears exactly once portal-wide. Portal rule 3 honoured — worth crediting, since it's the rule most likely to erode.

## Questions to Consider

1. **Why is the dashboard organised by record type rather than by when things are due?** CR/Call/Item is the agency's taxonomy for its own tracking. The creator's question is "what's due first?", and answering it means merging three lists sorted by two different keys. What would this page look like as one urgency-ordered list with type as a chip?
2. **The tab bar carries no number.** The one fact a creator opens this app to learn is a count of outstanding work, and the one element visible on every screen is the one place it isn't.
3. **Is "Welcome" worth a permanent quarter of the primary navigation?** The constraint that bites isn't a fifth tab — it's that one of the four is spent on a document read once.
4. **If completion always routes to Awaiting Approval, is "Mark Completed" honest?** "Submit for review" is what happens, and it's the more reassuring phrase — it implies a person on the other end.
5. **The two-step for customs protects against a stray tap. What protects against a *wrong* tap?** The dialog shows the CR code, fan and amount, but the button says "Mark Completed" whichever record is open. Would `Mark CR0042 Completed` do more work than the extra step does?
