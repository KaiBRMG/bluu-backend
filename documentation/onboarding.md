# Onboarding

> Covers the internal-employee first-run flow: what happens between a fresh install and the first time a user reaches the real app — download, login, terms acceptance, OS permission grants, and personal-details collection. Login itself (OAuth, custom claims, session token) is [auth.md](auth.md); this spoke covers what happens **after** a successful login but **before** the user is treated as fully set up.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/app/download/page.tsx` | Public (browser-accessible) installer download page — pre-login, pre-Electron |
| `src/lib/services/userService.ts` (`ensureUserExists`) | Creates the `users/{uid}` doc on first login with `hasAcceptedTerms: false`, `hasCompletedOnboarding: false` |
| `src/app/api/auth/exchange-code/route.ts` | Calls `ensureUserExists` as part of the OAuth login exchange |
| `src/components/AuthWrapper.tsx` | Owns the **onboarding guard** — redirects a logged-in user into the flow based on Firestore flags |
| `src/app/(main)/onboarding/steps.ts` | `ONBOARDING_STEPS` — the ordered step list; the source of truth for the progress rail |
| `src/app/(main)/onboarding/_components/OnboardingCard.tsx` | Shared step chrome: progress dots, identity strip, card surface, optional footer. Also exports `UserAvatar` |
| `src/app/(main)/onboarding/layout.tsx` | Centering shell on the near-black canvas |
| `src/app/(main)/onboarding/welcome/page.tsx` | Step 1 — terms of use acceptance |
| `src/app/(main)/onboarding/permissions/page.tsx` | Step 2 — explainer for the two OS permissions about to be requested |
| `src/app/(main)/onboarding/permission/screen/page.tsx` | Step 3 — screen-recording permission (+ temporary macOS TCC repair) |
| `src/app/(main)/onboarding/permission/notifications/page.tsx` | Step 4 — OS notification permission |
| `src/app/(main)/onboarding/profile/page.tsx` | Step 5 — personal details form; **this is the step that completes onboarding** |
| `src/app/(main)/onboarding/done/page.tsx` | Step 6 — terminal confirmation; explains the unassigned-group wait |
| `src/app/terms/page.tsx` | The terms of use document — opened in the **system browser**, not in-app |
| `src/middleware.ts` | `/terms` is in `BROWSER_ALLOWED_PREFIXES` so the external browser can reach it |
| `src/app/api/user/onboarding/route.ts` | The only write path for `hasAcceptedTerms` / `hasCompletedOnboarding` — one-way (true only) |
| `src/app/api/user/update/route.ts` | Writes the profile-step payload (same allowlisted route Settings uses) |
| `src/lib/validation.ts` | `validateOnboardingProfile` — Settings' rules plus onboarding's required-field set |
| `electron/main.js` | Native handlers: `permissions:requestScreenAccess`, `permissions:requestNotification`, `permissions:resetScreenCapture`, `app:getPlatform` |
| `src/lib/notificationContent.ts` | `welcomeToTeam()`, `adminNewUserAlert()` — fired on doc creation, not per onboarding step |

---

## 1. Before login: getting the app

`/download` is a public, browser-accessible page (`BROWSER_ALLOWED_PREFIXES` in `src/middleware.ts` — see [auth.md](auth.md#browser-access-middleware)) that links out to Google Drive-hosted installers per platform, plus a one-time certificate step and a walkthrough video. This step is entirely outside the app and outside Firestore. The user installs and opens the Electron app, which lands on `Login` (`src/components/Login.tsx`) since there is no Firebase user yet.

**Onboarding itself only exists inside Electron.** `/onboarding/*` lives under the `(main)` route group and is *not* in `BROWSER_ALLOWED_PREFIXES`, so a browser hitting it gets rewritten to `/desktop-only`.

## 2. Login creates the user doc — onboarding-incomplete by default

Google OAuth completes and hits `/api/auth/exchange-code`, which calls `ensureUserExists` ([auth.md](auth.md#oauth-login-flow-internal-employees) has the full login sequence). On a **brand-new uid**, the created `users/{uid}` doc sets:

```
hasAcceptedTerms: false
hasCompletedOnboarding: false
screenshotBugFixed: true   // new users are born on the signed build — see CLAUDE.md TCC section
groups: ['unassigned']
```

An **existing** user (any subsequent login) only gets `lastLoginAt` bumped — these flags are untouched, so once true they stay true forever. There is no re-onboarding.

Two notifications fire here (`welcomeToTeam` to the user, `adminNewUserAlert` to every admin — see [notifications.md](notifications.md)). **There is deliberately no "go fill in your personal information" nudge**: that data is collected by step 5 of this flow. The old `onboardingActionRequired()` factory was deleted when the profile step shipped; do not reintroduce it.

## 3. The onboarding guard (`AuthWrapper`)

`AuthWrapper` is the sole place that decides *whether* to send a logged-in user into onboarding:

```ts
const isAuthRoute =
  pathname?.startsWith('/auth/') ||
  pathname?.startsWith('/onboarding/') ||
  pathname?.startsWith('/creator-portal');

useEffect(() => {
  if (!user || userDataLoading || isAuthRoute) return;
  if (!userData) return;

  if (userData.hasAcceptedTerms !== true) {
    router.replace('/onboarding/welcome');
    return;
  }
  if (userData.hasCompletedOnboarding !== true) {
    router.replace('/onboarding/permissions');
    return;
  }
}, [userData, userDataLoading, user, isAuthRoute, router]);
```

**Key nuance:** the guard bails out `if (isAuthRoute)`. It only *pulls* an incomplete user **into** onboarding when they try to reach anywhere else in the app; once inside `/onboarding/*` it steps back and lets each page's own `router.push` drive navigation. Two consequences:

- **Reloading anywhere inside the flow keeps you there** — the guard never fires on an onboarding route, so a refresh on step 5 stays on step 5.
- **Re-entering from outside** (quit and relaunch, or navigating to `/`) resumes at `/onboarding/welcome` if terms were never accepted, otherwise at `/onboarding/permissions` — the start of the permissions leg, not the exact step you left. There is no per-step resume; the form step re-hydrates from the user doc so nothing typed is lost.

Because `isAuthRoute` also covers `/auth/` and `/creator-portal`, the mid-session kill-switch (`isActive === false`) and the displaced-session check are both skipped while inside `/onboarding/*`.

## 4. The six steps

`ONBOARDING_STEPS` in `steps.ts` is the ordered list; a step's index in that array is the `step` prop its page passes to `OnboardingCard`, which is what the progress rail renders. **Adding a step means adding one entry there and passing the new index** — nothing else reads the order.

| # | Route | Writes | Advances to |
|---|---|---|---|
| 0 | `/onboarding/welcome` | `hasAcceptedTerms: true` | `permissions` |
| 1 | `/onboarding/permissions` | — | `permission/screen` |
| 2 | `/onboarding/permission/screen` | — | `permission/notifications` |
| 3 | `/onboarding/permission/notifications` | — | `profile` |
| 4 | `/onboarding/profile` | profile fields + `hasCompletedOnboarding: true` | `done` |
| 5 | `/onboarding/done` | — | `/` |

### Shared chrome (`OnboardingCard`)
Every step renders inside it, so the flow reads as one object: the Bluu wordmark centred at the top, a **progress dot rail** (filled behind you, Action Blue ringed on you, hairline ahead — one dot per entry in `ONBOARDING_STEPS`), and an **identity strip** (the user's full name + `Avatar`) on the right, over the DESIGN.md overlay surface recipe. Props: `step`, `width` (`default` | `wide` — the form step is wide), `identity` (`strip` | `none`), and `footer` for a pinned action bar.

Also exports two hooks that must not be confused:

- **`useFullName()`** — `firstName lastName`, falling back to `displayName`. For **display text only**. Use it rather than reading `displayName` directly: `ensureUserExists` sets `displayName` to the **first name only**, so it renders as a partial name.
- **`useAvatarSeed()`** — `displayName || auth displayName || 'User'`, byte-identical to `AppLayout`'s `userData.name`. **Every avatar seeds from this.** `getAvatarColor` hashes its argument, so seeding from the full name instead produced different initials *and* a different colour, and the user visibly changed avatar crossing from onboarding into the app. See DESIGN.md's *Avatar Seed Rule*.

`UserAvatar` holds a `Skeleton` until the user doc arrives, so no step flashes a `?` avatar or reflows when the name lands.

**The layout centres with `alignItems: 'safe center'`** (inline, so unsupporting browsers keep plain `items-center`). This is load-bearing, not cosmetic: with ordinary centring a card taller than the window overflows past the *top* edge and cannot be scrolled to. The details step is tall enough to hit this on a short window.

### Step 0 — `welcome` (terms of use)
Sets `identity="none"` and renders identity itself, as the heading **"Welcome to Bluu Backend"** with the user's avatar inline, name underneath — so there is exactly one avatar on the step, not two.

The terms link points at **`/terms`** with `target="_blank"`. In Electron that goes through `setWindowOpenHandler` → `openExternalSafe` → `shell.openExternal`, i.e. **it opens in the user's system browser, not in the app**. That is why `/terms` must stay in `BROWSER_ALLOWED_PREFIXES` — the external browser sends no `Electron/` user agent, so without the allowlist entry it would be rewritten to `/desktop-only`. The document content lives in `TOU.md` at the repo root; `src/app/terms/page.tsx` is the rendered version. **Keep the two in sync when the terms change.**

On **Next**: `PATCH /api/user/onboarding { hasAcceptedTerms: true }`, then push to `permissions`. A failed write toasts and stays put.

### Step 1 — `permissions` (explainer)
Static two-item explainer (screen capturing, notifications). No writes, no Electron calls.

### Step 2 — `permission/screen`
Reads the platform via `electronAPI.app.getPlatform()`. **macOS only, TEMPORARY** (see [CLAUDE.md](../CLAUDE.md#temporary-screenshot-tcc-repair-remove-after-fleet-migrates-off-pre-signing-builds) and [electron.md](electron.md#screen-capture-permission-repair-macos-tcc-temporary)): fires `permissions.resetScreenCapture()` on mount so the grant registers against the signed identity.

**Prompt screen capture** → on macOS, a real `captureScreenshot()` first (a capture attempt is what makes the app appear in System Settings → Screen Recording at all), then `permissions.requestScreenAccess()`, which on macOS just opens System Settings; on Windows it calls `desktopCapturer.getSources(...)`. Prompting only *unlocks* **Next** — the grant is never verified.

### Step 3 — `permission/notifications`
`permissions.requestNotification()` shows a real silent OS notification, which is what triggers the macOS permission prompt on first fire. Prompting unlocks **Next** → `profile`.

### Step 4 — `profile` (personal details) — **completes onboarding**
Collects every field the Settings → Personal Information form holds (profile photo, nickname, DOB, gender, personal email, phone + dialling code, telegram, full address, emergency contact ×3, payment method/info, comments), grouped into titled sections that scroll inside the card under a pinned footer. It opens with a short compliance rationale — the company keeps personnel records for payroll, tax, and compliance — because we are asking for more here than the app otherwise would.

Validation is `validateOnboardingProfile` (`src/lib/validation.ts`), which layers a required-field pass over `validatePersonalInfoForm`:

- **Required:** nickname, personal email, phone, DOB, full address (street/city/state/zip/country), emergency contact name + number.
- **Optional but format-validated:** gender, telegram, emergency contact email, payment method/info, comments, photo.
- **DOB** additionally runs `validateDateOfBirth` (not future, age 16–100). The picker's `startMonth`/`endMonth` are bound to the same range so it cannot offer a date the form then rejects.

Address is required because it is what resolves the user's timezone — `resolveTimezoneFromAddress` runs client-side and its result rides along in the **same** `/api/user/update` write, rather than the second request Settings makes.

On success: `POST /api/user/update` (profile + timezone) → `PATCH /api/user/onboarding { hasCompletedOnboarding: true }` → push to `done`.

**RULE — the completion flag belongs to this step, not the notifications step.** It is set only after the details are stored, so an interrupted flow re-enters onboarding rather than leaking a user into the app with an empty record.

### Step 5 — `done`
Terminal confirmation: "Your information has been received!", followed by the explanation that the user is unassigned until an admin reviews them. **This is the only place that message lives** — the home-page group widget deliberately does not repeat it (it just shows the group name on an orange pending tint). `Go to my workspace` → `/`.

Below the message sits a two-row **status list** — *Details submitted* (green, done) and *Admin review* (orange, in progress) — that makes the review concrete and visibly in motion. The "Admin review" row notes that managers have been notified, which is true: `adminNewUserAlert` fanned out to every admin at signup. The orange dot carries the app's only looping animation.

**Do not add a "Workspace access — pending" row.** The user can reach their workspace immediately; group assignment only affects what's *in* it. Listing access as pending would state something false and imply a block that does not exist.

This is also the app's **one celebratory moment** — a success seal and a drawn tick, ~660ms total, reduced-motion safe. The motion vocabulary is documented in [DESIGN.md](../DESIGN.md) under *Stepped Flows*; it is deliberately scoped to this screen and must not be reused elsewhere.

Reloading here drops the user into the app, which is correct: the flag is already set and the screen is informational, not a gate.

## 5. Write path guarantees

`PATCH /api/user/onboarding` (`withAuth`-gated, tier 1 — see [auth.md](auth.md#authorization-tiers-least--most-privileged)) is deliberately narrow:

```ts
if (body.hasAcceptedTerms === true) updates.hasAcceptedTerms = true;
if (body.hasCompletedOnboarding === true) updates.hasCompletedOnboarding = true;
```

Only `true` is ever accepted — the route has no code path to set either back to `false`. Onboarding is a one-way ratchet per user; there is no "reset a user's onboarding" affordance. It follows [data-layer.md](data-layer.md#firestore-read-optimization-rules)'s cache rule: `invalidateUserCache(token.uid)` runs in the same handler.

The profile step writes through the existing allowlisted `/api/user/update` route — **no new fields, no new endpoint**, so onboarding and Settings cannot drift apart in what they are permitted to store.

## 6. Failure / edge-case notes

- **Write failure**: every step toasts the error and leaves the user where they are to retry. There is no offline queue — this differs from time-tracking's crash-robust buffering (see [time-tracking.md](time-tracking.md)).
- **Invalid form**: errors render per-field, the first offending field is scrolled into view, and a summary toast fires. Nothing is written.
- **Photo upload** is independent of the form submit — it writes immediately via `/api/user/upload-photo`, so it survives a later validation failure.
- **Non-Electron access**: all `electronAPI` calls are optional-chained, so the pages don't hard-crash without Electron — defense-in-depth, since `/onboarding/*` is desktop-only at the middleware layer.

## Maintaining this spoke

Update this file when: a step is added, removed, or reordered (`steps.ts` + the table in §4), the guard logic in `AuthWrapper` changes, `ensureUserExists`'s default flag values change, the required-field set in `validateOnboardingProfile` changes, `TOU.md` / `src/app/terms/page.tsx` diverge, or the temporary macOS TCC repair (step 2) is removed.
