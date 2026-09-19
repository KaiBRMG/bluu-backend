# Snipping Tool

> Region screen capture from a global shortcut or a menu-bar/tray item, uploaded to Cloud Storage and shared with a public link. The only feature in the app whose primary entry point is **outside the app**.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `electron/main.js` (§ Snipping Tool) | Global shortcut, tray item, transparent selection surfaces, the post-selection capture + crop |
| `electron/snip.html` | The selection surface — fully transparent; drag, readout, Escape. Draws nothing but the rectangle |
| `electron/snip-preload.js` | The surface's bridge. Two channels (`commit`/`cancel`), and deliberately **no image channel** |
| `electron/preload.js` (`snip`, `clipboard.writeText`) | The main window's bridge |
| `src/components/snips/SnipController.tsx` | Arms the shell, uploads a capture, copies the link. Mounted on `(main)/layout.tsx` |
| `src/lib/snips.ts` | Shared constants: retention, accelerators, share-token validation, `SNIPPING_TOOL_PAGE_ID` |
| `src/lib/snipUpload.ts` | The three-leg upload (sign → PUT → finalise) |
| `src/lib/services/snipService.ts` | Everything server-side: tokens, slots, projections, retention, the sweep |
| `src/app/(main)/applications/snipping-tool/` | The library page + settings popover + shortcut recorder |
| `src/app/s/[shareId]/` | The **public** page |
| `src/app/api/snips/*` | Owner-facing routes (page permission + `ownerUid`) |
| `src/app/api/public/snip/[shareId]/image` | Unauthenticated 302 to a signed Storage URL |
| `src/app/api/cron/snip-cleanup` | Daily retention sweep (`src/vercel.json`) |

## Firestore

- `snips/{shareId}` — **the document id IS the public share token.** Admin-SDK only (`firestore.rules` §24b).
- `users/{uid}.snipSettings` — `{ trayIconEnabled, shortcutEnabled, shortcut, retention }`.

## Storage

- `snips/{shareId}.png` — written by a v4 signed URL from the renderer, read by a v4 signed URL through the image route. Storage rules are never consulted on either leg; **this route is the authorisation.**

**The object path carries no uid, deliberately.** It used to be `snips/{uid}/{shareId}.png`, and that leaked: a signed URL is a place a path becomes *visible* — an address bar, a referrer, a pasted link — so the owner's Firebase uid travelled with every image. `shareId` is already 160 bits of globally unique token, so the per-user folder bought nothing but that exposure. Ownership is enforced on the Firestore document (`ownerUid`), which is the only place it was ever checked.

Snips created before this change still carry the old path. Nothing needs migrating: **every read and delete resolves `storagePath` from the document** rather than rebuilding it from a uid, so both layouts work. The one place that did rebuild it was the account-deletion cascade's `bucket.deleteFiles({ prefix: 'snips/{uid}/' })`, which now calls `deleteAllSnipsForUser` instead — per-document, and correct for both layouts.

### The bucket needs a CORS policy, and without one nothing uploads

**This is a one-time infrastructure prerequisite, not a code setting**, and it is the first thing to check when an upload fails.

A signed `PUT` is a cross-origin request to `storage.googleapis.com`. `PUT` is never a "simple" CORS request, so the browser sends a **preflight `OPTIONS`** first — every single time, no matter what headers are on it. A bucket with no CORS policy has nothing to answer that preflight with, so the browser rejects the request before it leaves: `fetch` throws a bare `TypeError: Failed to fetch`, with no status and no body.

The policy lives in [`storage-cors.json`](../storage-cors.json) at the repo root — infrastructure, not application code, which is why it sits beside `firestore.rules` rather than under `src/`.

Apply it with [`src/scripts/set-storage-cors.js`](../src/scripts/set-storage-cors.js):

```bash
cd src && node scripts/set-storage-cors.js --info    # show current policy, write nothing
cd src && node scripts/set-storage-cors.js           # apply storage-cors.json
```

**Use the script, not `gcloud`.** Nothing in this team's toolchain installs the Cloud SDK — `gcloud` and `gsutil` are both absent on a normal dev machine here — so the CLI runbook is one nobody can follow. The script makes the same API call (`setCorsConfiguration`) with the Admin SDK service account the repo already carries, and reads the policy back afterwards rather than trusting the write: a policy that did not land looks exactly like one that did.

