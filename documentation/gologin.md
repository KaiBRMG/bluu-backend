# GoLogin

> The browser-profile console. Runs in its **own Electron window** — the second satellite after OF Manager — and reads GoLogin's REST API through a single adapter. Every operator holds a **paid GoLogin workspace seat** granted by an admin; an admin assigns them profiles; the app enforces one-at-a-time access with a lock GoLogin does not have.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/gologin/types.ts` | Domain model + the `IGoLoginClient` contract. **Client-safe** — the only half a renderer may import |
| `src/lib/gologin/providers/gologinApi.ts` | **The only** file that knows GoLogin's URLs/payloads/auth |
| `src/lib/gologin/index.ts` | `getMasterGoLoginClient()` / `getUserGoLoginClient()` (`server-only`) |
| `src/lib/gologin/tokenCrypto.ts` | AES-256-GCM envelope for operators' personal tokens |
| `src/lib/services/gologinAccountService.ts` | Seats, folder provisioning, membership checks, token linking — the heart of the model |
| `src/lib/services/gologinService.ts` | Access gate, the memoised bounded walks, assignment writes |
| `src/lib/services/gologinLockService.ts` | The session lock and its lease |
| `src/app/api/gologin/access/route.ts` | Permission probe for the Electron main process |
| `src/app/api/gologin/account/route.ts` | Link / read / unlink a personal API key |
| `src/app/api/gologin/profiles/route.ts` | The caller's own listing (`?refresh=1`) |
| `src/app/api/gologin/launch-token/route.ts` | **Hands the caller's own token to main.** Read its header first |
| `src/app/api/gologin/session-lock/route.ts` | Claim (authenticated) + admin force-release |
| `src/app/api/gologin/session-lock/lease/route.ts` | Heartbeat / release, authenticated by the lease secret |
| `src/app/api/gologin/admin/members/route.ts` | Management: grant/revoke seats, reconcile a pre-existing workspace |
| `src/app/api/gologin/admin/assignments/route.ts` | Management: read the folder tree, add/remove profiles |
| `electron/main.js` (GoLogin section) | The SDK, the session map, Orbita downloads, the lock lease |
| `src/hooks/useGoLoginAccount.ts` | Seat + token state for the current operator |
| `src/hooks/useGoLoginProfiles.ts` | The window's one profile fetch |
| `src/hooks/useGoLoginSessions.ts` | Local session state + launch/stop |
| `src/hooks/useGoLoginLocks.ts` | Live "who has this open", over `onSnapshot` |
| `src/hooks/useOrbita.ts` | Orbita install state + download progress |
| `src/app/gologin/_components/MembersPanel.tsx` | The seat-management half of the Management dialog |
| `src/app/gologin/_components/Notice.tsx` | The window's one full-screen message — no seat, no access, rejected token |
| `src/app/gologin/_lib/session.ts` | Session labels, the error vocabulary (incl. `invalid-token`) and `TONE_CHIP` |
| `src/hooks/useAuthFetch.ts` | `ApiError` — carries the route's `code` through the throw |
| `src/app/gologin/**` | The window: layout, guard, onboarding, list, Management, Orbita gate |
| `src/lib/definitions.ts` | `apps-gologin` page (Apps teamspace, `href: null`) + its `apps-gologin-management` sub-item |

## Firestore

Two collections, **both new**, both with rules and index exemptions in place.

| Collection | Who reads | Why |
|---|---|---|
| `gologin-accounts/{uid}` | Admin SDK only | The seat binding (uid to GoLogin address + folder id) and the encrypted API token |
| `gologin-sessions/{profileId}` | **Client-readable**, Admin-written | The live session lock. Readable so a row can say "In use · Kai" without polling the provider |

Plus three non-secret fields mirrored onto `users/{uid}`: `gologinEmail`, `gologinMemberSince` and `gologinLinkedAt`. They exist so the window can decide "onboarding or profiles?" off the `useUserData` snapshot it already holds, at zero extra reads.

> **The API key is deliberately NOT on the user document.** `users/{uid}` is streamed to the renderer by `onSnapshot`, so a field there is a field the client has. That is the entire reason `gologin-accounts` exists as a separate, fully-denied collection.

**Nothing queries `gologin-accounts`, and nothing should start.** Every field is exempt from indexing and every consumer reads it by id or reads it whole — it holds one document per paid seat, so it is bounded by headcount. The clash check in `addGoLoginMember` was briefly a `where('glEmail', '==')`, which broke in production on 2026-09-11 with `FAILED_PRECONDITION`: `glEmail` was in the exemption list, correct back when that check queried `glUserId` and stale after the seat rework. It is an in-memory scan now, which removes the deploy-order coupling (code that only works once an index is deployed *and* finished building breaks between two correct deploys), lets the match run through `normalizeEmail`, and avoids index write amplification on every token link. If you ever add a `where` here, add the index in the same change — or better, don't.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `GL_API_TOKEN` | yes | The **master workspace** token. Server-side only — it no longer reaches any desktop |
| `GL_TOKEN_ENC_KEY` | yes | 32 bytes, base64. Encrypts operators' personal tokens — see below |
| `GL_WORKSPACE_ID` | no | Overrides `defaultWorkspace` from `GET /user`. Only needed if the master account owns more than one workspace |

Without either, the relevant route answers **503 with a named cause**, deliberately — an empty list would read as "you have no profiles", which is a different fact.

