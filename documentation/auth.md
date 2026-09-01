# Auth & Access Control

> Covers three layers, outermost first: (1) **Browser access middleware** (edge rewrite), (2) **OAuth login flow**, (3) **API route auth middleware + authorization tiers**. Page-level permission resolution is a separate concern — see [permissions.md](permissions.md).

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/middleware.ts` | Edge middleware: blocks non-Electron browser access |
| `src/app/auth/google/` | Server component: builds OAuth URL, redirects to Google |
| `src/app/auth/callback/` | Client component: hands `code` back to Electron via deep link |
| `src/app/api/auth/google-url/route.ts` | Generates OAuth URL (for Electron direct use) |
| `src/app/api/auth/exchange-code/route.ts` | Code → Firebase custom token, sets claims, **enforces the allowlist** |
| `src/app/api/auth/migrate-email/route.ts` | One-time company → personal email switch |
| `src/app/api/admin/users/route.ts` (POST) | **Registration** — the only path that creates a user |
| `src/lib/authEmail.ts` | `normalizeEmail` (the comparison key), `isLegacyWorkEmail` |
| `src/lib/emailMigrationConfig.ts` | Phased-rollout gate for the migration card |
| `src/app/api/auth/session-token/route.ts` | Browser login + "link this browser": registers a **web** device session; allowlist check on the browser path |
| `src/app/api/auth/device/route.ts` | **Unauthenticated** `{ known: boolean }` — is this browser bound to a registered user? |
| `src/lib/deviceId.ts` | Client half of device identity: mint/read `bluu_device_id`, device kind and label |
| `src/lib/services/sessionService.ts` | Device-keyed sessions, the `device-sessions` reverse index, eviction and revocation |
| `src/components/AuthProvider.tsx` | Internal-employee auth context (`isActive` enforced) |
| `src/components/CreatorAuthProvider.tsx` | Creator auth context |
| `src/components/AuthWrapper.tsx` | Gates the app during auth resolution (boot phase `'auth'`) |
| `src/lib/middleware/withAuth.ts` | API guard: verifies Firebase Bearer token |
| `src/lib/middleware/withCreatorAuth.ts` | API guard: token + creator doc existence + `isActive` |
| `src/lib/middleware/apiHelpers.ts` | `checkPageAccess`, notification batching helpers |
| `src/lib/firebase-admin.ts` | Admin SDK (`adminDb`, `adminAuth`) |

---

## Browser Access Middleware

`src/middleware.ts` blocks all non-Electron browser access. The matcher covers every **page** route (excludes `_next`, `api`, static assets — so API routes are unaffected).

**Decision order:**
```
1. path startsWith BROWSER_ALLOWED_PREFIXES entry  → allow (unconditional)
2. User-Agent contains "Electron/"                 → allow (desktop app)
3. otherwise                                        → rewrite to /desktop-only
```

**`BROWSER_ALLOWED_PREFIXES` (currently):**
- `/auth` — OAuth flow pages run in the system browser during login; must be reachable without Electron.
- `/creator` — external creator interface, browser-accessible by design.
- `/desktop-only` — the "use the desktop app" landing page itself.
- `/download` — public installer/download page; users need it before they have the desktop app.
- `/p` — **shared prompts.** The whole point of the link is that it resolves for someone without the desktop app; a recipient rewritten to `/desktop-only` would make sharing useless. Read-only, and reachable only with the 160-bit share token in the path. See [prompt-library.md](prompt-library.md#sharing-a-prompt).
- `/raffle` — browser-accessible raffle page.

**RULE:** A new route that legitimately needs browser access must have its prefix added to `BROWSER_ALLOWED_PREFIXES`. API routes are already excluded from the matcher.

---

## OAuth Login Flow (internal employees)

Authentication is **Google OAuth only**.

> **Google authenticates; Firestore authorises.** Staff sign in with their own
> personal Google accounts — there is no company domain any more. Google only
> proves the caller owns an address; whether that address may enter, and as which
> uid, comes solely from the `users` collection. **An admin must register someone
> before they can ever log in.**
>
> This replaced a single `email.endsWith('@bluurock.com')` test that was silently
> doing three different jobs — authenticating, authorising, and telling employees
> apart from creators. Each now has its own mechanism; see *The allowlist* below.

Sequence:

```
Electron (Login)
   │ opens system browser
   ▼
/auth/google  (server component)
   │ redirect with OAuth params
   ▼
accounts.google.com
   │ redirect back
   ▼
/auth/callback?code=...  (client component, in browser)
   │ redirect to deep link
   ▼