The equivalent CLI, for anyone who does have the SDK:

```bash
gcloud storage buckets update gs://bluu-backend.firebasestorage.app \
  --cors-file=storage-cors.json
```

**Applied to `gs://bluu-backend.firebasestorage.app` on 2026-09-19.** Before that the bucket had **no CORS policy at all**, so every signed-URL upload from a browser had always failed — snips were simply the first feature to exercise the path.

Three origins are allowed: `bluu-backend.vercel.app` (what the Electron shell is pinned to), `app.bluurock.com` (the public domain) and `localhost:3000` (dev). **Adding a domain to the app means adding it here too**, or uploads work everywhere except the new one.

`uploadSnip` translates that specific `TypeError` into a message naming CORS rather than passing "Failed to fetch" through, because it is a bucket misconfiguration that no retry will fix and the generic wording sends people looking at their network.

**The OnlyFans media upload ([`/api/onlyfans/media/upload-url`](../src/app/api/onlyfans/media/upload-url/route.ts)) depends on the same policy** — it is the same bucket, the same signed-`PUT` shape and the same preflight. It has no CORS documentation of its own, so if snips were the first thing to exercise this path, that upload was broken in exactly the same way and this fixes both.

---

## The shape of it

```
 shortcut / tray / "New Snip"
            │
            ▼
   main: one TRANSPARENT surface per display  (snip.html)
            │  desktop stays live; cursor → crosshair
            │  user drags a rectangle
            ▼
   page clears its marks, waits 2 frames, commits
            │
            ▼
   main: hide surfaces → settle 120ms → desktopCapturer
            │                    ← the screen is photographed HERE
            ▼
   main: NativeImage.crop         ← only the selected pixels leave main
            │  snip:captured  {dataBase64, width, height}
            ▼
   renderer (SnipController)
            │  POST /api/snips/upload-url   → reserve id + sign slot
            │  PUT  <signed url>            → THE BYTES, direct to GCS
            │  POST /api/snips              → finalise
            ▼
   clipboard (via main) + toast + OS notification
```

### Nothing is drawn over the user's screen

The surface is a **fully transparent** window per display. The desktop stays live and visible, the cursor becomes a crosshair, and the only ink that ever appears is the rectangle being dragged plus its size readout. There is no scrim, no dimming, and no photograph of the desktop underneath.

A window still has to exist, and that is not a loophole — **no OS gives an application a global cursor change or global mouse capture without one.** What was removed is everything the window *displayed*. An earlier build froze the screen first and let the user select over a dimmed still; it was replaced because it looked like the app had hung.

### The cost: the capture is taken AFTER the selection

This is the one real trade, and it is worth stating plainly. With nothing frozen, the screen has to be photographed once the rectangle is gone — otherwise every capture is framed in its own blue border. So the order is: page clears its marks → waits two animation frames → commits → main hides the surfaces → waits `SNIP_SETTLE_MS` (120ms) → `desktopCapturer` → crop.

Two belts, because one is not enough: the page's frame wait covers *its* compositor, and the main-side settle covers the window actually leaving the screen (`win.hide()` returns immediately; `desktopCapturer` reads what the compositor has, not what Electron has been told).

The residue is a ~100ms window in which live content could change under the rectangle — a playing video captures a slightly later frame than the one aimed at. That is inherent to any non-freezing snipper, and it is the price of the surface being invisible.

**A capture failure here is silent from the user's side** — they drew a box and nothing happened — which is why main emits `snip:failed` and `SnipController` toasts it. Do not remove that channel.

`snip:failed` carries a **`reason`**, because the causes need different advice and a single "try again" is wrong for the most common one:

| `reason` | What happened | What the user is told |
|---|---|---|
| `permission` | macOS Screen Recording is not granted. `desktopCapturer` does **not** throw for this — it returns sources whose thumbnails are empty — so main checks `getMediaAccessStatus('screen')` up front | Name the permission, with an **Open Settings** action (`permissions.requestScreenAccess`). Retrying cannot fix it |
| `no-sources` | `desktopCapturer` returned nothing at all | "That screen could not be read" |
| `empty` | The thumbnail came back blank with permission granted — realistically a monitor unplugged or a resolution change inside the settle window | Same, plus "if you changed displays mid-capture, try again" |
| `crop` | The crop or the PNG encode threw | Generic retry |
| `unknown` | Anything else | Generic retry |

