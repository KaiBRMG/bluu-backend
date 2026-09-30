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
| `src/app/api/gologin/admin/members/route.ts` | Members: grant/revoke seats, reconcile a pre-existing workspace (`members` capability) |
| `src/lib/services/gologinManageService.ts` | Profile create/edit/delete/restore, folder create/delete/fill, live folder sharing + profile sharing — all on the master token |
| `src/lib/gologin/proxyCheck.ts` | "Ping proxy": the SDK's own `geo.myip.link` check, server-side, behind an SSRF fence |
| `src/app/api/gologin/manage/profiles/**` | Create (`POST`), read/edit/delete (`[id]`), Undo (`[id]/restore`) — `profiles` capability |
| `src/app/api/gologin/manage/proxy-check/route.ts` | Ping proxy — `profiles` capability, throttled per user |
| `src/app/api/gologin/manage/folders/route.ts` | List (any capability) / create / fill / delete folders — `folders` capability |
| `src/app/api/gologin/manage/sharing/route.ts` | The Sharing dialog's read and writes — `sharing` capability |
| `src/app/api/gologin/pins/route.ts` | Pin / unpin (everyone with the page) |
| `src/app/gologin/_lib/manage.ts` | `useGoLoginCapabilities()` + the shared form/checkbox/button recipes |
| `src/app/gologin/_components/{NewProfileDialog,EditProfileSheet,ProxyFields,FolderChecklist,AddToFolderDialog,EditFoldersDialog,SharingDialog,MembersDialog}.tsx` | The management surfaces — see § Management |
| `electron/main.js` (GoLogin section) | The SDK, the session map, Orbita downloads, the lock lease |
| `src/hooks/useGoLoginAccount.ts` | Seat + token state for the current operator |
| `src/hooks/useGoLoginProfiles.ts` | The window's one profile fetch |
| `src/hooks/useGoLoginSessions.ts` | Local session state + launch/stop |
| `src/hooks/useGoLoginLocks.ts` | Live "who has this open", over `onSnapshot` |
| `src/hooks/useOrbita.ts` | Orbita install state + download progress |
| `src/app/gologin/_components/MembersPanel.tsx` | The seat list inside `MembersDialog` |
| `src/app/gologin/_components/Notice.tsx` | The window's one full-screen message — no seat, no access, rejected token |
| `src/app/gologin/_lib/session.ts` | Session labels, the error vocabulary (incl. `invalid-token`) and `TONE_CHIP` |
| `src/hooks/useAuthFetch.ts` | `ApiError` — carries the route's `code` through the throw |
| `src/app/gologin/**` | The window: layout, guard, onboarding, list, Management, Orbita gate |
| `src/lib/definitions.ts` | `apps-gologin` page (Apps teamspace, `href: null`) + its four capability sub-items (`apps-gologin-members` / `-profiles` / `-folders` / `-sharing`) |

## Firestore

Two collections, **both new**, both with rules and index exemptions in place.

| Collection | Who reads | Why |
|---|---|---|
| `gologin-accounts/{uid}` | Admin SDK only | The seat binding (uid to GoLogin address + folder id) and the encrypted API token |
| `gologin-sessions/{profileId}` | **Client-readable**, Admin-written | The live session lock. Readable so a row can say "In use · Kai" without polling the provider |

Plus three non-secret fields mirrored onto `users/{uid}`: `gologinEmail`, `gologinMemberSince` and `gologinLinkedAt`. They exist so the window can decide "onboarding or profiles?" off the `useUserData` snapshot it already holds, at zero extra reads. A fourth, `gologinPinnedProfileIds`, holds that person's pins (§ Pinned) for the same reason; it is index-exempt in `firestore.indexes.json`.

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
2. **Every API route** re-checks `requireGoLoginAccess(uid)` — the `apps-gologin` page permission, tier 2. Every management route additionally requires **one capability** via `requireGoLoginAccessAnd(token, cap)`: holding the page lets you *use* profiles, not create, delete or hand them out. The force-release on the session lock is the one control still gated on `requireGoLoginAdmin` outright.
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

**Rows are ordered live-first**, then by the provider's order: the operator's own running sessions, then locked-by-someone-else, then GoLogin's `isRunning`, then the rest. Their own live sessions are the rows they come back to, and alphabetical order scatters three of them through hundreds.