**Generating `GL_TOKEN_ENC_KEY`.** Any 32 random bytes, base64 or hex — `getKey()` accepts both, because `openssl rand -hex 32` is what half the internet will reach for:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # anywhere
openssl rand -base64 32                                                        # not on PATH on Windows
```

⚠ **Losing or rotating this key re-onboards the entire team.** Every `tokenCipher` becomes undecryptable and every operator has to paste their GoLogin API key again. `decryptToken` returns null rather than throwing so that failure surfaces as "add your key again" instead of a 500 — but that is damage control, not a recovery. Keep a copy somewhere durable, and treat a rotation as a scheduled event with a heads-up, not a routine credential refresh.

---

## The model, and the constraint that forced it

**A free GoLogin account cannot generate an API token. Only a workspace member — a paid seat — can.** That single fact decides the shape of everything here, and it invalidated the first design: sharing a folder to someone's free account let them see the profiles in GoLogin's own app, but gave them no way to hand Bluu a key. Discovered on 2026-09-10, after the sharing model was built.

So the sequence is:

1. An **admin grants the seat** on the Management surface. That one action creates the person's folder *and* invites them scoped to it (`POST /workspaces/{wid}/members` with `limitedAccess: true`). **Provisioning happens here, not at onboarding** — a folder is a consequence of holding a seat, so it is created when the seat is granted.
2. They accept GoLogin's invitation email, and can now mint an API token.
3. They paste it into Bluu's onboarding, which only verifies and stores it.

**Assignment is folder membership.** Granting a profile adds it to their folder, revoking removes it; the seat's folder scoping is never touched again. That is what makes revoking possible at all — `DELETE /share/folder/{id}` takes no recipient parameter, so per-person unsharing is not something the API can express. Folder membership can.

**Two identities, kept apart.** `getMasterGoLoginClient()` administers the workspace, its folders and its members. `getUserGoLoginClient(token)` lists and launches. The master token never leaves the server.

### Membership is a second gate, not a formality

`apps-gologin` can be granted to anyone on `/admin-portal/sharing`, and that grant says nothing about whether GoLogin will accept them. So every route checks **both** — `requireGoLogin(uid)` is the pair — and the membership half returns **403 `not-a-member`**, which the window renders as "ask an admin" rather than as a permissions error.

**It gates the onboarding screen too**, ahead of step 1. Walking someone through fetching a token they cannot generate is worse than telling them they have not been added yet. The one deliberate exception is `GET /api/gologin/account`, which *reports* membership — gating it on membership would leave a non-member unable to be told why they cannot proceed.

### Admins use the master token; everyone else uses their own

A Bluu **admin** (in the `admin` group) is not an operator with a narrower view — they run the workspace. So `usesMasterGoLoginToken` short-circuits the whole seat mechanism for them: they are reported as members without a provider call, they launch with `GL_API_TOKEN`, they are never offered a seat in Management, reconciliation skips them, and assignment refuses with a 409 because there is no subset to scope them to. Promoting someone into the `admin` group grants this and demoting revokes it — there is nothing to configure and nothing to keep in sync.

⚠ **This is the one place the master token reaches a desktop.** An admin launching a profile has `GL_API_TOKEN` handed to their machine, where it is extractable. That is access they already hold through the admin claim, with one difference that matters: **an extracted copy outlives their Bluu account**, so **rotate `GL_API_TOKEN` whenever an admin leaves**. Non-admin operators are unaffected — their desktops only ever see their own key, scoped to their own folder.

A provider outage returns **503 `member-check-failed`**, never 403. "GoLogin is unreachable" must not read as "you were removed from the workspace".

### Consequences worth knowing before changing anything

- **`folderId` is the anchor; `folderName` is not.** Both `PATCH /folders/folder` and the member-scoping calls address folders **by name**, and anyone can rename one in GoLogin's dashboard. The id is stored and the current name is resolved before every mutation. Never mutate with a stored name.
- **`POST /folders/folder` returns no id.** The folder is read back from `GET /user` by name — the one moment a name is trusted, and safe only because the name carries a uid fragment (`Bluu · Kai · a1b2c3`), which is what stops two people called Kai adopting one folder.
- **A member's email is usually not their Bluu `workEmail`.** The admin supplies it when granting the seat, and it is what everything downstream matches on. Linking re-checks it: a token belonging to a different GoLogin account is refused (`wrong-account`), because otherwise someone could hold a seat under one address and paste a token for another, and their listing would be scoped to the wrong folder.
- **`GOLOGIN_MEMBER_ROLE` is `editor`, always with `limitedAccess: true`.** `guest` would be read-only and running a profile *writes* — `gl.stop()` uploads cookies and local state, so a read-only member would be logged out again every session. `admin`/`owner` would let an operator re-scope their own folder access, which is the whole thing the assignment surface exists to control. Without `limitedAccess` the role applies to the entire workspace rather than to their folder.
- **Removing a seat keeps the folder.** It holds the assignment record for profiles that still exist, and re-adding the person adopts it again — so a mistaken removal is fully reversible. Deleting it would silently unassign work someone may simply be handing over.
- **`recepients` is the provider's own misspelling** and is load-bearing on `share/multi`. That path is no longer used for onboarding, but the method remains on the client; "correcting" the spelling shares with nobody and still returns 201.
- **Nothing is mirrored.** Assignment lives in GoLogin's folder membership and only there; Firestore holds the binding and the secret.

### Bringing an existing workspace under management

The workspace was in use before this feature, so it holds members who have seats but no Bluu folder and no `gologin-accounts` row. **Reconcile** (Management → Members) walks the member list, matches each address against a Bluu user's `workEmail`, creates the folder, and re-scopes them onto it with `PATCH` — they cannot be re-invited, they are already in.

Matching is on the **normalised** address on both sides. It was originally a
`where('workEmail', '==', member.email)` query per member, comparing GoLogin's raw string to
Firestore's — an N+1 read (rule 9) that also failed on any difference in case. GoLogin echoes
whatever casing someone typed at sign-up, so that quietly matched almost nobody and Reconcile
reported success having done nothing. The `users` collection is now read once and matched in
memory through `normalizeEmail`.

Rules that make it safe:

- **Exactly one `workEmail` match, or it is not a match.** Two would be ambiguous; zero means they signed up to GoLogin under a different address. Either way it is reported as unmapped for an admin to map by hand, because binding the wrong Bluu user to a seat would show one person another person's profiles. Archived users are excluded from the match set.
- **The workspace owner is skipped**, and **admins are counted as skipped** rather than passed over silently — they use the master token, so a seat-scoped folder would swap full access for a narrower slice of it.
- **A failure is not an unmatched address.** They are separate fields on the result, because conflating them sends an admin looking for a Bluu user who is sitting right there.

It is **sequential**, never `Promise.all` — each provision is two or three provider calls, and twenty members fanned out is exactly the burst that costs the token.

**Every outcome is reported in the toast** (`3 set up · 2 already done · 1 unmatched`). The original copy said "Every matched member already has a folder" whenever nothing was provisioned, which read as "all done" on precisely the run where matching had failed for everyone. Unmapped seats in the panel are **clickable**, loading the address and its Bluu user into the Add form — a retyped address is how the wrong person gets bound to a seat.
## The rate limit is still the whole design

GoLogin documents 300 requests/minute on free and trial plans, 1200 on paid, and states that **a 429 permanently revokes the API token**. It is not a throttle you back off from; it is the key being destroyed, and the fix is reissuing it in the dashboard and redeploying.

- **The profile list is 30 per page** (the provider's own maximum). The walk is **strictly sequential** — never `Promise.all` over pages.
- **Bounded at 40 pages / 1200 profiles** (`MAX_PAGES`), with `truncated: true` past the cap rather than a quiet lie about the count.
- **Memoised for 60s, keyed per operator** (`u:{uid}`), with **in-flight de-duplication**. Per-operator matters twice over: each token has its own request budget, and one shared cache would leak another operator's profiles.
- **`?refresh=1` bypasses the TTL but not a 15s floor.** A held-down refresh button is the realistic route to 429.
- **`GET /user` is memoised 60s too**, and invalidated on every folder mutation. It answers "what folders exist and what is in them" in one request — cheaper than `GET /folders` plus a walk.
- **Nothing polls.** Live session state comes from **Firestore**, not from GoLogin's `isRunning` flag, precisely so that nothing has to.

> Same standing rule as the OnlyFans provider (CLAUDE.md rule 9b), for a different reason: **do not `curl` `api.gologin.com`.** There the hazard is billing; here it is a request budget whose overrun is unrecoverable.

## The adapter seam

`providers/gologinApi.ts` is the only file that knows a GoLogin URL, header or field name. `GoLoginApiError` is the one error type callers see.

Three normalisation decisions are load-bearing:

- **`normaliseProfile` is a security boundary.** The provider's profile object carries the full fingerprint, the **proxy's username and password in cleartext**, a `facebookAccountData` block containing an account password, and `sharedEmails` — every colleague a profile is shared with. Only display facts cross the seam. Assignment is read from folder membership instead, which only the master token can see, so no renderer ever needs `sharedEmails`.
- **`normaliseAccount` drops the payment block.** `GET /user` returns the Stripe customer id and the card's last four digits. Identity, plan ceilings and folders are all that is kept.
- **`os` is probed, not assumed.** Documented as an untyped object, ships as a plain string. Both are read.

The response is checked for a JSON content type before parsing — a Cloudflare block answers HTML with a 200.

## Security

Four independent layers:

1. **Electron main process** — the window is not created until main has sent the renderer's ID token to `/api/gologin/access` and got a 200.
2. **Every API route** re-checks `requireGoLoginAccess(uid)` — the `apps-gologin` page permission, tier 2. The Management routes (members + assignments) additionally require **`requireGoLoginManagement(token)`**: holding the page lets you *use* profiles, not hand them out. The force-release on the session lock is the one control still gated on `requireGoLoginAdmin` outright.
3. **`GoLoginGuard`** refuses to render for a user without the page.
4. **GoLogin itself** — an operator's token can only see what has been shared into their account. A bug in our filtering can show *fewer* profiles, never more.

Plus: `src/lib/gologin/index.ts` is `server-only`; `types.ts` carries no imports and is the half the renderer uses.

### The token still has to reach the desktop — but it is a much smaller token now

Nothing on Vercel can launch a browser on someone's desk, so `POST /api/gologin/launch-token` hands one over per launch. What it hands over is **the caller's own personal key**, to a caller with a valid Firebase ID token *and* the `apps-gologin` permission, held in main's memory for the life of the session: never on disk, never across the preload bridge, never cached (so a revoked permission stops the next launch, not the next app start).

The residual risk is now confined to the operator's own free GoLogin account, which sees only what was shared into it. **The master key is no longer extractable from any desktop**, and rotating it on offboarding is no longer necessary — removing the person's `apps-gologin` permission or deleting their `gologin-accounts` row cuts them off.

`GL_TOKEN_ENC_KEY` is not protection from the server — anything that can read it can decrypt, and the launch path needs the plaintext. It raises the bar from "read one collection" to "read one collection *and* hold the deploy environment".

## Concurrency: the lock is ours

**GoLogin does not prevent two people opening one profile, and the SDK certainly does not.** Its docs say nothing about concurrent access; the payload carries an undocumented `lockEnabled` alongside `isRunning` / `canBeRunning` / `isRunDisabled`, but nothing in `gologin.js` reads any of them before spawning. It just launches. The consequence is not a merge conflict — it is one account live on two machines and two IPs, which is the exact thing an anti-detect profile exists to avoid.

So the lock is `gologin-sessions/{profileId}`, claimed in a **Firestore transaction** before anything is spawned. It is server-side because the two operators are on two different machines and no client can see another's sessions. Using GoLogin's own `isRunning` was never an option: watching it change means polling, and polling means a revoked token.

**The lease.** A claim returns a 256-bit secret, and *that* — not a Firebase ID token — authenticates the heartbeat and the release. A browser session routinely outlives the hour an ID token lasts and main holds no refresh token, so an authenticated heartbeat would simply start failing mid-session and hand a live profile to the next person who asked. Only the SHA-256 is stored, comparison is constant-time, and possession grants exactly one thing: keep or drop one lock on one profile. That is why `/session-lock/lease` sits outside `withAuth`, the same construction the public share page uses for its share token.

**Expiry.** The lock is released by the teardown that closes Orbita, which covers Stop, a manual close, a crash and app quit. It does *not* cover a machine losing power — so the holder heartbeats every 60s and a claim quiet for 3 minutes may be taken. A lock that cannot be released is worse than no lock. An admin can also force-release (`action: 'force-release'`, admin claim required).

It binds everyone who goes through Bluu, and not someone driving the SDK with their own token — the same boundary as everything else here. It still prevents the accident that actually happens.

## Orbita: downloading, and updating mid-session

Orbita is a full Chromium build fetched from GoLogin's CDN, hundreds of megabytes. Two facts shape the UI:

- **The SDK reports progress by drawing a CLI progress bar to stdout.** In a packaged Electron app that goes nowhere, so a first launch looked like a multi-minute hang.
- **The required major version comes from the profile's own user agent** (`resolveProfileBrowserVersion`), not a global "latest". A perfectly onboarded operator can click Launch on an unusual profile and trigger a fresh download.

So `main.js` replaces **only** `downloadBrowserArchive` on the SDK's `BrowserChecker` instance, reporting bytes over `gologin:orbita-changed`. Extraction, the hash check and the install stay the SDK's own — re-implementing them is how a half-written browser directory happens. The checker is instrumented *before* `gl.start()` on every launch, so an update that begins mid-launch is reported the same way as an onboarding download.

`OrbitaGate` covers the whole window whenever the phase is `downloading` or `installing`. It blocks on purpose: everything else on the surface leads somewhere that will fail until the install finishes. It is not a `Dialog` — there is no dismiss, no escape and no outside-click, and a modal that cannot be closed is a screen.

## The window

`/gologin` is **not** inside `(main)`, and that is load-bearing for the same reason `/of-manager` is not: `(main)`'s layout mounts `TimeTrackingProvider`, and a second copy in a second window would run a second heartbeat, screenshot scheduler and clock-out flush against one session. The layout mounts only `AuthProvider` + `NetworkStatusProvider` + `UserDataProvider`.

It inherits every satellite property from `openSatelliteWindow` — co-equal with the main window (never `parent:`), resizable with a 900px minimum, one window per `key`, closed with the main window, and the shared `attachWindowBehaviour`.

**Three states, exactly one rendered:** onboarding until an account is linked, the Orbita gate whenever the browser is installing, otherwise the list.

### Onboarding

Gated on membership first: a non-member sees "you have not been added yet" instead, because the steps below end in fetching a token they cannot generate.

Three steps, shown **all at once rather than one at a time**. Step 1 is a long background download and steps 2–3 happen in another application, so a wizard would serialise naturally parallel things and add minutes to every new operator's first day.

**There is deliberately no link to GoLogin's token page, and re-adding one is a regression.** Deep-linking `https://app.gologin.com/personalArea/TokenApi` **does not work** — GoLogin redirects to its dashboard, so the button dropped the operator somewhere that looked wrong and implicitly blamed them for it. The route is described in words instead ("head to *API & MCP* and create a new API token"), and that instruction lives in **step 2, not step 3**: step 2 is where the operator is actually standing inside GoLogin's UI having just signed in, so it is read at the moment it applies. Step 3 is then only "paste it here", which is the one thing that happens back in this window.