bluu://callback?code=...   ── hands code back to Electron ──►  Electron
                                                                  │ POST
                                                                  ▼
                                                       /api/auth/exchange-code
                                                          • code → Google email
                                                          • ALLOWLIST GATE (below)
                                                          • records login on users/{uid}
                                                          • sets custom claims (admin: true/false)
                                                                  │ returns custom token
                                                                  ▼
                                                       Electron signs in to Firebase
```

**API routes:**
- `/api/auth/google-url` — generates OAuth URL (used by Electron directly; `/auth/google` builds its own URL server-side). Neither sets `hd` any more.
- `/api/auth/exchange-code` — exchanges code for a Firebase custom token, **enforces the allowlist**, sets custom claims, records the login.

### The allowlist (the authorisation gate)

`exchange-code` resolves the caller in this order, and **refuses at the first miss**:

1. `normalizeEmail(googleEmail)` → the comparison key ([`authEmail.ts`](../src/lib/authEmail.ts)).
2. `auth-emails/{key}` → `uid`. An O(1) doc get; falls back to a `workEmail ==` query which **heals** the index (for docs predating it).
3. The `users` doc must exist and have `isActive !== false` and `isArchived !== true`.

**RULE — this route must never create a user.** It used to auto-provision an Auth account and a `users` doc for any unknown address. With the domain check gone that would hand an account to any Google user on earth. Registration is an admin action ([`POST /api/admin/users`](../src/app/api/admin/users/route.ts)) and nothing else.

**RULE — resolve the uid from the `users` doc, never from `adminAuth.getUserByEmail` alone.** This is what makes a migrated user's old `@bluurock.com` address genuinely stop working: no doc holds it, so it is refused regardless of what any lingering Auth provider record says.

All three refusals return **the same body and status** (403 `USER_NOT_REGISTERED`). Distinguishable responses would let anyone with a Google account enumerate who works here and who has been let go. Keep them identical.

The route is also **rate limited** (10 attempts/min per normalised email, in-process) — since it lost the domain check it is reachable by anyone, and each call costs a Google token exchange plus a Firestore read.

#### Email normalisation
`normalizeEmail` lower-cases everything, and on `gmail.com`/`googlemail.com` also strips dots and any `+suffix`. Gmail treats `j.doe@`, `jdoe@` and `jdoe+work@` as one account; without folding them, an admin typing the address a different way from Google's canonical form registers an account nobody can sign into. Non-Gmail domains get case folding only — `first.last@company.com` is a different mailbox from `firstlast@company.com` everywhere else.

The normalised form is the **key** (index doc id, comparisons). The address as Google returned it is what gets **stored and displayed**.

### Email uniqueness — the `auth-emails` index
Doc id = normalised email, body = `{ uid, email }`. Server-only (`allow read, write: if false`).

The `users` collection has no uniqueness constraint on `workEmail`, and email is now the authorisation key — so a duplicate is an account-takeover risk, not a tidiness problem, and a check-then-write loses the race between two concurrent registrations. **The index doc is the lock:** `claimEmailInTransaction` (`userService.ts`) creates it inside a transaction and throws `EMAIL_TAKEN` if another uid holds it.

- Backfill for pre-existing users: `cd src && node scripts/backfill-auth-emails.js` (`--dry-run` supported). It **reports and refuses** duplicate or unusable emails rather than guessing.
- The delete cascade releases the claim — see [user-management.md](user-management.md#2-deleting-users-hard--destructive-cascade).

### Auth account reconciliation
The `users` doc is the source of truth; the Firebase Auth account is downstream. `exchange-code` repairs two states on every login:
- **Account missing** → recreated under the *same* uid, so all existing data reattaches (this is the old duplicate-prevention guard, kept).
- **Email stale** → updated to match. This is the repair pass for a migration whose Firestore half committed and whose Auth half failed.

### Google Cloud configuration
The OAuth consent screen must be **External + Published** (an Internal/Workspace app rejects personal accounts with `org_internal` before any of our code runs). Scopes are `openid email profile` only — non-sensitive, so no Google verification review and no user cap.

### Admin claim
- Admin status is a **JWT custom claim** (`token.admin`), **not** a Firestore read.
- Set at login; **refreshed when group membership changes**.
- The `isAdmin()` Firestore security rule reads `request.auth.token.admin` → **zero Firestore reads**.

### The email migration (temporary)
A one-time move of existing staff off `@bluurock.com`. See the *Temporary: personal-email migration* section in [CLAUDE.md](../CLAUDE.md) for the full mechanism and how to remove it. In short: a blocking card gated by [`emailMigrationConfig.ts`](../src/lib/emailMigrationConfig.ts), which opens the system browser at `/auth/google?mode=migrate` and posts the returned code to `/api/auth/migrate-email`.

**RULE — the Firestore write commits before the Auth write, never the reverse.** Login keys off the `users` doc, so a doc-committed/Auth-failed migration still works (and self-heals next login), whereas Auth-committed/doc-failed locks the user out of *both* addresses.

**Reversing a mistaken migration.** List the uid in `EMAIL_MIGRATION_REVERSAL` in the same config file. The same card runs backwards (`/auth/google?mode=revert` → `POST /api/auth/migrate-email` with `mode: 'revert'`), the domain gate inverts, and the doc gets `emailRevertedAt` in place of `emailMigratedAt`. Two invariants hold it together: the route **403s a `revert` from any uid not in that list** (the list, not the client, is the authority), and `shouldPromptEmailMigration` excludes listed uids so the forward cohort cannot immediately re-prompt them.

**Correcting a migration that landed on the wrong personal account.** The third direction — personal → a *different* personal — for someone who clicked the wrong Google account in the chooser. Add `{ uid, wrongEmail }` to `EMAIL_MIGRATION_CORRECTION` in the same config file; the same card runs sideways (`/auth/google?mode=correct` → `POST /api/auth/migrate-email` with `mode: 'correct'`), and the doc gets `emailCorrectedAt` while `emailMigratedAt` is left alone — they came off the company domain then, not now.

The invariant that makes it **once-off** is the *pairing*, not the uid: the entry names the exact address the user is currently stuck on, and both the gate and the route match it against `workEmail` (the route against the **server's** copy). One write later, `workEmail` no longer matches and the same request 403s. A uid alone would be a standing licence to re-point a login at will. The destination address is deliberately **not** pinned — ownership is proven by OAuth, and pinning it would let a typo in the config strand the user; the only rules on it are "not a company address" and "not the one you already hold". `wrongEmail: ''` is disarmed, so the entry ships inert and is armed in its own commit like every other cohort.

### Auth contexts
- **`AuthProvider`** — internal employees. Enforces the `isActive` check.
  - **The employee/creator discriminator is `users/{uid}` existing**, not the email domain — staff use personal addresses now, so a domain test would sign out every employee. The provider already read that doc for `isActive`, so this costs zero extra reads.
  - **A doc that is genuinely absent now denies** (it means "not an internal user"). A read that *threw* still fails open — "we couldn't ask" is not "the answer is no", and failing open there only grants an empty shell, since every API route re-authorises server-side.
  - Creators have a `creators` doc and no `users` doc. They are **ignored, not signed out** — the creator portal owns that session.
- **`CreatorAuthProvider`** — external creator accounts, used only in the creator portal. Creators sign in with **email/password** (`/creator/login`) and are managed at `/admin-portal/creator-management` — a completely separate path that the Google/allowlist flow above does not touch. The one place they interact: an email can only belong to one Auth account, so **creator registration refuses an address already held by an employee, and employee registration refuses one held by a creator.** Never merge the two onto one uid — that would give a single identity both a `users` and a `creators` doc, i.e. two auth contexts. The portal has no landing page: `src/app/creator/page.tsx` server-redirects `/creator` → `/creator/dashboard`, and `CreatorAuthWrapper` in the portal layout bounces signed-out visitors to `/creator/login?redirect=…` (relative redirects only, to block open redirects).

### Device identity & session enforcement

The unit of a session is the **device**, not the user.

`lib/deviceId.ts` mints a random UUID per browser profile / Electron install and keeps it in `localStorage` (`bluu_device_id`). It is minted **lazily on first read**, not only at login — the public share page needs one to ask "is this browser ours?" from a visitor who has never signed in here. **Minting one grants nothing**: an id only means anything once the server has bound it to a uid, which only ever happens behind a completed Google sign-in. It is an identifier, never a credential.

Login binds it: `registerSession` (`lib/services/sessionService.ts`) writes `users/{uid}.sessions[deviceId] = { token, kind, label, createdTime, lastSeenTime }` **and** an O(1) reverse-index doc at `device-sessions/{deviceId} → { uid, kind }`. The index exists for the same reason `auth-emails` does: Firestore cannot ask "which user owns this map key", and the share page resolves that on every render.

**The policy:**

| | Rule |
|---|---|
| Desktop | **Exclusive.** A desktop login evicts every *other* desktop entry — preserving the guarantee the old mechanism actually existed to give: nobody is clocked in on two machines. |
| Web | **Concurrent** with the desktop session and with each other. A web client cannot clock in, so nothing about time tracking is at risk. |

**RULE — a web login must never rotate `sessionToken`.** The legacy single token is still written on every *desktop* login and is still the fallback comparison, because a renderer open for weeks is running a bundle that knows nothing else ([rule 9c](../CLAUDE.md#cross-cutting-rules-do-not-violate)). Rotating it on a web login would displace every long-lived Electron renderer the moment anyone linked a browser — a user who did nothing but click a link, kicked out mid-shift. `recordSuccessfulLogin` takes `kind` for exactly this, and defaults to `'desktop'` because that is what every bundle predating device identity is.

**How the client decides it has been displaced** (`useUserData`), in order:
1. `sessions[deviceId]` exists → compare **its** token. This is the authority.
2. Otherwise → compare the legacy `sessionToken`.

Step 2 must stay. A session established before device identity shipped has no map entry, and a client that cannot mint an id (storage blocked, private window) never will — treating either as "revoked" would sign out a user who did nothing wrong.

**RULE — revoking rotates, it never deletes.** `revokeSession` replaces the entry's token and drops the index doc. Deleting the *entry* would send that client back to step 2, where the legacy token may still match — i.e. the user would not actually be signed out. Deactivation (`PUT /api/admin/users/[uid]` with `isActive: false`) needs **both** halves for the same reason: it rotates `sessionToken` *and* deletes the whole `sessions` map, so new-bundle clients fall through to a comparison that now fails.

The delete cascade calls `releaseAllDeviceSessions` — without it the index keeps resolving a deleted employee's browser to their old uid, which is exactly the lookup the public share page performs. See [user-management.md](user-management.md).

**RULE — a displaced logout must clock the timer out first.** `AuthWrapper`'s displaced effect `await`s `clockOutAndFlush()` (from `TimeTrackingContext`) *before* `auth.signOut()`. A displaced user is signed out without ever reaching the Clock Out button, so skipping this leaves the session open server-side until the daily stale-session Cloud Function closes it — and leaves a buffer with no `clock-out` event, which renders as a phantom live session. See [time-tracking.md](time-tracking.md#3-crash--restart-robustness).

#### Linking a browser (the seed of web access)

`POST /api/auth/session-token` is the browser login path and now doubles as "link this browser": it takes `{ deviceId, deviceLabel }`, runs the same allowlist check, and registers a **web** session. Two callers today — the browser Login screen, and the "I work here" affordance on a public share page. With no usable `deviceId` it falls back to the original behaviour (rotate the single token) rather than refusing the login.

`POST /api/auth/device` is **unauthenticated** and answers one question — `{ known: boolean }` — by looking a device id up in the index. It is the narrowest possible surface on purpose:

- **No PII leaves it.** Not a name, not an email, not a uid. A device id is a random UUID held only by the browser that minted it, so `true` tells its owner something they already know.
- **It grants nothing.** Being recognised only decides which button the share page emphasises; every real read is authorised elsewhere.
- Deactivated and archived users resolve to `false` — `lookupDeviceOwner` re-checks the user doc rather than trusting the index, and also re-checks that the session still exists.
- Rate limited per id (20/min, in-process).

This is deliberately the first working piece of **web access**: once a browser is linked it holds a real, server-recognised session for a real user. See also [data-layer.md](data-layer.md).

---

## API Route Auth Middleware

Every API route wraps its handler in one of:

- **`withAuth`** — verifies Firebase Bearer token, injects `DecodedIdToken` (as `token`).
- **`withCreatorAuth`** — same, **plus** verifies the caller exists in the `creators` collection and `isActive !== false`.

### Authorization tiers (least → most privileged)

Authorization layers **on top of** the middleware inside handlers.

| Tier | Check | Use for | Examples |
|---|---|---|---|
| 1. Authenticated only | `withAuth` alone | General reference data needed across many pages where a single page-permission check would block legitimate callers | `/api/creators`, `/api/users/display-names`, `/api/disputes/users` |
| 2. Page permission | `checkPageAccess(token.uid, '<pageId>')` (`apiHelpers.ts`) or inline `caller.permittedPageIds.includes(...)` | Most admin/feature endpoints | Most of `/api/admin/*`, `/api/shifts/*` |
| 3. Admin claim | `token.admin !== true` guard | Actions gating access to the **system itself** or the **authorization graph** | see below |

**Tier 3 (admin claim) is required for:**
- **Admin group membership writes** — `/api/admin/groups/admin/members` POST/DELETE. Also blocks self-promotion: `uids.includes(token.uid)`.
- **Page-permission map writes** — `/api/admin/pages/[pageId]/permissions` PUT. Editing this map is the root of all other authorization decisions, so it requires admin **even though** `'sharing'` page permission still gates the read on `/api/admin/pages` (GET). This asymmetry is intentional: anyone with `'sharing'` could otherwise grant themselves any page and chain into account-level changes.

**RULE:** When adding a new admin-action route, decide which tier applies. **Do not** default to "page permission" if the action affects the auth graph or account state (`isActive`, admin membership, the permission map).
