# Onboarding is now all-or-nothing + the two bugs behind your repro

**Not compiled or run** — no build tooling in this checkout. Caveat at the bottom.

---

## Your bug had two independent causes

Both had to be fixed; neither alone explains what you saw.

### Cause 1 — the name never rendered: a token race in `Login.tsx`

`Login.tsx` signed in **before** storing the session token:

```js
await signInWithCustomToken(auth, data.customToken);  // fires onAuthStateChanged
localStorage.setItem('sessionToken', data.sessionToken);  // ← too late
```

`signInWithCustomToken` triggers `onAuthStateChanged`, which subscribes to `users/{uid}`. That snapshot compares the doc's **freshly rotated** token against whatever `localStorage` still holds — the **previous** login's token. Mismatch → `useUserData` flags the session as displaced and returns early **without ever setting `userData`**.

It never recovers: the doc doesn't change again, so no later snapshot corrects it. `userData` stays `null` forever — hence the skeleton avatar and skeleton name in your screenshot.

This only reproduces from the **second** login onward, which is exactly your repro (sign in → quit → open → sign in again). On a first-ever login there's no stale token to mismatch against.

Fixed by writing the token before signing in.

### Cause 2 — sign-out did nothing: a route-predicate bug in `AuthWrapper`

```js
if (isAuthRoute) return <>{children}</>;   // ← onboarding was in here
if (!user) return <Login />;               // ← never reached
```

`isAuthRoute` lumped `/onboarding/*` in with the OAuth pages, and it was checked **before** the `!user` check. So sign-out worked perfectly — the session was cleared — and `AuthWrapper` carried on rendering the onboarding step. Nothing visibly happened.

The same conflation silently disabled **all** session enforcement during onboarding: the revocation kill-switch and the displaced handler both skipped it. That's why the displaced state from Cause 1 became a permanent dead end instead of redirecting to `/auth/displaced`.

Split into `isUnauthenticatedRoute` (`/auth/*`, `/creator-portal`) and `isOnboardingRoute`. Onboarding is an authenticated surface; only the onboarding guard skips it.

---

## Onboarding is now all-or-nothing

A run that never reached **Submit details** is discarded. Next launch → login screen → the whole flow again from the terms step.

**Server (authoritative)** — `ensureUserExists` resets `hasAcceptedTerms → false` and `photoURL → null` on any login where `hasCompletedOnboarding !== true`. This runs on every login and can't be spoofed by a client.

`photoURL` is called out because it's the **only** field written before completion — the avatar upload is immediate. Everything else on the details step is written in the same request that completes onboarding, so an incomplete run leaves nothing else behind. The client-facing `/api/user/onboarding` route still only ever accepts `true`; the reset has no client entry point.

**Client** — `AuthWrapper` ends a *restored* session whose onboarding never completed, so the user actually lands on Login instead of resuming mid-flow.

The client half is gated on a `sessionStorage` marker (`src/lib/loginSession.ts`) that `Login` sets immediately before sign-in. `sessionStorage` is the right store precisely because it survives in-app navigation and reloads but dies with the renderer — which is exactly the question being asked: *did this run begin with a login, or with auth restored from disk?* Without it, the effect would sign out the user who just logged in and is standing on step 1.

> Note this makes a second login the **common** path rather than an edge case — which is why Cause 1 had to be fixed for any of this to work. Without it, every relaunch would land in the permanent-skeleton state.

---

## Sign out is now an unconditional escape hatch

Per your follow-up: whatever else is broken, it reaches Login.

1. **The clock-out flush is time-boxed** (2.5s, `Promise.race`). It awaits a token refresh and a network call, both of which can hang offline. Bookkeeping can no longer block the exit.
2. **Local state is cleared before `signOut()`, and no failure short-circuits the rest.** With the login marker gone, even a *failed* `signOut()` leaves the next boot in a state the incomplete-onboarding discard resolves into Login.
3. **It ends with `window.location.assign('/')`, not a router push.** A full document load rebuilds the tree, so a stuck effect, a wedged provider, or a null `userData` can't pin the user to the step.

---

## Files touched

- `src/lib/loginSession.ts` — new
- `src/components/Login.tsx` — token/marker ordering
- `src/components/AuthWrapper.tsx` — predicate split, discard effect, render order
- `src/lib/services/userService.ts` — server-side discard
- `src/app/(main)/onboarding/_components/OnboardingCard.tsx` — hardened sign-out
- `documentation/onboarding.md` — rewrote the affected sections; the old text claimed onboarding flags "stay true forever" and that no reset exists, both now wrong

---

## One thing to decide

**A completed user is unaffected**, but note the discard is keyed purely on `hasCompletedOnboarding`. If you ever add a step *after* the details form, anyone who quits between the two would lose their submitted details on next login. Not a problem today — the details step is last and sets the flag — but worth remembering before inserting a step.

## ⚠️ Not verified

Nothing compiled or run. Please walk your exact repro: sign in → stop mid-onboarding → quit → reopen. Expected: **login screen**, then onboarding from the terms step with the avatar and name rendering correctly. Then test Sign out from a middle step.
