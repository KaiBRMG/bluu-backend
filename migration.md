# Personal-Email Migration — Analysis & Plan

> Status: **implemented** (Phases 0–3). Typecheck and `next build` both pass.
> Remaining before staff are affected: run the backfill, deploy the Firestore
> rules, then arm cohorts in `emailMigrationConfig.ts`. See §6 for the runbook.
> Goal: staff sign in with **personal Google accounts** instead of `@bluurock.com`, authorisation moves from "Google says the domain is ours" to "an admin pre-registered this email in our system".

---

## 0. The one-line summary of the whole change

Today the domain string `@bluurock.com` is simultaneously doing **three** jobs:

| Job | Where | Replacement |
|---|---|---|
| Authenticate ("is this a real staff account?") | `hd=bluurock.com` on the OAuth URL | Google OAuth, unrestricted |
| Authorise ("is this person allowed in?") | `endsWith('@bluurock.com')` in [exchange-code](src/app/api/auth/exchange-code/route.ts#L43) | **The `users` collection is the allowlist** |
| Discriminate ("employee or creator?") | [AuthProvider.tsx:61](src/components/AuthProvider.tsx#L61) | `users/{uid}` doc exists |

**Google authenticates; Firestore authorises.** Every design decision below follows from that sentence.

---

## 1. Is this possible with Google OAuth? — Yes, with four config changes

| Requirement | Today | Needed |
|---|---|---|
| **OAuth consent screen user type** | Almost certainly **Internal** (a Workspace-org app). Internal apps *hard-reject* any account outside the org — a personal Gmail gets `Error 403: org_internal` before your code ever runs. | Switch to **External** and hit **Publish** (out of Testing). |
| Google verification / review | n/a | **Not required.** You only request `openid email profile` — non-sensitive scopes. External + Published with only those scopes gives unlimited users, no brand review, no security assessment. (Only the unverified-app interstitial applies while in *Testing*, and Testing caps you at 100 hand-listed users — so you must publish, not just switch to External.) |
| `hd` domain restriction | Set in **three** places: [auth/google/page.tsx:29](src/app/(main)/auth/google/page.tsx#L29), [api/auth/google-url:22](src/app/api/auth/google-url/route.ts#L22), [firebase-config.js:35](src/firebase-config.js#L35) | Remove from all three. |
| Account chooser | `prompt: 'select_account'` already set | Keep — this is what lets a user pick a *different* account during migration. |
| Redirect URI | `NEXT_PUBLIC_REDIRECT_URI` | Unchanged. |

**What Google cannot do for you:**

- There is no *negative* `hd` ("any account except bluurock.com"). The "you picked your work email again — try again" gate during migration **must** be enforced server-side after the code exchange, then the user is re-prompted. That is exactly what you described, and it is the only way.
- Google cannot tell you whether a person is an employee. That is now 100% our allowlist's job — which is why the pre-registration step you designed is not optional; it *is* the new access control.

**Business constraint worth naming now:** "personal email" effectively means "**personal Google account**". A staff member whose personal address is Outlook/iCloud/Proton cannot sign in unless they create a Google account (which *can* be created on a non-Gmail address, but it is a real hurdle and a support burden). **Decided** (§5 #3): treated as a non-case — every staff member has a usable Google account.

---

## 2. Gaps and risks in the proposed logic

Ordered by severity. Items marked **must-fix** will break login or open a hole if skipped.

### 2.1 The employee/creator discriminator disappears — **must-fix**
[`AuthProvider`](src/components/AuthProvider.tsx#L57-L65) currently signs out anyone whose email isn't `@bluurock.com`, on the assumption that they're a creator. Once staff use Gmail, that check would sign out **every employee**. Replacement: the `users/{uid}` doc must exist (the provider already reads that doc for `isActive`, so this costs **zero** extra reads). Missing doc → not an employee → `setUser(null)`.

Note the current code fails *open* on a missing doc (`!snap.exists() || isActive !== false` → active). That must invert: missing doc → denied. Keep the "read threw" path failing open (offline boot), but not the "doc genuinely absent" path.

Creators are unaffected in practice: they sign in with **email/password**, not Google ([creator/login](src/app/creator/login/page.tsx)), and `AuthProvider` is only mounted under `(main)`, never on `/creator`.

### 2.2 Never trust `adminAuth.getUserByEmail` as the authorisation lookup — **must-fix**
Today [exchange-code](src/app/api/auth/exchange-code/route.ts#L53) resolves identity from the Auth layer and **auto-creates an Auth account for any unknown email**. Under the new model that would provision an account for any Gmail on earth. Two changes:

1. **Delete the auto-create branch.** Unknown email → 403 with the "not in the system" message.
2. **Resolve the uid from the `users` doc** (`where('workEmail','==',email)`), not from Auth. This is what makes "the old `@bluurock.com` email must stop working" *actually true*: even if the Auth account still carries the old address in some provider record, no `users` doc has that `workEmail`, so login is refused. The Firestore doc becomes the single source of truth for who may log in and as which uid.

### 2.3 Email uniqueness is unenforced — **must-fix**
The `users` collection has **no uniqueness constraint on `workEmail`** (already documented in [auth.md](documentation/auth.md#login-identity--duplicate-account-prevention)). Email is about to become the *authorisation key*, so a duplicate is now an account-takeover vector, not just a data-hygiene issue. Two writers can pass a check-then-write race.

**Proposal:** an `auth-emails/{emailLower}` index collection — doc id is the normalised email, body `{ uid, updatedAt }` — written in a **Firestore transaction** alongside the user doc at registration and at migration. `create` fails if it exists → clean "that email is already assigned to <name>" error, race-free. Server-only (`allow read, write: if false`). This also gives login an O(1) doc-get instead of a query.

### 2.4 Gmail address normalisation and the `sub` identifier
- `kaij.nell@gmail.com`, `kaijnell@gmail.com` and `kaijnell+work@gmail.com` are the **same Google account** but three different strings. An admin who types the address slightly differently to how Google canonicalises it locks the user out with a confusing "not in the system". Mitigation: normalise (lowercase always; for `gmail.com`/`googlemail.com` strip dots and `+suffix`) when **comparing**, but keep the typed form for display.
- Better long-term key: Google's `sub` (stable numeric account id, never changes even if the user renames their Gmail). Store `googleSub` on the user doc at first successful login and prefer it in the lookup chain: `googleSub → email index → workEmail query`. Costs nothing and immunises you against the *next* email change.

### 2.5 Migration ordering — a half-finished migration can lock a user out — **must-fix**
The migration writes two systems: the Auth account's `email` and the `users` doc's `workEmail`. If they diverge:

- **Auth updated first, Firestore fails** → old email is gone from Auth, new email isn't in the doc → the user can log in with **neither**. Hard lockout, admin-only recovery.
- **Firestore updated first, Auth fails** → login by new email works (we key off the doc), the Auth record is merely stale and cosmetic; a repair pass or the next login fixes it.

So: **write the `users` doc + email index in a transaction, then update Auth**, and treat an Auth failure as non-fatal + logged (with a reconcile job). Never the other way round.

### 2.6 Enforcement strength of the "mandatory" card
A React dialog is only as mandatory as the renderer. If a user opens devtools they can dismiss it. **Decided: soft** (§5 #1) — blocking card only, which is right for a cooperative internal rollout. The hard option (`withAuth` returns 403 on everything but the migration endpoint for an armed, unmigrated user) stays available for Phase 4 stragglers.

### 2.7 Clocked-in users
[`UpdateAvailableBanner`](src/components/) deliberately never interrupts a clocked-in user. A blocking migration card that appears mid-shift either (a) interrupts a running timer, or (b) has to wait for clock-out. Also: the migration itself does **not** sign the user out (uid unchanged), so the timer survives. **Decided: wait for clock-out** (§5 #5), so the question is moot in practice.

### 2.8 Session continuity after the email change
The **uid does not change**, so the Firebase session, the ID token, custom claims, and the time-tracking buffers all survive an email change. `sessionToken` is left alone (§5 #8). One thing still to verify: whether `adminAuth.updateUser({email})` implicitly revokes refresh tokens is **not something to assume** — I'll verify empirically during implementation and, if it does revoke, the card must clock out + re-authenticate cleanly rather than dying with a silent token error.

### 2.9 Creator / pre-existing Auth account collisions
Registering an employee whose personal email already exists in Firebase Auth (they're also a creator, or a previously-deleted-then-recreated user) makes `adminAuth.createUser` throw `email-already-exists`. Behaviour must be explicit:
- Email belongs to a **creator** → reject the registration with a clear error (never reuse a creator's uid for an employee).
- Email belongs to an **orphaned Auth account with no `users` doc and no `creators` doc** → adopt it (reuse the uid), which mirrors today's [`findUserUidByEmail`](src/lib/services/userService.ts#L149) guard.

### 2.10 The endpoint becomes internet-reachable by anyone with a Google account
`/api/auth/exchange-code` currently self-limits via the domain check. After this change, any Google user can drive a full code exchange (a Google round-trip + a Firestore lookup) before being rejected. Add a cheap IP/email throttle and make sure the 403 response body is identical for "unknown email" and "archived/deactivated user" so it can't be used to enumerate staff.

### 2.11 Deactivated / archived users must be rejected server-side
`isActive` is checked client-side today ([AuthProvider](src/components/AuthProvider.tsx#L87)). Since we're rewriting the login gate anyway, reject `isActive === false` and `isArchived === true` at the token-exchange step too — same generic message. Free hardening.

### 2.12 `workEmail` is now a misnomer, and collides with an existing field
`workEmail` will hold a personal address, while [`contactInfo.personalEmail`](src/lib/services/userService.ts#L59-L67) already exists and is a **required** onboarding field, and the profile step shows a read-only "**Company email**" box ([profile/page.tsx:553](src/app/(main)/onboarding/profile/page.tsx#L553)). Users will ask which is which. **Decided** (§5 #4): keep the field name `workEmail` (it appears in ~20 files, types, caches and API payloads), relabel the UI to "**Login email**", and drop `contactInfo.personalEmail` from the required onboarding set.

### 2.13 Onboarding copy that pre-registration makes false
Because a group is now assigned *before* first login, these become wrong and must go:
- `welcomeToTeam` — "You will be assigned to a group soon." ([notificationContent.ts:14](src/lib/notificationContent.ts#L14))
- `adminNewUserAlert` — "assign them to a group asap" ([notificationContent.ts:21](src/lib/notificationContent.ts#L21)) — the whole notification is now pointless.
- The `done` step's "**Admin review — in progress**" row and the "you are unassigned until an admin reviews you" paragraph ([onboarding/done](src/app/(main)/onboarding/done/page.tsx)).
- The orange "pending" tint on the home group widget ([page.tsx:563-574](src/app/(main)/page.tsx#L563)).
- The `unassigned` group becomes vestigial (keep the group + hierarchy entry as a safety net; just never land anyone in it).

Also note `welcomeToTeam` currently fires **on doc creation** — which now happens at *registration* time, so the new hire gets a notification days before they can log in. Move it to first successful login.

### 2.14 Documentation debt (CLAUDE.md rule 11)
This change invalidates [auth.md](documentation/auth.md) (§OAuth flow, §login identity, §auth contexts), [onboarding.md](documentation/onboarding.md) (§2, §4 step 5, §Step 5 done), [user-management.md](documentation/user-management.md) (new "Invited" state), and the hub's system map. Doc updates are part of the change, not a follow-up.

### 2.15 Not a gap, but a useful surprise: **no Electron build is required**
The migration card can open the browser without touching `electron/`: any `target="_blank"` / `window.open` goes through [`setWindowOpenHandler` → `openExternalSafe` → `shell.openExternal`](electron/main.js#L956), and the existing `bluu://callback?code=…` deep link already returns the code to the renderer. The renderer knows it started a *migration* (a flag it set before opening the browser), so it routes the code to `/api/auth/migrate-email` instead of `/api/auth/exchange-code`. **The entire migration ships as a Vercel deploy.**

That means the app update is a *product* choice, not a technical necessity — and it removes the risk of the two-push release dance in CLAUDE.md rule 14 gating your rollout. **Decided** (§5 #2): ship as a Vercel deploy, renderer-side migration flag, `electron/` untouched.

---

## 3. The plan

Four shippable phases. Phases 1–2 are invisible to existing staff (their `@bluurock.com` addresses stay in `workEmail` and keep working), so they can land and soak before anyone is migrated.

### Phase 0 — Google Cloud config (do first, verify before writing code)
1. OAuth consent screen → **External**, then **Publish**.
2. Confirm a personal Gmail can complete `/auth/google` and reach `/auth/callback` (it will 403 at `exchange-code` — that's expected and is the correct proof).
3. Leave `hd` in place until Phase 1 ships.

### Phase 1 — Allowlist authentication (no user-visible change)
| File | Change |
|---|---|
| `src/app/api/auth/exchange-code/route.ts` | Remove the domain check **and** the auto-create branch. New order: exchange code → normalise email → resolve uid via email index → 403 `USER_NOT_REGISTERED` if absent → reject `isActive:false` / `isArchived` → `ensureUserExists` (update path only) → claims → custom token. Record `googleSub`, `lastLoginAt`. Fire `welcomeToTeam` here on first login. |
| `src/lib/services/userService.ts` | `ensureUserExists` no longer creates docs (creation moves to registration). Add `normalizeEmail()`, `findUserUidByEmail` reads the email index, `googleSub` write. |
| `src/components/AuthProvider.tsx` | Replace the domain test with "`users/{uid}` exists"; missing doc → signed out. |
| `src/components/Login.tsx` | Render a real error card instead of `alert()`: **"Login blocked — your account is not in the system. Please contact your team leader."** Drop the browser-path domain check. |
| `src/app/(main)/auth/google/page.tsx`, `src/app/api/auth/google-url/route.ts`, `src/firebase-config.js` | Remove `hd`. Add `?mode=migrate` handling to the `/auth/google` page (Phase 3 uses it). |
| `firestore.rules` | Add `match /auth-emails/{email} { allow read, write: if false; }` — **rules change → notify + deploy** (`firebase deploy --only firestore:rules`). |
| one-off script | Backfill `auth-emails/*` from every existing `users` doc; report any duplicate `workEmail` before it becomes a security problem. |

### Phase 2 — Admin pre-registration ("+ New")
| File | Change |
|---|---|
| `src/app/api/admin/users/route.ts` | New `POST` — **tier 2 (`user-management` page permission)**, plus an admin-claim guard on `groupId === 'admin'` (decision #6). Body: `firstName`,`lastName`,`displayName` (nickname), `email`, `groupId` (**optional** → `unassigned`). Validates + normalises, transactionally claims `auth-emails/{email}`, creates the Auth account (adopting an orphan uid where safe, rejecting a creator's email), writes the `users` doc (`hasAcceptedTerms:false`, `hasCompletedOnboarding:false`, `screenshotBugFixed:true`, `groups:[groupId ?? 'unassigned']`), adds group membership, runs `recomputeUserPermissions`, busts all three caches. |
| `src/components/admin/user-management/NewUserDialog.tsx` (new) | shadcn `Dialog` + form: full name, nickname, email, group `Select` with an explicit "Unassigned — decide later" option. Follows [DESIGN.md](DESIGN.md). |
| `EmployeeRegistry.tsx` | "+ New" button in the header row; wire to the dialog + `refetch`. |
| `UserCard.tsx` / `RegistryFilters.tsx` | An **"Invited"** state (`lastLoginAt == null`) — badge + filter, so admins can see who hasn't logged in yet. No expiry (decision #9). |
| `useAdminUsers.ts` | `createUser()` mutation. |
| `notificationContent.ts` + `automatedNotifications.ts` | `welcomeToTeam` gains a with-group variant; `adminNewUserAlert` is **kept but retargeted** — fires on first login only when the user is still `unassigned` (see §5 knock-on). |
| onboarding `done` step, home group widget | Pending-review row and orange tint become conditional on `groups.includes('unassigned')` rather than always-on. |
| onboarding `profile` step | Relabel the read-only "Company email" field to **"Login email"**; drop `contactInfo.personalEmail` from `validateOnboardingProfile`'s required set (decision #4). |

### Phase 3 — One-time migration for existing users
| File | Change |
|---|---|
| `src/lib/emailMigrationConfig.ts` (new) | **The phased-rollout gate**, modelled on [`appUpdateConfig.ts`](src/lib/appUpdateConfig.ts): `{ enabled: boolean; uids: string[]; groups: GroupSlug[]; allUsers: boolean }`. Empty = nobody is prompted. Ship the code with it empty, arm cohort by cohort with a one-line commit. |
| `src/components/migration/EmailMigrationDialog.tsx` (new) | Non-dismissible card. Shown when: gate matches **and** `workEmail` ends with `@bluurock.com` (self-clearing — no extra flag needed to stop showing it) **and the user is not clocked in** (decision #5, same condition `UpdateAvailableBanner` uses). Explains the change → "Continue" sets a `sessionStorage` migration flag and `window.open`s `/auth/google?mode=migrate` (opens in the system browser via `setWindowOpenHandler`). Handles the three outcomes: success, "you picked your work email — choose a personal one" (re-prompt in place), "that email already belongs to another account". |
| mounted in `src/app/(main)/layout.tsx` | Above the app, below the providers, so `useUserData` is available and the card closes by itself when `workEmail` changes. |
| `src/components/Login.tsx` | The existing `onOAuthCallback` listener branches on the migration flag → `/api/auth/migrate-email` instead of `/api/auth/exchange-code`. (Same listener, so no native change.) |
| `src/app/api/auth/migrate-email/route.ts` (new) | `withAuth`. Exchanges the code, reads the Google email, then: reject `@bluurock.com` → `409 STILL_WORK_EMAIL`; reject an email already in the index → `409 EMAIL_TAKEN`; else **transaction**: claim the new `auth-emails` doc, delete the old one, set `workEmail`, `googleSub`, `emailMigratedAt`, invalidate caches. `sessionToken` is deliberately **not** rotated (decision #8). **Then** `adminAuth.updateUser(uid,{ email })` — non-fatal on failure, logged to Sentry (§2.5). |
| `src/app/(main)/auth/google/page.tsx` | `?mode=migrate` → adds `prompt: 'select_account consent'` and (if we do the native version) a `state`. |

**Rollout:** deploy with the gate empty → arm 1–2 volunteers → arm one group → arm `allUsers`.

### Phase 4 — Cleanup (after the fleet is migrated)
- Report on remaining `@bluurock.com` `workEmail`s; chase or archive.
- Optionally flip to a **hard** block for stragglers (decision #1 chose soft for the rollout, not forever), then delete the gate file, the dialog, and the migration endpoint.
- Update `auth.md`, `onboarding.md`, `user-management.md`, `CLAUDE.md`.

---

## 6. Deployment runbook

Order matters — steps 1–2 must land before anyone tries to log in against the new code.

```bash
# 1. Deploy the Firestore rules (adds the server-only auth-emails collection).
firebase deploy --only firestore:rules

# 2. Backfill the login allowlist from existing users. Dry-run first: it REPORTS
#    duplicate/unusable emails and refuses to guess which uid wins.
cd src && node scripts/backfill-auth-emails.js --dry-run
cd src && node scripts/backfill-auth-emails.js

# 3. Deploy the app (Vercel). No Electron build — nothing under electron/ changed.
git add -A && git commit -m "App Enhancements" && git push origin main

# 4. Verify before arming anyone:
#    • an existing user can still log in with their @bluurock.com address
#    • an unregistered Google account is refused with the "not in the system" card
#    • Employee Registry → New creates a user who shows as "Invited"

# 5. Arm the migration cohort by cohort in src/lib/emailMigrationConfig.ts
#    (enabled: true + uids → then groups → then allUsers), one commit each.
```

**Step 2 is not optional.** Without the index every login falls through to the `workEmail ==` query, which cannot match a Gmail alias — and the duplicate report is the only warning you will get that two users share a login address.

## 4. Firestore rules / indexes impact

- **Rules:** one new collection, `auth-emails` — server-only (`allow read, write: if false`). Deploy with `firebase deploy --only firestore:rules`.
- **Indexes:** none. `where('workEmail','==',…)` uses the automatic single-field index, and the email index is a doc-id lookup.

---

## 5. Decisions (settled)

| # | Question | Decision | Consequence |
|---|---|---|---|
| 1 | Enforcement of the migration card | **Soft** — blocking dialog only | No `withAuth` changes. Phase 4 may still add a hard block later. |
| 2 | Delivery | **Vercel deploy only, no Electron build** | Renderer-side `sessionStorage` migration flag, not an OAuth `state` param. `electron/` is untouched, so CLAUDE.md rule 14's two-push dance does not apply. |
| 3 | Non-Google personal emails | **Not a real case** — everyone has a usable Google account | No fallback login path. If one turns up, it's handled as a one-off, not a feature. |
| 4 | Field naming | **Keep `workEmail`**, relabel UI to "Login email" | No data migration. `contactInfo.personalEmail` is dropped from the required onboarding set (it now duplicates the login email). |
| 5 | Clocked-in users | **Wait for clock-out** | Card gates on the same "not clocked in" condition `UpdateAvailableBanner` uses. |
| 6 | Who may register | **`user-management` page permission** (tier 2) | Consistent with every other route on that page. **Guard added:** registering directly into the `admin` group still requires `token.admin`, mirroring [groups/members](src/app/api/admin/groups/[groupId]/members/route.ts#L31-L39) — otherwise the page permission chains into admin. |
| 7 | Group at registration | **Optional** — may be left `unassigned` | See below: the unassigned-era copy is made *conditional*, not deleted. |
| 8 | Session after migration | **Leave intact** — no `sessionToken` rotation | Nothing to re-authenticate; uid is unchanged. |
| 9 | Invitees who never log in | No expiry | The "Invited" badge + filter in the registry is the chase mechanism. |

### Knock-on from #7 — revise §2.13

Because a user may still be registered without a group, the unassigned-era messaging **cannot be deleted**; it becomes **conditional on `groups.includes('unassigned')`**:

- `welcomeToTeam` — two variants: with a group ("You're in the *Chat Agents* team"), or the existing "you'll be assigned soon" wording when unassigned.
- `adminNewUserAlert` — **kept, but retargeted**: fires on first login *only if the user is still unassigned*, so admins are nudged only when there's actually something to do. (It no longer fires for every new user.)
- `done` step's "Admin review" row and the home widget's orange tint — render only when the user is unassigned. They stay correct for the unassigned path and disappear for the normal one.

This is strictly better than deleting them: the common case is clean, the edge case still tells the truth.

### Knock-on from #6 — Phase 2 authorisation

`POST /api/admin/users` uses `checkPageAccess(token.uid, 'user-management')` (tier 2), **plus** the `admin`-group guard above. Worth stating plainly: anyone with the `user-management` page can now mint a login to the system. That is a deliberate widening of who controls the access graph — acceptable if that page is only granted to team leads you'd trust with account creation anyway.
