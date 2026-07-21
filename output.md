# Polish pass — entire onboarding flow

Systematic pass over all six steps + the shared card + the layout. **Not compiled or run** (no build tooling in this checkout) — caveat at the bottom.

Found **4 functional bugs**, one of which would have broken the details step outright.

---

## Functional bugs fixed

### 1. Invalid CSS would have killed the scroll gate ⚠️
`max-h-[max(12rem,calc(100vh-32rem))]` — **`calc()` is a parse error without whitespace around the operator.** The whole `max-height` would have been dropped, so the form would never have become a scroll container: no scrolling, progress bar stuck at 100%, and the scroll gate silently bypassed.

Tailwind escapes spaces as underscores. Fixed to `calc(100vh_-_32rem)`. This one was entirely my own doing, introduced earlier in this same pass.

### 2. Tall cards were unreachable on short windows
The layout centred with `items-center`. When a card is taller than the viewport, a centred flex item **overflows past the top edge and you cannot scroll up to it** — the first fields of the details step would have been permanently inaccessible on a short window.

Fixed with `alignItems: 'safe center'`, applied inline so browsers without support keep the plain `items-center` class. Safe centring falls back to start-alignment exactly when overflow would occur.

### 3. macOS users could get stranded on the screen-permission step
```js
if (platform === 'darwin') await captureScreenshot();   // ← expected to REJECT
await requestScreenAccess();
setPrompted(true);                                       // ← never runs
```
On macOS that capture is *meant* to fail before the grant exists — that failure is what raises the OS prompt. But an unhandled rejection meant `setPrompted(true)` never ran, leaving **Next permanently disabled with nothing on screen explaining why.** This was the common path, not an edge case.

Both permission steps now use `try/catch/finally` and always unlock. Same fix applied to notifications.

### 4. The photo upload had no accessible name
`aria-label` was on the `<label>`, but the label's only content is an `aria-hidden` avatar — so the file input itself was announced as an unnamed "file upload button". Moved the label onto the input.

---

## Accessibility

**Screen reader recited the whole flow on every page.** Each of the six dots carried its own `sr-only` "Step N of 6: …" text. Replaced with one summary line and `aria-hidden` on the rail.

**Two fields both labelled "Phone number", two labelled "Email".** Converted the form's section groups from `section`/`h2` to real `fieldset`/`legend`, so each field is announced with its group ("Emergency contact, Phone number") instead of an ambiguous duplicate.

> Worth noting: a `<legend>` is rendered *into* its fieldset's top border, so a bordered fieldset would have drawn the hairline straight through the title. The separator moved to a wrapper div.

**Company email was `disabled`.** Disabled inputs are skipped by the keyboard and can't be selected — bad for a value people reasonably want to read back or copy. Now `readOnly` with muted styling.

**Failed validation only scrolled.** It now also focuses the first invalid control, so the keyboard follows and a screen reader announces the field and its error.

---

## Loading & polish

**No more flash of a `?` avatar.** Before the user doc arrived, `getInitials('')` rendered `?` on a hashed colour — a visible flash of the wrong identity, then a reflow when the real name landed. `UserAvatar` and the name line now hold a `Skeleton`, per DESIGN.md's "skeletons shaped to the final layout".

**Copy consistency.** The welcome step's loading label was "Please wait…" while the details step said "Submitting…". Now "Saving…".

**`<main>` landmark** added to the layout.

**Stale comment** on the `identity` prop still described the old inline-avatar heading.

---

## Files touched

- `src/app/(main)/onboarding/layout.tsx` — safe centring, `<main>`
- `src/app/(main)/onboarding/_components/OnboardingCard.tsx` — skeletons, SR rail, comment
- `src/app/(main)/onboarding/welcome/page.tsx` — name skeleton, copy
- `src/app/(main)/onboarding/permission/screen/page.tsx` — error handling
- `src/app/(main)/onboarding/permission/notifications/page.tsx` — error handling
- `src/app/(main)/onboarding/profile/page.tsx` — calc fix, fieldsets, focus, readOnly, aria-label
- `DESIGN.md` + `documentation/onboarding.md` — corrected the now-inaccurate rail description, documented `useFullName` and the safe-centring requirement

---

## Deliberately not changed

- **Touch targets are 36px, under the 44px guideline.** This is a desktop Electron app driven by a mouse; DESIGN.md is explicitly desktop-first. Raising every control would fight the system's density.
- **"Go to my workspace"** still slightly overpromises on a screen saying you lack access. Flagged last round; it's a `clarify` call and it's your approved copy.
- **8 pre-existing `globals.css` findings** (layout-property animations, off-scale radii at L152–240). Not mine, not onboarding. Worth a separate `/impeccable audit`.

---

## ⚠️ Not verified

No `package.json` / `tsconfig.json`, empty `node_modules` — **nothing has been compiled or opened in a browser.** This pass was source review against component internals, which is what caught the `calc()` and the `legend`-border interaction.

Two things genuinely need a live window:
1. **The `fieldset`/`legend` conversion** — legend layout is quirky and I've mitigated it blind.
2. **The details step at a short window height** — the whole point of fixes 1 and 2, and precisely what can't be checked by reading.

Resize the window short on the details step and confirm you can reach every field.
