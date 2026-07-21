# Sign-out, login background, and the page-scroll fix

Three changes: sign-out on every step, the login background image across the flow, and the dead scroll space under the details card.

---

## 1. Sign out — every step

A **Sign out** control now sits at the top-right of the card header on all six steps, absolutely positioned so the wordmark stays optically centred rather than being shoved off-centre by it.

It mirrors `NavUser`'s handler exactly rather than reimplementing it: clock-out flush → `clearPermissionsCache()` → drop `sessionToken` → `auth.signOut()`. The clock-out flush is almost certainly a no-op during onboarding, but keeping the two paths identical means they can't drift — per time-tracking.md, leaving without it can strand a session open server-side.

Worth flagging: **there's no confirmation.** On the details step an accidental click loses unsaved form input. Terms acceptance and any already-saved profile data survive. Say the word and I'll add a confirm on that step only.

## 2. Login background across the flow

`/backgrounds/2_blur.png` now sits behind every step, with `bg-background` underneath as a fallback so the card can never land on white.

**This forced a card change.** The card was on DESIGN.md's translucent overlay recipe (`rgba(255,255,255,0.025)`), which assumes the near-black canvas behind it. Over a photo the image showed straight through and pushed body text below the 4.5:1 contrast floor. The card is now **opaque `#171717`** — the system's Surface token, and effectively what `Login`'s own card does.

Interior overlays (permission rows, the compliance note) are unchanged; they sit on the opaque card and behave normally.

Knock-on: on `#171717`, `text-zinc-500` hints measure ~3.8:1. Those hints carry real instructions, so I moved them to `text-xs text-zinc-400` (~7:1) — which is DESIGN.md's documented Label style, so size still carries the hierarchy. The sign-out button keeps `text-zinc-500 hover:text-zinc-300`, the system's documented treatment for icon/text buttons.

## 3. The empty scroll space — architecture, not arithmetic

Your screenshot showed the card ending high with a viewport of dead space below it. The cause was mine: I'd sized the form with `max-h-[calc(100vh - 32rem)]`, where `32rem` was **my estimate of the card's chrome height**. Estimate low and the card outgrows the viewport, the page scrolls, and everything below the card is empty.

Rather than re-tune the guess, I removed it:

- **Layout** → `h-screen overflow-hidden`. The page cannot scroll on any step.
- **Card** → `max-h-full` and a **flex column**: header and footer `shrink-0`, body `min-h-0 flex-1`.
- **Details form** → `min-h-0 flex-1 overflow-y-auto`, so it takes exactly the leftover space.

No vh arithmetic anywhere, so there's nothing left to guess wrong. Short steps size to their content; the details step hits the cap and scrolls internally, with the compliance note and progress bar staying frozen above it (all marked `shrink-0`, or they'd compress instead of the form).

**This also retires the `alignItems: 'safe center'` fix** from the polish pass. That existed to stop a card taller than the viewport from becoming unreachable — with `max-h-full` that can't happen, so plain centring is correct again and the workaround is gone.

---

## Files touched

- `src/app/(main)/onboarding/layout.tsx` — background, page lock
- `src/app/(main)/onboarding/_components/OnboardingCard.tsx` — sign-out, opaque surface, flex column
- `src/app/(main)/onboarding/profile/page.tsx` — flex sizing, `shrink-0` frozen block, contrast
- `permission/screen`, `permission/notifications`, `done` — contrast
- `DESIGN.md` + `documentation/onboarding.md` — recorded the page-lock rule and the opaque-card exception, and removed the now-wrong safe-centring note

---

## ⚠️ Not verified

Still no build tooling in this checkout — nothing compiled or opened in a browser.

The scroll fix is the thing to check, since it's the second attempt at this exact problem. Two things to confirm on the details step:

1. **No page scrollbar at all**, and no dead space below the card.
2. **On a short window**, that the form still scrolls internally and every field remains reachable — the failure mode of a locked page is content you can't get to, which is precisely what the previous approach was guarding against.