**That order is a snapshot, taken when the listing changes** — search, chip, Refresh — and **never re-taken because of the reader's own click** (`rankSnap`, adjusted during render against `listKey`). It used to re-rank on every session change, so pressing Launch on row 12 moved it to the top the same instant and a quick second click landed on a different row's Launch: a different live account (critique 2026-09-30, P1). A launched row now keeps its place and gains its *Open here* chip; it rises on the next refresh. A profile not in the snapshot (one just created) sorts first.

**Launch is optimistic.** `useGoLoginSessions.launch` sets `starting` on the click, before main's first broadcast, so the button cannot take a second press; a failure before main answers sets `failed` with its reason. Failure toasts **name the profile** (several launches can be in flight), and a failed row's *Retry* carries the reason on its title, because the toast that said why has gone.

**Row folder chips are capped at two** plus a `+N` count (named on hover): the lane grows with every folder and the profile name beside it is what truncates. The six-character **profile id is shown to managers only** — it is for reconciling against GoLogin's own app, which an operator who only launches never does.

**Launching a profile GoLogin reports as running outside Bluu asks first** (`requestLaunch`). Bluu's lock blocks a colleague launching *through Bluu*; it cannot see someone running the profile in GoLogin's own app, and `profile.isRunning` is the only signal of that. It is only as fresh as the listing, so it asks rather than refuses — naming the reported user and the listing's age — but opening it again puts one account on two devices and two IPs.