The one external link that does work — sign-in — goes through `window.open`, which the shell routes to `shell.openExternal`. GoLogin's site must not open inside a Bluu window (the operator needs their password manager, and `will-navigate` would bounce it anyway). The token field is `type="password"` because this window is routinely on a shared screen, and it is cleared on success.

**Step 2 carries an "I've accepted it" control, and it is not optional polish.** `joined` comes from a fetch that runs once on mount, and the invitation is accepted in a *different application* — so an operator who accepted it in their inbox and switched back found the step still unticked with nothing on screen to do about it. The documented remedy was to quit and reopen the window, which is a workaround presented as an instruction. `onRecheck` (the account hook's `reload`) is one cheap request and replaces it. The same button is on the **no-seat** notice for the same reason.

### The list

**Bluu's own per-operator folders are never displayed.** Every profile an operator can see sits in *their* `Bluu · …` folder — that is the mechanism by which they can see it — so as a filter chip it matches everything and as a row chip it is on every row. An admin, seeing the whole workspace, would get every *other* operator's folder on every row instead. `isManagedGoLoginFolder` (in the client-safe `types.ts`, shared with `folderNameForUser`) strips them from the chips, the rows, the Management profile list and both search indexes.

That test is **name-based and therefore best-effort** — rename a folder in GoLogin's dashboard and it reappears. Deliberate: it decides *display only*, so a miss costs one stray chip. Anything that grants or revokes keys off `folderId`, never this.

**Folders appear twice** — as filter chips beneath the search bar and as greyscale attribute chips on the row. Two rules hold the filter row together:

- **The counts are faceted, or they are lies.** Each chip is counted over the *search* matches with the folder filter cleared.
- **The selected folder is derived, never corrected.** A folder can vanish under the reader; `activeFolder` resolves to `null` the moment its chip is gone rather than an effect writing state back — `react-hooks/set-state-in-effect` fails the build over that.

**The list is a client-side lazy window: 30 rows, extended by an `IntersectionObserver` sentinel.** Every profile is already in memory, so this is DOM cost, not network — which is why the sentinel is a bare `h-px` with no spinner and the count line carries the state. The window resets **during render against a `listKey`**, not in an effect.

**A failed proxy gets its own chip.** The SDK tests the profile's proxy *before* it spawns anything — `getTimeZone` fetches a timezone through it and throws — so a dead proxy is much the most common launch failure, and the only one whose remedy the operator can act on themselves. Main maps it to `proxy-error` and the row shows a red **Proxy Error** chip with the fix on its title attribute; left generic it read as "GoLogin could not start this profile" and sent people to an admin for something they can see in GoLogin.

Detection is on the error *message* because that is all the SDK offers: it throws a bare `Error('Proxy Error')` (or `'Proxy Error (Gologin)'`), and for non-SOCKS proxies rethrows the underlying request error with `(Gologin)` appended. The check runs **last** among the SDK failures, so an explicit code always wins — a timeout that happens to mention a proxy is still a timeout.

**The listing states its own age, because nothing polls.** `fetchedAtMs` was on the client and used only as a cache key; the count line now ends "· read 12m ago", ticked once a minute. A surface that deliberately refuses to auto-refresh (see the rate-limit section) owes the reader that number — without it "nothing polls" is indistinguishable from "this is live", and an operator launches a profile that was unassigned an hour ago.

**Rows are ordered live-first**, then by the provider's order: the operator's own running sessions, then locked-by-someone-else, then GoLogin's `isRunning`, then the rest. Their own live sessions are the rows they come back to, and alphabetical order scatters three of them through hundreds. Nothing reorders while it is being read — the only thing that moves a row is a session starting or stopping, which the operator caused.

**The keyboard model is DOM focus, never a React cursor.** `/` focuses search, `j`/`k` walk `button[data-row-action]` (each row's own primary control, disabled ones skipped), and `Enter` is the browser's own activation of whatever is focused — there is no handler for it. A parallel selection state would have to be kept in step with a list that reorders as sessions start, would re-render the window on every keystroke, and would be invisible to a screen reader. It also keeps a keystroke from firing a billed provider call by itself: the operator still presses Enter on a button they can see is focused. The listener is bound to the page element, **not** `window`, so the Orbita gate and the close guard — which render as siblings outside that subtree — keep the keyboard to themselves.

**The folder chip row is capped at eight**, with a "+N more" toggle. It grows with the workspace and the viewport does not; uncapped, a twenty-folder workspace pushed every profile row below the fold. The selected chip is always kept in the visible set — a filter you cannot see is a filter you cannot clear.

**A rejected token gets its own screen, not an error line.** `goLoginErrorResponse` codes a 401 (token rejected) or 429 (rate limit, which *revokes* the token) as `invalid-token`; `useAuthFetch` carries the code through on an `ApiError`, and the window renders a full `Notice` with a **Replace my token** action that calls `unlink()` and drops back into onboarding step 3. Before this, the failure the entire subsystem is architected against surfaced as GoLogin's own untranslated message beside a **Retry** button — the one action that cannot possibly work — and `unlink` existed in the hook with no caller, so there was no route back to the paste field at all.

**A row distinguishes three kinds of "running", on purpose:** `session` (open on this machine — we can stop it), `lock` (Bluu's lock, live across every machine — the row is blocked and the *server* will refuse the launch), and `profile.isRunning` (GoLogin's own flag, only as fresh as the last fetch, kept as a weaker last resort because it also catches someone running the profile outside Bluu). The blocked button is **disabled, not hidden** — a missing button reads as "this row has no action", when the fact is "not right now, and here is who has it". The status dot follows the same three-way split: green means *yours*, blue means *live but not yours*, zinc means idle. It used to paint green on all three, which contradicted the chips beside it on the one question the dot is asked.

**A blocked row carries an admin force-release.** The route and `forceReleaseProfileLock` have existed since the lock did and nothing ever called them, so the only way to free a wedged claim was the Firestore console. The three-minute stale window covers a machine losing power; it does **not** cover a holder whose app is hung, which heartbeats never stop for and teardown never runs for. It is confirmed with an `AlertDialog` that names the holder and states the cost — clearing the lock does not close their browser, so if theirs is still open their session will not be saved back and two people can end up signed into one account. ⚠ The route gates on **`requireGoLoginAdmin`, not a bare `token.admin`**, for the same reason the Management routes do: claims do not reach an already-issued ID token, this renderer runs for weeks (rule 9c), and the button renders off the live `userData.groups` snapshot — a bare claim check would show an admin a control that answers "Admins only".

### Management (admins, or the Management grant): two tabs, one workflow

A dialog rather than a page: it edits the contents of the list behind it, and the window has no sidebar to navigate back with. It spends money and grants access to live logged-in accounts, so it is never reachable on the `apps-gologin` page permission alone.

**Who gets in — changed 2026-09-19.** It was admin-only. The problem was not the bar but the *instrument*: the only way to let someone run the GoLogin workspace was to make them a Bluu **admin**, which also hands them user management, the permission map itself, and `GL_API_TOKEN` on their desktop. Management is now its own grant — **`apps-gologin-management`**, a **sub-item** of `apps-gologin` on `/admin-portal/sharing` (the indented row under GoLogin). See [permissions.md](permissions.md#sub-item-pages-a-capability-inside-a-page) for the mechanism.

- Server: `requireGoLoginManagement(token)`, always paired with `requireGoLoginAccess` — Management without the GoLogin page is not a state a route may be reached in.
- Client: `canManage` in `src/app/gologin/page.tsx` — `isAdmin || permittedPageIds.includes('apps-gologin-management')`.
- **Admins are in unconditionally, and that is not a convenience.** They run the workspace on the master token (`usesMasterGoLoginToken`), so revoking the Sharing row from them would lock the only people who can administer it out of it. The row is for delegating *to* non-admins.
- The sub-item is **not** a satellite page and has **no href** — the sidebar skips it. The only thing it changes is whether the Management button renders inside the GoLogin window.

⚠ **Neither half is a bare `token.admin` check, and that distinction is load-bearing.** `setCustomUserClaims` does not reach an ID token that has already been issued, and this renderer routinely runs for weeks without a reload (rule 9c). Both flags meanwhile render off the live `users/{uid}` snapshot (`groups`, `permittedPageIds`). So a raw claim check drifts, one-directionally and visibly: the button appears and every route behind it answers "Admins only" — reported on 2026-09-11 with the claim correctly set server-side the whole time. The claim is kept as the fast path, with the `admin` group (via the 60s-cached `getUserById`) as the fallback, then the page grant. That is not a weakening — the claim is *derived* from that group — and it collapses the two definitions of "admin" this feature briefly had, since `usesMasterGoLoginToken` already decided master-token access from the group.

**Members** is the default tab, because an empty workspace has nothing to assign. It grants and revokes seats, shows the seat budget from the workspace plan, and carries the **Reconcile** action for a pre-existing workspace. Each row says which of four things is true — `Active`, `No token yet`, `Invite pending`, `Seat removed in GoLogin` — because each has a different remedy and a single "inactive" badge would collapse them into one.

Two deliberate asymmetries with the other tab:

- **Confirmation is by blast radius, not by direction.** Removing a seat is confirmed: it ends a paid seat, cuts someone off mid-shift, and cannot restore their GoLogin invitation state, so it gets an `AlertDialog` naming exactly what survives (their folder and its assignments) and what does not. **Whole-folder assign/remove is confirmed too** — `Assign 47` hands a colleague forty-seven live, logged-in accounts in one press. Single-profile toggles stay unconfirmed, correctly: one click, trivially reversible. The panel previously stopped an admin from removing *one* seat while letting a bulk grant of tens of accounts fire on a single click; that asymmetry was an oversight, not a decision, and the bulk dialog now also restates the copy-not-subscription fact at the moment it matters.
- **The GoLogin address defaults to `workEmail` but stays editable.** It is usually right and must never be assumed: people sign up to GoLogin under whatever address they like, and the seat must be granted to the one they will actually hold.

**Profile access** is the assignment surface, and **who it is writing to has to be unmistakable**. The selected operator is the Action Blue **tint** (`/15`) plus `font-semibold text-white`, with unselected rows at `font-medium text-zinc-400` — hue separating selection from hover, the same recipe DESIGN.md §5 prescribes for the sibling satellite's chat rows. It shipped as `bg-white/[0.06]` selected against `bg-white/[0.03]` hover, about 1.1:1 apart and effectively invisible, on the pane where every control grants access to a live logged-in account; `selected = users.find(…) ?? users[0]` also falls back to the first person when the selection is lost on a refresh. The pane header now names the operator outright, because the search placeholder that used to carry that name disappears the moment anyone types.

Left pane picks the operator (with their assigned count, which is the question an admin arrives with), right pane assigns — whole folders first, then individual profiles with assigned ones sorted first. Per-profile writes are optimistic and roll back by **reloading** rather than inverting — after a failed write the real membership is whatever GoLogin says, not whatever we guessed.

**Assigning a folder is a copy, not a subscription.** `changeAssignmentFromFolder` expands the source folder to the profiles it holds *at that moment* and adds those to the operator's own folder. A profile added to the source folder afterwards does **not** reach them: GoLogin offers no webhook, so keeping the two in step would mean polling, and polling is the one thing that reliably destroys the API token (rule 9e). The panel says so on the folder header rather than leaving an admin to assume a live link and under-assign for weeks.

Four details of that surface are deliberate:

- **The server expands the folder**, not the client. The expansion comes from the already-memoised folder tree, so it costs nothing, and a 90-profile folder never meets `MAX_BATCH` — that cap bounds hand-picked selections, not a folder that is legitimately large.
- **Operators' own folders are excluded as sources.** They are the *destination* of an assignment; offering one as a source would let an admin copy one person's entire caseload onto another by clicking a row that looks like any other.
- **Folder rows hide while searching.** A search is about finding one profile, and bulk buttons above a filtered list invite assigning far more than what is on screen.
- **Assign and Remove both stay visible**, each disabled at its no-op, rather than one button swapping identity as the count changes — which is how "remove all" gets clicked by accident. Folder writes are **not** optimistic: guessing the result of moving tens of ids would be a large, confident lie if the write failed.

**It fetches only when its tab is opened**, not when the dialog is. Its payload costs a `GET /user` plus a full profile walk, and an admin who came only to add a member must not spend that.

The share budget (`plan.maxShares` from `GET /user`, against the summed folder membership) is shown above it. GoLogin meters "1 share = 1 instance of a shared profile", so a folder of 40 profiles reaching 10 people is 400 shares.

### Older installed builds: a hard version floor

**GoLogin requires the desktop app at v0.12.0 or newer, and refuses below it.** `SATELLITE_PAGES["apps-gologin"].minVersion` in [`Sidebar.tsx`](../src/components/Sidebar.tsx) is the gate: clicking the sidebar item on an older build shows a `toast.error("Access denied")` and opens nothing.

This is the one satellite with a floor, and it does **not** follow OF Manager's pattern of falling back into the main window. That fallback exists because OF Manager's page works perfectly well without a dedicated window. GoLogin's does not: the Orbita downloader, the progress reporting and the session lock's lease all live in `main.js`, so a pre-0.12.0 shell would render the list and then fail on the first Launch. A clean refusal is better than a surface that looks fine and cannot do the one thing it is for.

Three properties of the check are deliberate:

- **It runs before the permission check**, because this is not a permission problem — the page may well be granted to someone who simply has not updated.
- **An unknown version fails closed.** No `app.getVersion` IPC, a rejected promise, an unparseable string — all read as "too old". A floor exists because specific main-process code must be present; "I could not tell" is not evidence that it is.
- **`invalid-path` is refused rather than routed.** An older `SATELLITE_PREFIXES` produces the same refusal, so the two ways of being out of date converge on one message.

Within a build that clears the floor, the newer main-process calls are still feature-detected (`api.orbitaStatus`), so a partially-updated shell reports "update Bluu" rather than failing silently.

## Launching a profile

**The launched browser is not an Electron window, and cannot be made into one.** The SDK downloads and runs Orbita on the operator's own machine and returns a CDP `wsUrl`. Orbita owns its own OS window. GoLogin's Cloud Browser was weighed and rejected on a hard constraint — **the plan allows 3 concurrent cloud sessions** and this serves a whole team.

```
 /gologin (satellite)                 main.js                        Orbita
   row → Launch ─── gologin:launch ──► claim lock (server)
                                     ├► launch-token (own key)
                                     ├► ensure Orbita ──► progress ──► OrbitaGate
                                     └► SDK.start() ──────►  its own OS window
   row ◄──── gologin:session-changed ──┘   + heartbeat every 60s
```

The order is deliberate: **the lock first**, before anything is spawned or downloaded, so losing the race costs nothing but a message. Every failure path releases it.

### Ending a session: three steps, in this order

**`gl.stop()` does not close the browser.** It is `stopAndCommit`: sanitize the profile, upload it, wait 3s, then delete the local profile directory — all while Orbita is still running on those very files. Killing the process is a *separate* SDK method (`killBrowser()`) that `stop()` never calls.

`finalizeGoLoginSession` is the single path for every ending:

1. **`closeOrbita`** — SIGTERM through the child handle on `gl.processSpawned`, so Chromium flushes its profile (which is what makes step 2 worth anything). Not exited in 5s → forced: `taskkill /T /F` on Windows, `SIGKILL` elsewhere. The SDK's own `stopBrowser()` is **not** used — it shells out to `fuser`, absent on both Windows and macOS.
2. **`gl.stop()`** — commit the profile back, bounded at 30s.
3. **Release the lock** — last, and unconditionally. The profile is only free once the browser is gone *and* its state is committed; releasing earlier would let a colleague launch into a profile still uploading.

### "Stopping" is the state worth interrupting someone for

Step 2 above uploads the profile's cookies, logins and local state. Interrupt it and the operator's session work is gone — they log into an account, close the browser, and are logged out again next time. It is bounded at 30s but routinely takes several seconds, and it used to be reported by one grey word on one row.

Three surfaces now carry it, all derived from the same live session map so they cannot disagree:

- **A banner in the window header** while anything is saving — blue, not red: it is work in progress, not a failure, and the operator's job is to wait.
- **A close guard.** `guardGoLoginWindowClose` intercepts the window's `close` event whenever any session is **busy** — `starting`, `running` *or* `stopping` — calls `preventDefault()`, and hands the decision to the renderer via `gologin:close-blocked`. Main draws no UI: a native dialog would look nothing like the window it interrupts.
- **`CloseGuard`**, the dialog. It **names the profiles** and what each is doing, because "3 profiles" is not enough to decide with, and the list is derived from the live session map rather than the payload main sent — a list captured once would not count down as each one finishes.

**Its options depend on what is live, because the two situations have different consequences:**

| Live | Options | Why |
|---|---|---|
| Anything **open** (`starting`/`running`) | **Save & quit**, Cancel | Closing the window does not close Orbita. There is deliberately **no "close anyway"** — it would produce exactly the orphan the guard exists to prevent: a browser running with nothing in Bluu showing it, and a profile locked to that machine until the app quits. |
| Only **saving** (`stopping`) | **Close when finished**, Keep window open, Close anyway | The work is already under way, so waiting is cheap — and the escape hatch is honest about what it costs. |

**Save & quit** (`stop-and-close`) marks the window pending-close, then fires `finalizeGoLoginSession` for every busy profile. It is **not awaited**: each teardown takes seconds and the renderer needs its `stopping` broadcasts *now* to show progress, so awaiting would leave the dialog inert for the whole shutdown with the IPC channel blocked behind it. `resolveGoLoginPendingClose` then closes the window once nothing is busy — it checks **busy**, not just saving, because a session is briefly still `running` before its teardown flips it, and closing in that gap is the early exit the guard exists to prevent.

Neither dialog is a shadcn `Dialog`: no Escape, no outside-click, no dismiss, because each is an unlabelled extra answer and the safe default is not "whatever the stray click meant".

⚠ **Closing the window does not, on its own, abort a save.** Sessions live in the main process, so the commit finishes whether or not the window is open. The guard is worth having anyway for a second-order reason: closing the window removes the only surface reporting the upload, and the natural next step — quitting the app — *is* destructive.

**That quit path is the remaining exposure, and it is not fully solved.** `before-quit` runs the same teardown for every live session but gives up after **12 seconds** (`stopAllGoLoginSessions`), while a single commit is bounded at 30. A quit during a slow upload still truncates it. Closing that gap means either extending the quit budget or guarding quit the way the window is now guarded — neither is done.

**A manually closed Orbita window is the same event.** `watchOrbitaExit` attaches to `processSpawned`'s `exit` — the one authoritative signal, covering a manual close, a crash and an OS kill alike. The two paths race routinely, so `finalizeGoLoginSession` is re-entrant via a `finalizing` flag. Quitting runs the same teardown for every live session, bounded at 12s.

> **A screencast viewer was built and removed.** The CDP `wsUrl` makes it possible to render the running browser on a `<canvas>` inside a Bluu window (`Page.startScreencast` out, `Input.dispatch*Event` back). It was tried on 2026-09-04 and **did not work well enough to keep**: a screencast is a video of a browser, and the interaction never felt like one. Do not rebuild it without a specific reason to expect a different outcome.

## A profile's `os` is a fingerprint, not a requirement

Running a macOS-marked profile on Windows is supported and normal. The SDK computes `this.differentOs`, and its **only** consumer is font masking: `--font-masking-mode=2` normally, `=3` when the OS differs, `=1` for android or empty fonts. There is no check and no refusal. The Orbita binary is always the host platform's; the profile just dresses it up. The one combination worth avoiding is a cross-OS profile with `webGLMetadata.mode: "off"`, which pairs a spoofed OS with a truthful GPU string.

## Permissions

`apps-gologin` is an ordinary tier-2 page in the Apps teamspace with `href: null`. It has **no `page-permissions` doc until someone grants it** on `/admin-portal/sharing`, and a page with no doc grants nobody — fail-closed.

`apps-gologin-management` is a **sub-item** of it (`parentPageId: 'apps-gologin'`): same tier-2 machinery, same fail-closed default, but no href and no sidebar row — see [permissions.md](permissions.md#sub-item-pages-a-capability-inside-a-page). It gates the Management dialog and its two routes. Granting it without `apps-gologin` does nothing: the routes check both, and without the parent the window never opens.

**Three things Management deliberately does *not* carry with it**, because they are admin authority rather than workspace administration:
- **The master token.** `usesMasterGoLoginToken` still reads the `admin` group alone, so a non-admin manager launches with their **own** key and sees their **own** folder. `GL_API_TOKEN` never reaches their desktop. They administer the workspace server-side; they do not become the workspace.
- **Force-release** on a wedged session lock — still `requireGoLoginAdmin`, and still rendered off `groups.includes('admin')`.
- **The seat exemptions.** A non-admin manager is an ordinary operator to every other part of the model: they appear as a seat candidate, reconciliation matches them, and assignment works on them normally.

## Scope

Implemented: per-user account linking with folder provisioning and sharing, Orbita install with progress (including mid-launch updates), profile listing with search / faceted folder chips / lazy window / refresh, local launching, a cross-machine session lock, and an admin assignment surface.

Deliberately **not** implemented: an in-app view of the running browser (built, tried, removed), creating/editing/cloning/deleting profiles, folder *management* (renaming, creating non-operator folders), proxy configuration, fingerprint inspection, scripted automation over CDP, and Cloud Browser.

## Gotchas

- [ ] **Never `Promise.all` the profile pages.** Sequential paging is the rate-limit design, not a style choice.
- [ ] **Never poll GoLogin.** A 429 revokes the token permanently. Live session state comes from Firestore for exactly this reason.
- [ ] **Never import `@/lib/gologin` from a client component.** It is `server-only`; the renderer uses `@/lib/gologin/types`.
- [ ] **Never put a GoLogin token on `users/{uid}`.** That document is streamed to the renderer.
- [ ] **Never widen `normaliseProfile` without checking what the field carries.** Proxy credentials, a Facebook account password and every colleague's email sit on the same object.
- [ ] **Never PATCH a folder with a stored name.** Resolve the current name from `getMasterAccount()` by id first — folders get renamed.
- [ ] **Never assume a free GoLogin account can do anything.** It cannot generate an API token, which is why a seat is required and why `requireGoLoginMember` gates even onboarding.
- [ ] **Never fan out reconciliation.** It is sequential because each member costs two or three provider calls.
- [ ] **Never map a GoLogin member to a Bluu user on a fuzzy match.** One exact `workEmail` hit or it is reported unmapped — a wrong binding shows one person another person's profiles.
- [ ] **Never "fix" `recepients`.** It is the provider's spelling; the correct one shares with nobody and still returns 201.
- [ ] **New GoLogin route → `requireGoLoginAccess(token.uid)` first**, and **`requireGoLoginManagement(token)`** — not a bare `token.admin` — if it changes who can see what. A raw claim check drifts from the live `users/{uid}` snapshot the buttons render off, and this renderer runs for weeks (rule 9c). Reserve `requireGoLoginAdmin` for authority that must not be delegatable (force-release is the only one).
- [ ] **Never surface a provider error string as the whole answer.** A rejected or revoked token is `invalid-token` and gets its own screen with a route back to the paste field. A Retry button on a dead key is worse than no button.
- [ ] **Never `window.confirm` or `alert`.** Destructive acts here use shadcn `AlertDialog`, and the threshold is blast radius: one profile no, a folder of them yes, a seat yes, someone else's lock yes.
- [ ] **Never use the uppercase eyebrow as a section scaffold.** It is the device a *window* names itself with (the list, onboarding, the Orbita gate and the close guard each use it once, correctly). A heading inside a dialog or a panel is a plain `text-xs font-medium text-zinc-400`.
- [ ] **`text-zinc-500` is not a text colour** — 4.12:1 at best, failing on every ground in the app. It is for non-text marks only (the search icons, the idle dot). De-emphasis is `text-zinc-400`, and one component uses one grey.
- [ ] **Adding a provider call → put it on `IGoLoginClient` first**, then implement it in `providers/`. Never call GoLogin from a route.
- [ ] **Never expect to embed Orbita.** It is a separate application window; the screencast alternative was built, tried and removed.
- [ ] **Never kill a session instead of stopping it.** `stop()` is what syncs the profile back; skipping it loses the session's work.
- [ ] **Never let a `stopping` session be interrupted quietly.** It is an upload of the operator's session state; the banner, the close guard and `SavingGuard` all exist for it, and anything new that can close or quit the window must respect it.
- [ ] **Never release the lock before the commit finishes.** A colleague would launch into a profile still uploading.
- [ ] **Never cache the launch token in the renderer, in `localStorage`, or on disk.**
- [ ] **Anything else subscribing to `gologin:session-changed` or `gologin:orbita-changed` must not call the matching `remove*Listeners`** — they are `removeAllListeners` on the channel, so two subscribers in one window tear out each other's handlers. Same trap as the OAuth callback channel.
- [ ] `electron/` changed → new build, released in **two pushes** (rule 14). Adding a *sub-route* under `/gologin` needs no build; adding a new prefix does.
- [ ] **The `gologin` dependency pulls a native module (`sqlite3`) into a signed, notarized app.** The first release carrying it is the one to verify hard — both mac arches, launch-tested — before arming `appUpdateConfig`.