**Every branch logs.** The first version of this returned a bare `null` when `captureDisplay` could not produce an image, which is not an exception — so it skipped the `catch`, produced a user-visible toast, and left **nothing in the log to explain it**. A failure the user can see and nobody can diagnose is the worst of both; keep the `console.error` on the no-payload path.

### Why main crops and the renderer never sees the full screen

The surface reports a rectangle. Main takes the capture and crops it, then sends **only that region** down. A surface that received the whole capture and cropped it in the page would be a full-screen screen-reader running at a `file://` origin — which is why `snip-preload.js` has **no image channel at all**. Nothing can send that window a picture, so nothing can leak one through it.

### Why the renderer uploads and main does not

Main has no Firebase session. More importantly, the bytes must go **straight to Cloud Storage over a signed URL** rather than through a Vercel function (rule 9i) — a region capture is routinely 1–5 MB and base64 in a JSON body adds a third on top. Signing the slot needs an ID token, which lives in the renderer.

---

## The share token

A snip's token is its **document id**, unlike the prompt library, where `prompt-shares/{token} → promptId` is a second index doc. The difference is deliberate:

- A prompt exists before it is shared and is addressed by its own id in internal URLs, so its token has to be a separate, later-minted secret.
- A snip is *born* shared. Nothing addresses it by any other id and no internal surface prints one, so a separate index would be one more document and one more read per public view, for nothing.

**The consequence: a snip id is a secret.** Never log one, never put one in an error message, and never return one from a route that has not established the caller is the owner.

32 characters over a 32-symbol alphabet ≈ 160 bits. `randomBytes % 32` is unbiased **only because the alphabet is exactly 32 long** — 256 divides evenly by it. Changing the alphabet's length reintroduces modulo bias and `mintSnipId` has to become a rejection loop.

## The version floor: 0.13.0

Capture is **entirely main-process work** — the global shortcut, the tray item, the transparent selection surfaces, `desktopCapturer` and the crop all live in `electron/main.js`. None of it can arrive by a Vercel deploy, and a renderer inside an older shell is the normal case here, not an edge case (rule 9c). Without a floor, such a user gets a page that looks completely functional and whose every button does nothing.

`SNIPPING_TOOL_MIN_APP_VERSION` in [`src/lib/snips.ts`](../src/lib/snips.ts) is the single declaration. It is enforced in **two** places, and both are needed:

| Where | What it does | Why it is not enough alone |
|---|---|---|
| `MIN_VERSION_PAGES` in [`Sidebar.tsx`](../src/components/Sidebar.tsx) | Refuses the click, toasts "needs version 0.13.0 or newer" | The rail is not the only way to reach a route — deep links, the completion notification's `actionUrl`, and typing the URL all bypass it |
| The page itself | Renders an "update required" state instead of the library | Nothing stops a user reaching the route; this is the actual gate |

This mirrors GoLogin's `minVersion` in `SATELLITE_PAGES`, but the mechanism differs and the difference matters: GoLogin opens a **satellite window**, so `main.js` also refuses the path outright via `SATELLITE_PREFIXES`. The Snipping Tool is an ordinary in-window route, so there is no main-process refusal to lean on — the renderer is the only thing that can say no.

**`useAppVersion` is three-state (`checking` / `resolved`) and the page must wait for `resolved`.** `meetsMinVersion` treats an unknown version as failing the floor, which is the right default for a decision and the wrong thing to paint: gating on the boolean alone flashes "update required" at every user during the tick before the IPC answers. A shell so old it cannot answer resolves to `null`, which fails the floor — which is the correct outcome, arrived at deliberately rather than by a race.

**It is a floor, set once, and then left alone.** `meetsMinVersion` is `>=`, so `0.13.0`, `0.14.0`, `1.0.0` and a `0.13.0-beta.1` all pass — routine releases never touch this constant, and nothing needs to be kept "in sync" with `electron/package.json`. Verified against the real function:

| Installed build | Result |
|---|---|
| `0.12.0`, `0.12.9` | blocked |
| `0.13.0`, `0.13.1`, `0.14.0`, `1.0.0` | access |
| `0.13.0-beta.1` | access (the pre-release suffix is stripped by `parseVersion`) |
| `null`, `''`, unparseable | blocked |

