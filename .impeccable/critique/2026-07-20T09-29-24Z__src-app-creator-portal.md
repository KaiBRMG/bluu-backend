---
target: src/app/creator-portal
total_score: 21
p0_count: 0
p1_count: 3
timestamp: 2026-07-20T09-29-24Z
slug: src-app-creator-portal
---
⚠️ DEGRADED: single-context (no sub-agent spawned — session policy: agents only on explicit request)

# Critique — `src/app/creator-portal`

Register: **Product** (app UI serving an external creator audience in a system browser). Reference implementation for the house style is the internal console per DESIGN.md, but the creator portal is a distinct, brand-forward skin.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Spinner mid-layout instead of skeletons; dashboard "complete" gives no success toast; snapshot data pops in with no loading state |
| 2 | Match System / Real World | 3 | "Completed" button reads as a status label, not an action; unexplained jargon (PPV, OF TL, Dripfeed, CR) shown to creators |
| 3 | User Control and Freedom | 1 | No undo after marking a custom complete on the dashboard — card just vanishes; hand-rolled modals have no Esc-to-close |
| 4 | Consistency and Standards | 1 | Three different detail-modal patterns, three "complete" treatments, two status-color sources, three visual identities (login / dashboard / console) |
| 5 | Error Prevention | 2 | No confirmation before optimistic removal of a high-ticket custom; easy to misfire the green CTA |
| 6 | Recognition Rather Than Recall | 3 | Good info popovers and labeled nav, but carousels hide items off-screen |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts, no bulk actions, carousel forces one-at-a-time paging, no Esc |
| 8 | Aesthetic and Minimalist Design | 2 | Gradient+glow buttons, drop-shadowed gradient cards, purple radial mood-lighting — decoration over state |
| 9 | Error Recovery | 3 | Login error mapping is excellent; mutation failures are generic ("Failed to…") |
| 10 | Help and Documentation | 3 | Welcome page + inline info popovers are genuinely helpful |
| **Total** | | **21/40** | **Acceptable (low end)** |

## Anti-Patterns Verdict

**LLM assessment:** Not flat-generic AI slop, but it trips the *product* slop test in the other direction — over-decoration. Gradient green "Completed" buttons with glow shadows (`boxShadow: 0 0 12px rgba(16,185,129,0.35)`), drop-shadowed gradient cards (`0 4px 24px rgba(0,0,0,0.3)`), and a purple radial hero glow are exactly the "gratuitous glow / over-decorated affordance" tells the product register warns against. Worse, they contradict the project's own DESIGN.md ("The No-Shadow Rule", "The Semantic-Only Rule", Action Blue as the one voice). The portal has silently forked into a purple/gradient identity that no design doc captures.

**Deterministic scan:** `detect.mjs` returned 30 advisory findings (exit 2), all two families:
- **design-system-color (22):** undocumented `#8b5cf6`/`#6366f1` (violet accent), `#059669`/`#10b981` (green gradient), `#c4b5fd`, and many `rgba(139,92,246,*)` / `rgba(99,102,241,*)` washes — across `dashboard/page.tsx`, `welcome/page.tsx`, `content-requests/page.tsx`.
- **design-system-font-size (8):** `text-[10px]` off the documented ramp in all three data pages.

The scan confirms the schism quantitatively: the entire creator-portal palette lives outside DESIGN.md. These are "advisory" (legitimate-or-drift), and here they read as **undocumented drift**, not intentional system additions.

No browser overlay: no dev server running and the portal is auth-gated behind creator login, so live injection was not attempted.

## Overall Impression

This is a competent, genuinely friendly creator surface — the welcome page, info popovers, and login error handling are better than most internal tools ship. But it's three products wearing three faces: a glassmorphic image-backed **login**, a purple-glow gradient **dashboard**, and a greyscale-console **data table** aesthetic, none reconciled. The single biggest opportunity is to **decide what the creator portal is** (a warmer branded skin is defensible for external creators) and then make it consistent and documented — right now the divergence is accidental, not authored.

## What's Working

1. **Login error recovery (P-none).** `login/page.tsx` maps Firebase codes to specific, plain-language messages ("Invalid email or password.", "This account has been deactivated. Please contact your administrator.", rate-limit copy). This is textbook heuristic-9 work.
2. **Contextual help.** The `Welcome` page + per-section `Popover` info buttons ("These are high-ticket custom requests…") teach the interface in place — recognition over recall, done right.
3. **Responsive table→card split.** `all-customs` and `content-requests` render a real `<Table>` on desktop and a tappable card list on mobile, with overdue emphasis carried through both.

## Priority Issues

### [P1] "Completed" is a state word doing an action's job — with no undo
On the dashboard (`page.tsx` `CPCard`/`EntryCard`) and content-requests detail modal, the primary green button is labelled **"Completed"** (past tense). It reads as a status badge, not a verb, and clicking it **optimistically removes the card** with no confirmation and no undo path on that screen (`handleComplete` filters the entry out immediately). A creator who misclicks a high-ticket custom has no way back from the dashboard. `all-customs` *does* offer "Mark as Incomplete" — proof the revert exists — but the dashboard hides it.
- **Why it matters:** Irreversible-feeling destructive action on the money-making records, triggered by an ambiguous label. Exactly what Error Prevention + User Control exist to stop.
- **Fix:** Relabel to **"Mark Completed"**. Add an undo affordance — a `toast` with an Undo action (you already restore on API failure; wire the same restore to a user-triggered undo), or a lightweight confirm for customs. Keep the optimistic UX; just make it recoverable.
- **Suggested command:** `/impeccable clarify` (label + confirm copy), then `/impeccable harden` (undo/edge cases).