**The window renders once, when it is ready.** `ConnectingScreen` ("Connecting to GoLogin…") covers every wait before there is something real to show — the session and user-doc check in `GoLoginGuard`, the seat check, and the first profile walk — replacing three skeletons that flashed in turn. It carries the GoLogin mark (the brand-asset escape hatch, as in `PageIcon`'s `SVG_ICONS`) because the wait is an outside service answering, a stage line saying what is being waited on, and after 6s the reason a big workspace is slow (30 profiles per request, walked sequentially). A Refresh does **not** use it: the list stays on screen and the button spins.

**The keyboard model is DOM focus, never a React cursor.** `/` focuses search, `j`/`k` walk `button[data-row-action]` (each row's own primary control, disabled ones skipped), and `Enter` is the browser's own activation of whatever is focused — there is no handler for it. A parallel selection state would have to be kept in step with a list that reorders as sessions start, would re-render the window on every keystroke, and would be invisible to a screen reader. It also keeps a keystroke from firing a billed provider call by itself: the operator still presses Enter on a button they can see is focused. The listener is bound to the page element, **not** `window`, so the Orbita gate and the close guard — which render as siblings outside that subtree — keep the keyboard to themselves.

**The folder chip row is capped at eight**, with a "+N more" toggle. It grows with the workspace and the viewport does not; uncapped, a twenty-folder workspace pushed every profile row below the fold. The selected chip is always kept in the visible set — a filter you cannot see is a filter you cannot clear.

**A rejected token gets its own screen, not an error line.** `goLoginErrorResponse` codes a 401 (token rejected) or 429 (rate limit, which *revokes* the token) as `invalid-token`; `useAuthFetch` carries the code through on an `ApiError`, and the window renders a full `Notice` with a **Replace my token** action that calls `unlink()` and drops back into onboarding step 3. Before this, the failure the entire subsystem is architected against surfaced as GoLogin's own untranslated message beside a **Retry** button — the one action that cannot possibly work — and `unlink` existed in the hook with no caller, so there was no route back to the paste field at all.

**A row distinguishes three kinds of "running", on purpose:** `session` (open on this machine — we can stop it), `lock` (Bluu's lock, live across every machine — the row is blocked and the *server* will refuse the launch), and `profile.isRunning` (GoLogin's own flag, only as fresh as the last fetch, kept as a weaker last resort because it also catches someone running the profile outside Bluu). The blocked button is **disabled, not hidden** — a missing button reads as "this row has no action", when the fact is "not right now, and here is who has it". The status dot follows the same three-way split: green means *yours*, blue means *live but not yours*, zinc means idle. It used to paint green on all three, which contradicted the chips beside it on the one question the dot is asked.

**A blocked row carries an admin force-release.** The route and `forceReleaseProfileLock` have existed since the lock did and nothing ever called them, so the only way to free a wedged claim was the Firestore console. The three-minute stale window covers a machine losing power; it does **not** cover a holder whose app is hung, which heartbeats never stop for and teardown never runs for. It is confirmed with an `AlertDialog` that names the holder and states the cost — clearing the lock does not close their browser, so if theirs is still open their session will not be saved back and two people can end up signed into one account. ⚠ The route gates on **`requireGoLoginAdmin`, not a bare `token.admin`**, for the same reason the Management routes do: claims do not reach an already-issued ID token, this renderer runs for weeks (rule 9c), and the button renders off the live `userData.groups` snapshot — a bare claim check would show an admin a control that answers "Admins only".

### Management: four capabilities, five surfaces (reworked 2026-09-30)

Until 2026-09-30 there was one **Management** dialog behind one grant (`apps-gologin-management`) with two tabs, Members and Profile access. It bundled paying for seats with handing out accounts, and it could not create, edit or delete a profile at all. It is now **four capabilities**, each a sub-item of `apps-gologin` on `/admin-portal/sharing`, and each unlocks its own controls in the window:

| Capability (Sharing page label) | Page id | Unlocks |
|---|---|---|
| **Add & Remove Members** | `apps-gologin-members` | Header **Members** → `MembersDialog` (the old Members tab, alone) |
| **Create, Edit & Delete Profiles** | `apps-gologin-profiles` | Header **New profile**; row menu **Edit profile** and **Delete profile**; Ping proxy |
| **Create, Edit & Delete Folders** | `apps-gologin-folders` | **Edit folders** beside the folder chips; row menu **Add to folder**; the folder list in Edit profile |
| **Share Profiles & Folders** | `apps-gologin-sharing` | Header **Sharing**; row menu **Share profile** |

**Pin / Unpin is on every row's menu for everyone** — it is not a capability; it changes only the reader's own view.

The existing grants were **not migrated** (decided 2026-09-30: "start from zero"). `apps-gologin-management` was removed from `definitions.ts`; its orphaned `page-permissions` doc and `permittedPageIds` entries are cleaned with `src/scripts/remove-retired-pages.js` (see permissions.md — until then `repair-permissions.js` hard-aborts on the stranded doc).

- Server: `requireGoLoginAccessAnd(token, capability)` — the page gate, then `requireGoLoginCapability`. It takes one capability or an array of which **any** suffices (the folder list is read by three dialogs).
- Client: `useGoLoginCapabilities()` in `src/app/gologin/_lib/manage.ts`, off the live `users/{uid}` snapshot. The ids live once, as `GOLOGIN_CAPABILITIES` in the client-safe `types.ts`, and `definitions.ts` declares the same four.
- **Admins hold all four unconditionally, and that is not a convenience.** They run the workspace on the master token (`usesMasterGoLoginToken`), so revoking a Sharing row from them would lock the only people who can administer it out of it. The rows are for delegating *to* non-admins.
- Sub-items have **no href** — the sidebar skips them. They only change what renders inside the GoLogin window.

⚠ **No half of this is a bare `token.admin` check, and that is load-bearing.** `setCustomUserClaims` does not reach an ID token that has already been issued, and this renderer routinely runs for weeks without a reload (rule 9c). The buttons render off the live `users/{uid}` snapshot (`groups`, `permittedPageIds`), so a raw claim check drifts one way and visibly: the button appears and every route behind it refuses — reported on 2026-09-11 with the claim correctly set server-side the whole time. The claim is the fast path, the `admin` group (via the 60s-cached `getUserById`) the fallback, then the page grant.

**Everything management does speaks as the master token, server-side** (`gologinManageService.ts`). A non-admin holding a capability administers the workspace; they never *become* it — `GL_API_TOKEN` still never reaches their desktop.

#### Members

The old Members tab, unchanged in behaviour, now its own dialog. It grants and revokes seats, shows the seat budget, and carries **Reconcile**. Each row says which of four things is true — `Active`, `No token yet`, `Invite pending`, `Seat removed in GoLogin` — because each has a different remedy. The GoLogin address defaults to `workEmail` but stays editable.

**Removing a member is what "cannot access profiles from GoLogin directly" means.** `DELETE /workspaces/{wid}/members/{id}` ends the seat, so GoLogin itself stops them opening any profile, in its own app too. And because `/api/gologin/access` — the door Electron checks before creating the window — requires a seat, the window stops opening for them too. Removal is confirmed; the copy says that individually shared profiles are remembered (their personal folder survives) but **folder shares are not** (they lived in the seat's scope, which is gone).

⚠ **One gap the API cannot close.** The very first design (before seats) shared folders to people's free accounts with `POST /share/multi`. GoLogin has **no per-recipient unshare** — `DELETE /share/folder/{id}` takes no recipient — so any such legacy share survives a seat removal. If one exists it shows in the profile's `sharedEmails` (master token only); removing it means GoLogin's own app.

#### New profile

A large dialog: **name, OS, proxy, folders**. Nothing else is configurable, deliberately.

- **Create is `POST /browser/quick`** — GoLogin's own "profile on the default settings" — with `os` + `osSpec`. GoLogin generates the whole fingerprint (user agent, resolution, WebGL, fonts, canvas, CPU/RAM) consistently for that OS, from the workspace's default-settings template. A fingerprint assembled field by field is how an inconsistent one happens, and an inconsistent fingerprint is what gets an account flagged. The response's `id` is read the way GoLogin's own quickstart reads it (`profile.id`); `_id` is probed as well.
- **The four OS choices** (`GOLOGIN_OS_CHOICES`) are the pairs the SDK itself sends from `getOsAdvanced()`: Windows 10 = `win`/`''`, Windows 11 = `win`/`win11`, Mac M1 = `mac`/`M1`, Mac Intel = `mac`/`''`.
- **Then the proxy, via `PATCH /browser/proxy/many/v2`** — and "Without proxy" is written explicitly as `mode: 'none'`, because a workspace's default template can itself carry a proxy.
- **If attaching the proxy fails, the new profile is deleted.** A profile without the proxy it was made for launches on whatever IP the desk has; better no profile than that trap in the list. If even the cleanup fails, the error names the profile and says to delete it before anyone launches it.
- **Then folders**, one `PATCH /folders/folder` each. A failure here is a warning on the toast, not a rollback — the profile is sound.
- **A non-admin creator gets the new profile shared to their own folder**, or they could not see what they just made.
- **Create stays disabled until Ping has passed for the proxy fields as they now stand.** Edit one character and the check is void.

#### Ping proxy

**GoLogin has no endpoint for this.** It is the SDK's own pre-launch check (`getTimeZone` in `gologin.js`): `GET https://geo.myip.link` *through* the proxy, reporting exit IP, country, city and timezone — the fact a manager needs, because a proxy in the wrong country launches fine and gets the account flagged. Implemented in `src/lib/gologin/proxyCheck.ts`, run **server-side** (decided 2026-09-30: no Electron build). The cost: a proxy that only admits whitelisted IPs fails here and may still work from a desk — the timeout message says so.

⚠ **It is an outbound connection to an address a user typed, so it is fenced as an SSRF primitive.** The host is resolved first and **every** record must be public (loopback, RFC 1918, link-local incl. `169.254.169.254`, CGNAT, multicast and IPv6 equivalents are refused, via `net.BlockList`); the agent then connects to the **resolved IP**, never the name, so a second resolution cannot rebind it; the destination URL is fixed; the body is capped; the route is capability-gated and throttled per user. Do not loosen any of these.

A refused CONNECT arrives as the response status (https-proxy-agent replays the proxy's reply rather than throwing), so `407` becomes "rejected the username or password". The IP field also accepts a pasted `host:port:user:pass` line and fills all four.

#### Edit profile

A side sheet with **every fact about the profile**, of which **name, notes, proxy and folders are editable** and the fingerprint is shown read-only with a lock and a one-line reason. The line between the two is GoLogin's own ("What's safe to change"): OS, user agent, resolution, fonts, canvas, WebGL and CPU/RAM must never change after an account has logged in.

⛔ **`PUT /browser/{id}/custom` is never used.** GoLogin documents that it **re-randomises every parameter the body omits** — renaming a profile through it would silently re-roll a logged-in account's fingerprint. It is deliberately absent from `IGoLoginClient`. Instead each field has its own path:

| Field | Endpoint |
|---|---|
| Name | `PATCH /browser/name/many` |
| Proxy | `PATCH /browser/proxy/many/v2` |
| Folders | `PATCH /folders/folder` add/remove, diffed against the tree |
| Notes | **GoLogin's own SDK `update()`**: `GET /browser/{id}`, change `notes`, `PUT /browser/{id}` with the whole document. Every other field goes back exactly as it came. ⚠ `PUT /browser/{id}` is not in the OpenAPI spec — the official SDK uses it. Accepted 2026-09-30. |

**Notes are written first**, because that PUT sends the whole document and would otherwise put the old name and proxy back over new ones.

- The **proxy password never reaches the renderer.** The projection (`GoLoginProfileDetail`) carries `hasPassword`; the form shows "Unchanged"; `password: undefined` means "keep it", and the adapter reads the stored one back itself. Ping on an edit sends `profileId` so the server can fill the kept password in.
- **A changed proxy must pass Ping** before Save enables.
- **The current exit is pinged when the sheet opens** ("Currently exits in Miami, United States · 1.2.3.4"; the stored password is filled in server-side, so this costs one `GET /browser/{id}`). The new ping is then **compared** with it: a different **country** shows the move in an orange box and blocks Save until *"Change the country anyway"* is ticked (the acknowledgement is keyed to the proxy fields, so editing them voids it); a different city is a softer note; an unknown current location says it cannot be compared. The old generic "keep the same country" warning had nothing to compare against.
- **Removing the proxy asks first** — "Without proxy" on a profile that had one puts a signed-in account on whichever desk opens it next.
- A proxy mode the form cannot express (SOCKS4, Tor, GoLogin's own) is shown read-only with a **Replace proxy** action rather than being misread as HTTP.
- **Save exists only while something differs**, and sends only changed keys. **Discard** restores from memory — no request. Closing the sheet (Esc, outside click, ✕) with unsaved edits asks *"Discard your changes?"* first — it used to drop them silently, including a proxy that had just passed Ping.
- **A profile anyone has open cannot be edited or deleted** — `getLiveLockHolder` on the server, the live lock snapshot on the client. A proxy change would not reach the running session, and the notes PUT replays the whole document under it.
- Changing folders from the sheet needs the **folders** capability as well.

#### Delete profile

Confirmed by `AlertDialog`, refused while in use, and the toast carries a real **Undo**: GoLogin keeps deleted profiles restorable (`POST /deleted-profiles/restore`), so Undo restores the actual profile — id, fingerprint, cookies — and the row is re-inserted from memory.

#### Folder edits are access grants — every picker says so

Because a shared folder is live, **adding a profile to a folder hands it to everyone that folder is shared with**. That makes every folder picker a sharing control, so every one of them states it (critique 2026-09-30, P1):

- The folder read endpoints (`GET /manage/folders`, and the folder list returned with `GET /manage/profiles/{id}`) carry **`sharedWith`** — the display names of the members whose seat is scoped to each folder (`loadUserFoldersWithShares`: the memoised workspace read, one `gologin-accounts` read, one batched `getAll` of names — never a read per member). Write paths use the lighter `loadUserFolders`, which omits it.
- `FolderChecklist` (New profile, Edit profile, Add to folder) shows a people count on each folder, names on hover, and — for any **newly** ticked folder, measured against the `initial` set it is given — an attention-orange line naming who gains the profile: *"Kai, Sam and 2 others will be able to open this profile."*
- It also names who **loses** it when a shared folder is unticked — measured against the folders still ticked, so someone who still reaches the profile another way is not listed (a direct share survives either way; the copy says "through these folders").
- Edit folders states who the selected folder is shared with in the pane header, before the first "Add", and the delete confirm names who loses access. **A toggle on a shared folder toasts who gained or lost the profile, with an Undo** — the same safety the Sharing dialog gives the same act. Toggles on an unshared folder stay silent: it is only a label, and a toast per click there would train people to ignore the ones that matter.

#### Add to folder

A small dialog off the row menu: the user-facing folders as a checklist, **pre-ticked with the profile's current folders**, so it adds and removes. One `PUT /manage/folders` with the desired set; the server diffs it against one fresh read (`setProfileFolders` — the same diff Edit profile uses) and answers with the folders the profile ended up in. Needs only the folders capability.

#### Edit folders

Two panes: folders on the left (create inline, delete with confirm), the selected folder's profiles on the right (toggle in/out, optimistic, rolled back by re-reading). **Members-first order is fixed when the folder or search changes, never by a toggle** — re-sorting per click moved the row just clicked out from under the cursor.

- **There is no rename, and the dialog says so.** GoLogin has no rename endpoint; an emulated one (create, move, re-scope members, delete) is four non-atomic calls that can leave two folders behind. Decided 2026-09-30 to leave renaming to GoLogin's own app.
- **Names are unique case-insensitively across every folder**, hidden ones included — folders are addressed by name.
- **Bluu's `Bluu · …` prefix is refused** on create: such a folder would be hidden everywhere on arrival.
- **Deleting a folder re-scopes every member who had it first**, then deletes it. Profiles inside are kept. GoLogin's behaviour for a seat scoped to a deleted folder is undocumented; this order means we never find out.
- User-facing folders exclude Bluu's per-person folders **by id** (the accounts collection) as well as by prefix, so a renamed plumbing folder cannot come back as something to edit.

#### Sharing

Replaced the Profile access tab. **People first:** pick one or more members on the left; every folder and profile on the right shows its coverage across them — `Shared` (all), `2 of 3`, `Not shared` — and one click evens it out (shares with all selected, or, if all already hold it, takes it back from all).

**Two kinds of access:**

- **A shared folder is live** (decided 2026-09-30). It re-scopes each member's seat (`PATCH /workspaces/{wid}/members/{id}` with the folder added to `folders`), so profiles added to the folder later reach them with nothing further to do. This replaced the old copy-at-that-moment model. The write replaces the member's whole scope, so the member list is read **fresh** first, and their **personal folder is always kept in it** — dropping it would silently revoke every individually shared profile.
- **A shared profile is a single grant** into the member's personal folder (`changeAssignment`, unchanged).

A profile someone reaches **through a folder** is marked `via REPOST`: unsharing it individually does not remove that access, and a row claiming otherwise would be the most dangerous lie on the surface. Folder shares are confirmed with the count; single-profile toggles are one click. Results come back per member (`{ done, failed[] }`) — one seat that has gone must not stop the rest, nor be reported as a success. Success is applied locally from that report; nothing re-walks.

- **Every change toasts with an Undo** that sends the inverse to exactly the people it landed on (the Undo itself is not undoable). A mis-click hands out or takes back a live account; noticing and clicking again was the only remedy before.
- **Every control names its verb** — `aria-label="Share Cole with Kai, Sam — 2 of 3"`, and the verb appears beside the coverage pill on hover and focus. `aria-pressed` on a `2 of 3` row could not say that a click shares with all three.
- **With nobody selected the right pane says so** rather than dimming itself; an `opacity-50` pane read as broken, pushed its grey under the contrast floor, and disabled nothing a screen reader could tell.

**Profile first, from a row.** A row's *Share profile* answers a different question — "who can open **this**?" — which the people-first grid cannot answer without selecting everyone. So it opens `focusProfile` (addressed by **id**; a name search would also match "Cole · TikTok"): every member listed as *Shared directly* / *Can open it via REPOST* / *No access*, with one Share / Stop sharing button each. A link at the foot switches to the people-first view. Busy state is tracked per item *and* person, so one row's spinner does not spin them all.

Admins are not listed: they see everything on the master token.

#### Pinned (everyone)

Bluu's own folder, **per person** (decided 2026-09-30), stored on `users/{uid}.gologinPinnedProfileIds` (written by `POST /api/gologin/pins`, capped at 200, index-exempt). It rides the user-doc snapshot the window already holds, so reading it is free. GoLogin's own `isPinned` is deliberately not used — it is one flag shared by everyone.

- **Pinned is the default chip on startup when it has anything in it** — derived (`folder === undefined` resolves to Pinned while `pinnedTotal > 0`), never set in an effect.
- Only pins matching a visible profile count, so the chip never promises rows it cannot produce.
- **A search that misses inside Pinned leads out of it**, keeping the text: *"No pinned profile matches "cole". Show 3 in All."* With Pinned as the default, looking up an unpinned profile is the everyday case; it used to dead-end on a "Clear them" that also erased the search. The other empty state clears only the search.
- **Without a management capability, the row's ⋯ menu is a pin toggle** (filled when pinned, `aria-pressed`). A menu that opens onto one item is two clicks for one action on the surface operators use most. The name-side pin mark is shown only where the menu hides the state.
- `useGoLoginPins` mirrors `usePinnedGrowthAccounts`: the snapshot array is content-compared (presence rewrites the user doc every few minutes), the optimistic value is tagged with the snapshot it was made against so it clears itself, and `togglePin` is stable. No success toast (the high-frequency exception, DESIGN.md §5).

#### The list does not re-walk after a write

Create, edit and delete update the list **in place** from the write's own response (`useGoLoginProfiles`' `upsert` / `patch` / `remove`) and the server drops its memos, so the next Refresh is exact. Re-reading after every write would cost one provider request per 30 profiles each time — the burst the rate-limit design exists to prevent. Edit folders and Members call one Refresh on close, only if something changed; Sharing only if the **caller's own** access changed (sharing with colleagues changes nothing in the caller's list). Server-side, a membership write patches the `GET /user` memo in place (`applyFolderMembership`) instead of dropping it, so toggling ten profiles, or sharing one with ten people, does not cost ten extra `GET /user`s; only structural writes (folder or profile created/deleted) invalidate it.

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

The four capabilities (`apps-gologin-members`, `-profiles`, `-folders`, `-sharing`) are **sub-items** of it (`parentPageId: 'apps-gologin'`): same tier-2 machinery, same fail-closed default, but no href and no sidebar row — see [permissions.md](permissions.md#sub-item-pages-a-capability-inside-a-page) and § Management above. Granting one without `apps-gologin` does nothing: the routes check both, and without the parent the window never opens.

**Three things a capability deliberately does *not* carry with it**, because they are admin authority rather than workspace administration:
- **The master token.** `usesMasterGoLoginToken` still reads the `admin` group alone, so a non-admin manager launches with their **own** key and sees their **own** folder. `GL_API_TOKEN` never reaches their desktop. They administer the workspace server-side; they do not become the workspace. (This is why a non-admin who creates a profile has it shared to their own folder — otherwise they could not see it.)
- **Force-release** on a wedged session lock — still `requireGoLoginAdmin`, and still rendered off `groups.includes('admin')`.
- **The seat exemptions.** A non-admin manager is an ordinary operator to every other part of the model: they appear as a seat candidate, reconciliation matches them, and sharing works on them normally.

## Scope

Implemented: per-user account linking with folder provisioning, Orbita install with progress (including mid-launch updates), profile listing with search / faceted folder chips / per-person Pinned / lazy window / refresh, local launching, a cross-machine session lock, and — since 2026-09-30 — creating (quick-create + proxy + folders, with Ping proxy), editing (name, notes, proxy, folders; fingerprint read-only), deleting with Undo, folder create/delete/fill, and live folder + single-profile sharing, behind four grantable capabilities.

Deliberately **not** implemented: an in-app view of the running browser (built, tried, removed), **editing the fingerprint** (GoLogin: never after login), **renaming folders** (no API endpoint), cloning profiles, proxy types beyond HTTP/SOCKS5, GoLogin's own proxy pool, scripted automation over CDP, and Cloud Browser.

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
- [ ] **New GoLogin route → `requireGoLoginAccess(token.uid)` first**, and **`requireGoLoginAccessAnd(token, capability)`** — not a bare `token.admin` — if it changes what exists or who can see what. A raw claim check drifts from the live `users/{uid}` snapshot the buttons render off, and this renderer runs for weeks (rule 9c). Reserve `requireGoLoginAdmin` for authority that must not be delegatable (force-release is the only one).
- [ ] **Never call `PUT /browser/{id}/custom`.** It re-randomises every parameter the body omits — an "edit the name" through it re-rolls a logged-in account's fingerprint. It is deliberately absent from `IGoLoginClient`; add a field-scoped method instead.
- [ ] **Never offer a fingerprint field as editable** (OS, user agent, resolution, fonts, canvas, WebGL, CPU/RAM). GoLogin: never change after login.
- [ ] **Never leave a created profile without its proxy.** `createProfile` deletes it if the proxy step fails; keep that rollback.
- [ ] **Never send the proxy password to a renderer.** `hasPassword` only; "keep" is `password: undefined`, resolved inside the adapter.
- [ ] **Never loosen `proxyCheck.ts`'s fence** — resolve first, every record public, connect to the resolved IP, fixed destination.
- [ ] **A member's folder scope is written whole.** Read the workspace fresh before `updateWorkspaceMember`, and always keep their personal folder in the list.
- [ ] **Never re-walk the profile list after a write** — update it in place from the response (`upsert` / `patch` / `remove`).
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