The **one** thing that would break it: the constant must name the version that *actually* ships the main-process code, not the version it was planned for. If this release slipped and the snip code landed in `0.14.0` instead, a floor left at `0.13.0` would wave through `0.13.0` users to a page that cannot capture. Set it to the build it really shipped in; after that it is finished.

The version arithmetic itself (`parseVersion` / `meetsMinVersion`) lives in [`src/lib/appVersion.ts`](../src/lib/appVersion.ts). It was private to `Sidebar.tsx` until this feature needed it from a page as well; two copies of version comparison is the kind of thing that drifts into disagreeing about what `0.13.0` means.

## Authorisation, in three layers

1. **The page permission `apps-snipping-tool`** (tier 2) gates every owner-facing route *and* the native surfaces: `SnipController` pushes `enabled` to Electron from `permittedPageIds`, so revoking the page takes the tray item and the shortcut away rather than just hiding the list. Main deliberately **never caches that config to disk** — a cached one would re-arm a revoked user's shortcut at next launch.
2. **`ownerUid`, per row**, everywhere a specific snip is addressed. The id is unguessable; "unguessable" is not an authorisation check.
3. **The token alone** on the public page and the image route, exactly like `/p/[shareId]`. Both re-check liveness independently — the image endpoint is reachable without the page, so it cannot lean on the page having checked — and both return **one 404 for every refusal** (unknown, deleted, pending, expired), so a stranger cannot probe which tokens exist.

`enabled` in the IPC config is **not** a security boundary and does not need to be: every route behind a capture re-checks server-side, so a spoofed `enabled: true` buys a tray icon and a local crop that nothing will store.

## The library pages; it does not list

`GET /api/snips` returns **one page** — `{ snips, nextCursor, total }` — not the user's whole library. The cap is 500 snips per user, and each row's preview is a `302` through a Vercel function, so an unpaged grid is not one big response but one response *plus* up to five hundred origin requests (rule 9i). `SNIP_PAGE_SIZE` is 24; `total` rides the first page only, so the count line can say "24 of 118" without billing an aggregation read on every scroll.

The cursor is `{createdAt ms}.{document id}`, and **both halves matter**. The id gives an exact, tie-proof `startAfter` while that row still exists; the timestamp is the fallback for the case the id cannot survive — the user deletes the last row of a page and then scrolls, which with an id-only cursor would silently restart the list from the top. A malformed cursor returns an empty page rather than page one, for the same reason.

Ordering and filters are unchanged from the unpaged query, so the cursor rides the **existing** composite index (`ownerUid`, `status`, `createdAt desc`) — paging added no index and nothing to deploy.

On the page, the sentinel and the "Load more" button are **the same element**: scrolling loads the next page 600px early through an `IntersectionObserver`, and a user who tabs (or a browser without the observer) gets a real control rather than a dead marker. A next-page fetch stands down while one is in flight; a *reload* preempts instead, guarded by a sequence stamp so the abandoned response cannot land on top of the newer one.

## The public page shows a name and nothing else

`getPublicSnip` is the whole of what an anonymous visitor can see: the image, the date, the dimensions, and the owner's `displayName`. **No uid, no email, no avatar, no storage path, no retention, no byte size.** A forwarded link must not become a staff directory entry. Keep it that way when extending the projection.

**Neither the public page nor the owner's library links to the image URL**, and that is a rule, not an oversight. `imageUrl` is a 302 to a signed Storage URL, so *navigating* to it (rather than loading it as an `<img src>`) lands the browser on `storage.googleapis.com/...` with the signed credential sitting in the address bar and the session history. Two things leak there: the object path, and a bearer URL that stays valid for its full hour — outliving the snip being deleted, which is precisely what the indirection below exists to prevent.

So: the owner's card opens `shareUrl` (the public page — which also shows them what a recipient sees), and the public page's image is **not wrapped in a link at all**. If a "view full size" affordance is ever wanted back, it needs to be a client-side zoom, not an anchor to the image route.

