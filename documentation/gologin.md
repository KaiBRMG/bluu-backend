# GoLogin

> The browser-profile console. Runs in its **own Electron window** — the second satellite after OF Manager — and reads GoLogin's REST API through a single adapter. This iteration displays profiles and nothing else.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/gologin/types.ts` | Domain model + the `IGoLoginClient` contract. **Client-safe** — the only half a renderer may import |
| `src/lib/gologin/providers/gologinApi.ts` | **The only** file that knows GoLogin's URLs/payloads/auth |
| `src/lib/gologin/index.ts` | `getGoLoginClient()` factory (`server-only`; reads `GL_API_TOKEN`) |
| `src/lib/services/gologinService.ts` | Access gate + the memoised, bounded profile walk |
| `src/app/api/gologin/access/route.ts` | Permission probe for the Electron main process |
| `src/app/api/gologin/profiles/route.ts` | The listing (`?refresh=1` bypasses the memo, not the floor) |
| `src/app/api/gologin/launch-token/route.ts` | **Hands `GL_API_TOKEN` to the Electron main process.** Read its header before touching it |
| `electron/main.js` (GoLogin section) | Owns the SDK, the session map, and the quit-time stop |
| `src/hooks/useGoLoginSessions.ts` | Session state + launch/stop, driven from the profile row |
| `src/app/gologin/_lib/session.ts` | The status vocabulary and error copy the rows render |
| `src/hooks/useGoLoginProfiles.ts` | The window's one data hook |
| `src/app/gologin/**` | The window: layout, guard, profile list |
| `electron/main.js` (`SATELLITE_PREFIXES`) | The `/gologin` prefix + its access route |
| `src/components/Sidebar.tsx` (`SatelliteButton`) | Sidebar entry — opens the window instead of navigating |
| `src/lib/definitions.ts` | `apps-gologin` page (Apps teamspace, `href: null`) |

## Firestore

**None.** GoLogin holds the data; nothing is mirrored, and no rules or indexes changed. The only Firestore read in the whole feature is the page-permission check every route already makes.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `GL_API_TOKEN` | yes | GoLogin bearer token (Settings » API in the GoLogin dashboard) |

Without it every route answers **503 with a named cause**, deliberately — an empty list would read as "you have no profiles", which is a different fact.

---

## The rate limit is the whole design

GoLogin documents 300 requests/minute on free and trial plans, 1200 on paid, and states that **a 429 permanently revokes the API token**. It is not a throttle you back off from; it is the key being destroyed, and the fix is reissuing it in the dashboard and redeploying. Excessive concurrency separately risks a Cloudflare block, which answers HTML rather than JSON.

Everything about the listing follows from that:

- **The profile list is 30 per page** (the provider's own maximum), so "show me all of them" is inherently N requests. The walk is **strictly sequential** — never `Promise.all` over pages, which is exactly how a large workspace becomes a burst inside one minute.
- **Bounded at 40 pages / 1200 profiles** (`MAX_PAGES`). A provider that kept returning full pages would otherwise loop until the token died. Past the cap the response carries `truncated: true` and the header says "showing the first N of M" rather than quietly lying about the count.
- **Memoised for 60s in the service**, module-scope, with **in-flight de-duplication** — two operators opening the window at the same moment make one set of calls, not two.
- **`?refresh=1` bypasses the TTL but not a 15s floor.** A held-down refresh button is the realistic route to 429, since each press costs a request per 30 profiles. Inside the floor a refresh silently serves the memo.
- **Nothing polls.** The hook fetches once on mount; every other request is a click. There is no interval and no `onSnapshot` equivalent to add later without re-reading this section.
- **429 logs loudly** (`[gologin] 429 — the API token may have been revoked`) because the recovery is human, not automatic.

> Same standing rule as the OnlyFans provider (CLAUDE.md rule 9b), for a different reason: **do not `curl` `api.gologin.com` to explore a payload.** There the hazard is billing; here it is a request budget whose overrun is unrecoverable. Use [the API reference](https://gologin.com/docs/api-reference) or ask the user for a payload.

## The adapter seam

`providers/gologinApi.ts` is the only file that knows a GoLogin URL, header or field name; everything above it speaks `types.ts`. `GoLoginApiError` is the one error type callers see, so no route branches on an HTTP status.

Two normalisation decisions are load-bearing:

- **`normaliseProfile` is a security boundary, not a convenience.** The provider's profile object carries the full fingerprint, the **proxy's username and password in cleartext**, and a `facebookAccountData` block containing an account password. Only the display facts cross the seam — `readProxy` takes type, region and host and drops the credentials — so a renderer cannot receive them by someone forgetting to strip a field upstream.
- **`os` is probed, not assumed.** It is documented as an untyped object and ships as a plain string (`win` / `mac` / `lin` / `android`). Both are read, the same defensive posture `parseWebhookEvent` takes on the OnlyFans adapter, and for the same reason: the published spec is a starting guess on these providers, not a contract.

The response is also checked for a JSON content type before parsing — a Cloudflare block answers HTML with a 200, and without the check that surfaces to the operator as "Unexpected token <".

## Security

Three independent layers, exactly as OF Manager has:

1. **Electron main process** — the window is not created until main has sent the renderer's Firebase ID token to `/api/gologin/access` and got a 200. Hiding the sidebar item is a convenience; this is the gate a renderer cannot skip.
2. **Every API route** re-checks `requireGoLoginAccess(uid)` — the `apps-gologin` page permission, tier 2.
3. **`GoLoginGuard`** in the window refuses to render for a user without the page, covering a stale window whose access was revoked.

Plus: `src/lib/gologin/index.ts` is `server-only`, so importing the barrel from a client component is a build error rather than a leaked token. `types.ts` carries no imports and is the half the renderer uses.

## The window

`/gologin` is **not** inside `(main)`, and that is load-bearing for the same reason `/of-manager` is not: `(main)`'s layout mounts `TimeTrackingProvider`, and a second copy in a second window would run a second heartbeat, screenshot scheduler and clock-out flush against one session. The layout mounts only `AuthProvider` + `NetworkStatusProvider` + `UserDataProvider`.

It inherits every satellite property from `openSatelliteWindow` — co-equal with the main window (never `parent:`), resizable with a 900px minimum, one window per `key`, closed with the main window, and the shared `attachWindowBehaviour` (offline screen, crash auto-reload, unresponsive reporting).

**One pane, not two.** It reuses the satellite shell's *chrome* — the `fixed inset-0` ground (never `vw`/`vh`; see [onlyfans-crm.md § The window](onlyfans-crm.md#the-window)), the eyebrow section title, hairline rules, the overlay recipe — but not its two-pane layout, because there is no second pane to justify one. Rows carry **no hover fill**: nothing in them is clickable in this iteration, and a row that lights up under the cursor promises an action that does not exist.

**Folders are the surface's one grouping, and they appear twice.** A profile carries its folders as an open set of names, so they render as **filter chips beneath the search bar** (satellite-shell chips: `rounded-full`, the selected one filled Action Blue Deep with white ink, `aria-pressed`) and again as greyscale **attribute chips on the row** — a folder is a label the profile carries, not a state it is in, so the row's copy takes no hue. Two rules hold the filter row together:

- **The counts are faceted, or they are lies.** Each chip is counted over the *search* matches with the folder filter cleared, so the number beside it is what clicking it actually produces.
- **The selected folder is derived, never corrected.** A folder can vanish under the reader (the search narrows past it, a refresh drops it), and `activeFolder` resolves to `null` the moment its chip is gone rather than an effect writing state back — that write would be a cascading render, and `react-hooks/set-state-in-effect` fails the build over it.

**The list is a client-side lazy window: 30 rows, extended by an `IntersectionObserver` sentinel.** Every profile is already in memory (the provider list is fetched whole), so this is DOM cost, not network — a thousand rows laid out for a reader who will look at twenty. The next page therefore arrives in the same frame, which is why the sentinel is a bare `h-px` with no spinner and the count line carries the state instead ("Showing 30 of 61"). The window resets on any change to what is being listed, **adjusted during render against a `listKey`** rather than in an effect — same reason as above, plus an effect would paint one frame of the previous window's row count first.

Running / Idle is a closed two-value vocabulary, so it earns a hue — borrowed from `STATUS_COLORS`' triad (green = active, zinc = neutral) rather than invented, the same way `disputeStatus.ts` borrows for its derived states. `STATUS_COLORS` is keyed by `CRStatus` and has no member meaning this.

### Older installed builds

`SATELLITE_PREFIXES` lives in `main.js`, so a shell installed before v0.11.0 rejects `/gologin` with `invalid-path`. `SatelliteButton` treats that (and a missing IPC) as "this build predates the feature" and navigates to `/gologin` in the main window instead — the surface still works, it just takes over the main window (the route has its own layout, so there is no sidebar there either) until the fleet updates.

## Launching a profile

**The launched browser is not an Electron window, and cannot be made into one.** The GoLogin Node SDK (`gologin`, ESM-only) downloads and runs **Orbita** — a separate Chromium binary — on the operator's own machine, and returns a CDP `wsUrl`. Orbita owns its own OS window: `attachWindowBehaviour` never touches it, and it cannot be embedded, styled or positioned. GoLogin's Cloud Browser was weighed as the alternative and rejected on a hard constraint — **the plan allows 3 concurrent cloud sessions** and this has to serve a whole team at once. Every session here is local, so nothing competes for that quota.

**Launching is an action on the row, not a destination.** It briefly opened a console window whose entire content was a status line and a Stop button — a whole window for two facts, and the reason the flow felt clunky. Now the row carries it: `Launch` → a `Starting` spinner → `Open here` with `Stop`.

```
 /gologin (satellite)                       main.js                    Orbita
   row → Launch ────── gologin:launch ──────► SDK.start() ──────►  its own OS window
   row ◄──────── gologin:session-changed ─────────┘                (where the work happens)
```

- **Main owns the session, not the renderer.** The `gl` instance, the token and the status map live in `electron/main.js`; the window reads a snapshot on mount ([`useGoLoginSessions`](../src/hooks/useGoLoginSessions.ts)) and then follows `gologin:session-changed`, so a reopened window is never out of date.
- **Launch is idempotent.** A second launch on a profile that is starting or running adopts the existing session rather than spawning a second Orbita on the same profile — which GoLogin treats as a conflict.
- **"Open here" and "In use" are different facts.** A local session is one we can stop; `profile.isRunning` from the provider means it is open *somewhere*, possibly a colleague's desk, and launching over that is what GoLogin rejects. The row states them separately.
- **Stopping is not optional.** `stop()` syncs the profile back to GoLogin; closing Orbita's window by hand does not. That is why the app stops every running session on quit (`stopAllGoLoginSessions`, bounded at 8s so a quit is delayed, never hung).

> **A screencast viewer was built and removed.** The CDP `wsUrl` makes it possible to render the running browser on a `<canvas>` inside a Bluu window (`Page.startScreencast` out, `Input.dispatch*Event` back) — the same technique every cloud-browser UI uses, against local Orbita, so it dodged the plan's 3-session cloud limit. It was tried on 2026-09-04 and **did not work well enough to keep**: a screencast is a video of a browser, and the interaction never felt like one. Do not rebuild it without a specific reason to expect a different outcome; the working surface is Orbita's own window.

### The token has to reach the desktop, and that is the trade

Nothing on Vercel can launch a browser on someone's desk, so the local-SDK path requires `GL_API_TOKEN` on the machine. It is **not compiled into the app** — a bundled key is extractable from the asar by anyone holding an installer, forever. Instead `POST /api/gologin/launch-token` hands it over per launch, only to a caller with a valid Firebase ID token **and** the `apps-gologin` page permission, and main keeps it in memory for the life of the session: never on disk, never across the preload bridge.

**Residual risk, stated plainly:** a user who legitimately holds the page permission can recover the token from their own machine. That population is exactly the set already trusted to operate every profile in the workspace, so it grants them nothing new — but **rotate `GL_API_TOKEN` when one of them leaves**, the same as any shared credential. Revoking the page permission stops the next launch, since the check runs server-side on every call.

## Permissions

`apps-gologin` is an ordinary tier-2 page in the Apps teamspace with `href: null`. It has **no `page-permissions` doc until someone grants it** on `/admin-portal/sharing` (`updatePagePermissions` creates the doc on first write), and a page with no doc grants nobody — fail-closed. See [permissions.md](permissions.md).

## Scope of this iteration

Implemented: list every profile, search across name / notes / OS / proxy region / folders, faceted folder filter chips, a 30-row lazy window, refresh, and **launching a profile locally** from its row. Operators then work in Orbita's own window.

Deliberately **not** implemented: an in-app view of the running browser (built, tried, removed — see above), creating, editing, cloning or deleting profiles, folders as navigation, proxy configuration, fingerprint inspection, and scripted automation over the CDP endpoint. Cloud Browser is not used at all — the plan's 3-session limit is the reason. Every one of those is a provider **write**, a second product, or its own project.

## Gotchas

- [ ] **Never `Promise.all` the profile pages.** Sequential paging is the rate-limit design, not a style choice.
- [ ] **Never poll GoLogin.** A 429 revokes the token permanently — an interval is the one thing that reaches it while nobody is watching.
- [ ] **Never import `@/lib/gologin` from a client component.** It is `server-only` and reads `GL_API_TOKEN`; the renderer uses `@/lib/gologin/types`.
- [ ] **Never widen `normaliseProfile` without checking what the field carries.** Proxy credentials and a Facebook account password sit on the same object.
- [ ] **New GoLogin route → `requireGoLoginAccess(token.uid)` before anything else.**
- [ ] **Adding a provider call → put it on `IGoLoginClient` first**, then implement it in `providers/`. Never call GoLogin from a route.
- [ ] **Never expect to embed Orbita.** It is a separate application window, and the screencast alternative was built, tried and removed (see above).
- [ ] **Anything that attaches to the CDP endpoint** must not override the profile's viewport or device metrics (fingerprint surface on an anti-detect profile), must keep input semantic rather than letting a renderer name CDP methods (that socket reads cookies and runs script on a logged-in profile), and must `disconnect()` rather than `close()`, which would shut the operator's browser.
- [ ] **Never kill a session instead of stopping it.** `stop()` is what syncs the profile back to GoLogin; skipping it loses the session's work.
- [ ] **Never cache the launch token in the renderer, in `localStorage`, or on disk.** It lives in main's memory for one session, fetched per launch so a revoked permission takes effect immediately.
- [ ] **Anything else subscribing to `gologin:session-changed` must not call `removeSessionChangedListeners`** — it is `removeAllListeners` on that channel, so two subscribers tear out each other's handlers. Same trap as the OAuth callback channel.
- [ ] `electron/` changed → new build, released in **two pushes** (rule 14 in [CLAUDE.md](../CLAUDE.md)). Adding a *sub-route* under `/gologin` needs no build; adding a new prefix does.
- [ ] **The `gologin` dependency pulls a native module (`sqlite3`) into a signed, notarized app.** The first release carrying it is the one to verify hard — both mac arches, launch-tested — before arming `appUpdateConfig`.