### [P1] Hand-rolled modals break keyboard & screen-reader users
`CRDetailOverlay`, `DetailModal`, and the wrong-account error are click-a-`<div>` overlays via `createPortal` with **no `role="dialog"`, no `aria-modal`, no focus trap, and no Esc-to-close** (`all-customs` `DetailCard` can only be dismissed by its "Close" button — no outside-click, no Esc either). shadcn's `Dialog` already solves all of this, and DESIGN.md forbids hand-rolling a primitive that exists in `src/components/ui`.
- **Why it matters:** Keyboard-only and screen-reader creators (persona Sam) can open a detail view and get stuck; focus stays behind the overlay. It's also three bespoke implementations of one thing.
- **Fix:** Replace all three with the shadcn `Dialog` primitive. One `<CreatorDetailDialog>` component, reused across dashboard / all-customs / content-requests.
- **Suggested command:** `/impeccable harden` (a11y + consolidate), supported by `/impeccable audit`.

### [P1] The portal has forked into an undocumented visual identity
DESIGN.md defines a greyscale, no-shadow, Action-Blue-only console. The creator portal instead uses violet accents (`#8b5cf6`/`#6366f1`), green gradient CTAs, glow and drop shadows, and purple radial background wash — 22 undocumented colors by the scanner. A distinct, warmer skin for *external creators* is a reasonable call, but nothing records that decision, so every page improvises its own version (five hardcoded content-type hues in `content-requests`, `STATUS_COLORS` in `all-customs`, inline greens on the dashboard).
- **Why it matters:** Consistency is the product register's core virtue. Right now "the same thing looks different in three places," which erodes trust and makes maintenance guesswork.
- **Fix:** Decide intentionally. Either (a) pull the portal back toward DESIGN.md (Action Blue CTAs, no shadows, central status colors), or (b) author a **creator-portal design spec** (or a `## Creator Portal` section in DESIGN.md) that legitimizes the violet/gradient language, then centralize its tokens and apply them uniformly. Kill the ad-hoc per-page color maps either way.
- **Suggested command:** `/impeccable document` (capture the intended system), then `/impeccable polish` to reconcile.

### [P2] Spinners mid-layout instead of skeletons
`all-customs`, `content-requests`, and the dashboard auth gate all render a centered violet spinner while loading; the dashboard's snapshot data simply pops in with no loading state at all. DESIGN.md is explicit: `Skeleton` shaped to the final layout, never a bare spinner mid-content.
- **Why it matters:** Layout shift and a "blank then flash" feel on every visit; inconsistent with the rest of the app.
- **Fix:** Swap for `Skeleton` rows/cards matching the table and tile layouts.
- **Suggested command:** `/impeccable polish`.

### [P2] Carousels force one-at-a-time paging on desktop
The dashboard shows customs and content-planning inside horizontal `Carousel`s (`basis-[85%]`), so a creator with several outstanding items must click prev/next through them one card at a time — even on a wide screen where a grid or list would show everything at once.
- **Why it matters:** Efficiency (persona Alex/Casey): the primary "what do I owe" scan becomes a paging chore, and off-screen items are easy to forget.
- **Fix:** On `sm+`, switch to a responsive grid (`repeat(auto-fit, minmax(240px, 1fr))`); reserve the carousel for the narrow mobile peek if desired.
- **Suggested command:** `/impeccable layout`.

## Persona Red Flags

**Sam (Accessibility-Dependent):** Opens a custom's detail modal, presses Esc — nothing happens (no keyboard dismiss on any of the three overlays). Screen reader never announces a dialog (no `role`/`aria-modal`). `text-zinc-600` empty-state and eyebrow text ("Creator Portal", "All caught up!") on `#09090b` is well under 4.5:1. Profile avatar is a raw `<img>`, not the `Avatar` primitive.

**Riley (Stress Tester):** Marks a custom "Completed" by accident on the dashboard — the card vanishes with no undo on that screen. Deep-links `?crId=` to a foreign account and gets a correct wrong-account modal (good), but that modal also can't be Esc-dismissed. Content-type falls through to a zinc fallback badge for any unmapped type — silent, but at least safe.

**Casey (Distracted Mobile Creator — project persona):** One-handed, marking work done between tasks. The green "Completed" CTA sits at the *bottom* of each card (good, thumb-reachable), but the horizontal carousel demands precise sideways swipes to find items, and there's no state persistence hint if she's interrupted mid-scroll. Login is image-heavy (`2_blur.png` full-bleed) on what may be a slow connection.

## Minor Observations

- Success feedback is inconsistent: `all-customs`/`content-requests` `toast.success` on complete; the dashboard is silent.
- `text-[10px]` badges appear in all three data pages — off the documented ramp (scanner flagged 8).
- Empty states carry a little icon-in-circle ("All caught up!") — friendlier than DESIGN.md's "one quiet line" rule, defensible for this audience but another undocumented divergence.
- Login is a fourth aesthetic (glassmorphic, image-backed, white button) unrelated to the rest of the portal.
- `formatAmount`/tabular alignment: amounts in cards aren't `tabular-nums`, so they won't column-align (DESIGN.md Tabular Rule).

## Questions to Consider

- Is the violet/gradient creator skin a deliberate brand choice, or drift that should snap back to the console's greyscale?
- What would "one detail view, everywhere" look like — and why are there three today?
- If marking a custom complete is the portal's single most important action, why is it the least reversible?
- Does a creator with five outstanding items ever want to *page* through them, or see them all at once?