The image is served through `/api/public/snip/{id}/image`, which **302s to a freshly signed URL** rather than streaming the object. That indirection is what makes the URL a recipient holds permanent to the outside (a Slack unfurl, a browser cache, an OG preview) and revocable from the inside — deleting the snip kills it immediately, where a handed-out signed URL would keep working until its own expiry. Both the redirect and the 404 are `no-store`; a cached redirect would outlive its target *and* survive the delete.

---

## Retention

`SnipSettings.retention` ∈ `1m | 3m | 6m | 1y | never`, default **`6m`**. Each snip stores its own `expiresAt`, stamped from the owner's setting at capture time.

**Changing the setting re-stamps every existing snip** (`restampRetention`, `bulkWriter` per rule 9), recomputed from **each row's own `createdAt`** — not from now. So 6m → 1m deletes the four-month-old snips on the next sweep, which is what the words say. The alternative (new snips only) would make the setting silently apply to a future the user cannot see.

### The one trap: `never` must leave `expiresAt` ABSENT, not null

Firestore orders `null` **before every other value**, so a stored `null` matches the sweep's `expiresAt <= now` and puts exactly the snips the user asked to keep forever first in line for deletion. An **absent** field is excluded from an inequality filter. `finalizeSnip` omits the field and `restampRetention` uses `FieldValue.delete()`; do not "tidy" either into a null.

### Expiry is enforced on READ, not by the cron

`getPublicSnip` and `getSnipImageRedirect` both refuse a row past its `expiresAt` the moment it is past it. The daily sweep reclaims the bytes, which is a separate concern with a day of slack in it. **Do not move the read-path check out on the grounds that a cron exists** — it is what makes "deleted after 6 months" true to the hour.

The sweep also collects **abandoned reservations**: a slot whose PUT landed but whose finalise never arrived (the window closed, the machine slept). Those are unreachable bytes and this is the only thing that reclaims them.

---

## The keyboard shortcut

Default `CommandOrControl+Shift+S` — an Electron **accelerator**, not a browser key string.

`isValidSnipShortcut` runs on the client *and* on the API route, and it is not belt-and-braces. `globalShortcut.register`:
- **throws** on a malformed accelerator rather than returning false, and
- happily accepts a **bare unmodified key** — registering `S` globally would swallow every `s` the user types in every other application on the machine, with no way to fix it from inside an app they can no longer type into.

So: at least one modifier, exactly one non-modifier key.

`register` also returns **false** when another application already owns the combination. `snip:configure` returns that as `shortcutRegistered`, and `SnipController` toasts it — silently doing nothing would leave the user pressing a key that belongs to someone else and concluding the tool is broken.

`ShortcutRecorder` reads `event.code`, not `event.key`: `key` is the character the layout produces, so on AZERTY `Shift+A` arrives as `Q`. `code` is the physical key, which is what an accelerator binds to. ⌘ and Ctrl are folded into `CommandOrControl` so a binding chosen on one platform works on the other.

## The tray item

| | macOS | Windows |
|---|---|---|
| Surface | Menu bar item | Notification-area icon |
| Asset | `snipTemplate.png` (+`@2x`), black-on-alpha, re-tinted by the OS | `snip-win.png`, white — Windows draws the icon as-is |
| Left click | New snip | New snip |
| Right click | `popUpContextMenu` (manual) | `setContextMenu` |

**The tray glyph is `ImageUpscale` — the same mark as the page icon**, so the tool looks like one thing everywhere it appears.

The assets are **generated from lucide's own path data**, copied verbatim out of `lucide-react/dist/esm/icons/image-upscale.mjs`, so the menu-bar mark and the in-app icon are literally the same drawing rather than a hand-traced lookalike. They are rasterised by distance field with 8×8 supersampling, not by plotting rectangles: this icon is mostly arcs plus a diagonal, and at 16px an aliased diagonal is the difference between a mark and a smudge.

It is a **dense** mark at 16px — a dashed frame, an inner picture, and an arrow, all competing in a 16px box. That is a known trade, accepted deliberately for consistency with the page icon. If it ever needs redrawing, judge the result at 16px on a real menu bar, not zoomed in a vector editor, and regenerate rather than editing the PNGs by hand.

**The platform split on the menu is not cosmetic.** On macOS `setContextMenu` makes a *left* click open the menu and suppresses the `click` event entirely, so one-click capture would be impossible; the menu is popped up by hand instead.

This is a **second** `Tray`, independent of the session-timer tray (`timerWidgetTray`). They have different lifecycles — the timer's exists only while clocked in, this one while the user holds the page.

## Why the rectangle looks the way it does

It has to stay legible over content nobody controls — a white document, a dark terminal, a photograph. So it is a 1px Action Blue border with a **1px dark outline just outside it**: whichever of the two a given background swallows, the other survives. The fill is `rgba(59,130,246,0.10)` — enough to read the shape at a glance, not enough to obscure the thing being captured, which is what the user is aiming at.

There is deliberately **no hint pill or instruction chrome.** The brief was a cursor and a box; a floating "Drag to select · Esc to cancel" label is neither, and the page's own description already states the shortcut.

## Multi-display

One transparent surface per display, each covering that display's bounds.

- `desktopCapturer` takes **one** `thumbnailSize` for every source, so it is the bounding box of the largest display in device pixels; each capture is fitted inside it preserving aspect ratio. The **actual** returned size is read back rather than assumed — that is what makes a Retina laptop beside a 1080p monitor crop correctly. Never scale by `scaleFactor` instead.
- Sources pair to displays by `source.display_id`, falling back to index order.
- **There is no `blur` → cancel in `snip.html`, and adding one would be a bug.** Exactly one window can be key, so a page-level blur handler would cancel the whole snip the moment the second surface opened, and again every time the cursor crossed screens. Main owns that rule (`armSnipOverlays`) because main is the only side that knows how many surfaces exist, and it applies it **only** when there is one. On a multi-display setup, Escape and right-click are the escape hatches; every surface accepts both.

---

## Gotchas

- **The completion notification deliberately ignores `notificationPreferences.desktopEnabled`.** That toggle governs the *notification feed* — shift reminders, DMs, things the system pushes at you (`useNotifications`). A snip confirmation is direct feedback on an action the user just took, and while the window is hidden it is the **only** feedback that exists; gating it would mean a user with alerts off captures into silence and has no way to know the link is on their clipboard. It is `playSound: false` for the same reason it is shown: it confirms, it does not interrupt.
- **The clipboard write goes through MAIN**, via [`copyText`](../src/lib/copyText.ts). `navigator.clipboard.writeText` needs the document focused, and the whole point of a snip is that it completes while the user is in another application with the Bluu window hidden — there the web API rejects and the one thing the user wanted never lands. `clipboard:writeText` runs in main and has no such requirement. The web API is the **fallback**, for an installed shell that predates this feature (rule 9c) and for a plain browser; both are reachable only by clicking a page, so the document is focused there by construction. `copyText` returns whether the text actually landed, and both call sites report that honestly rather than claiming a copy they did not make.
- **Surfaces come down before the upload starts.** By the time the PNG is uploading, the user already has their screen and their cursor back; everything after the crop is the renderer's problem.
- **`SnipController` is mounted on the layout, outside `LazyProviders`.** It must arm regardless of clock state — a snip is not a shift activity — and a capture has to work with no page open.
- **Its effects key on primitives, never on `userData`.** `users/{uid}` is rewritten by presence every ten minutes; an effect keyed on the snapshot would re-register the global shortcut with the OS on a timer (rule 9i).
- **`api.removeCapturedListeners` is a `removeAllListeners`.** `handleCapture` is deliberately dependency-free so the subscription is made once; a churning one would tear out its own handler.
- **Cache Components.** `/s/[shareId]` reads uncached data inside a `<Suspense>` boundary and must stay that way. Do not add `export const dynamic` (rejected outright under the flag) and do not mark the page or `getPublicSnip` cacheable — a deleted snip has to stop resolving immediately.
- **`/s` is allowlisted in `src/middleware.ts`.** Without it a recipient in a normal browser is rewritten to `/desktop-only`, which would make sharing pointless.
- **The bucket's CORS policy is a deployment prerequisite** — see the Storage section above. `Failed to fetch` on `storage.googleapis.com` is always this, never the code.
- **The page is gated on app version 0.13.0** in two places — see the version-floor section above. It is a **floor, set once**: `0.14.0` and everything after it passes, so routine releases never touch it.
- **This needs an Electron build** (rule 14, the two-push dance): `electron/main.js`, `preload.js` and two new files changed. A renderer on an older shell degrades cleanly — `window.electronAPI.snip` is absent, every call site feature-detects, and the page says to update.
