# Electron Desktop Shell

Spoke for the `electron/` desktop wrapper. Read this before changing anything in `electron/main.js`, `electron/preload.js`, the build config, or any renderer code that calls `window.electronAPI`.

## What it is

A **thin Electron shell that loads the hosted Next.js web app** (`https://bluu-backend.vercel.app` — see [Two domains, one deployment](#two-domains-one-deployment)). It bundles almost no app code — the web app itself is served from Vercel. The shell exists to give employees a desktop app with native capabilities the browser can't offer (OS idle detection, screen capture, native notifications, deep-link OAuth) and to gate the app to desktop-only (`src/middleware.ts` admits requests whose UA contains `Electron/`).

### Two domains, one deployment

The same Vercel project serves **two hosts**, and the difference matters:

| Host | Who uses it |
|---|---|
| `bluu-backend.vercel.app` | **The Electron shell only** — hardcoded as `BASE_URL` in `electron/main.js`. |
| `app.bluurock.com` | **Browser-facing pages** — `/creator`, `/download`, `/terms`, `/raffle`. Exported as `PUBLIC_APP_ORIGIN` in [`src/lib/publicOrigin.ts`](../src/lib/publicOrigin.ts). |

`src/middleware.ts` is host-agnostic, so both domains expose exactly the same surface (browser traffic outside the allowlist rewrites to `/desktop-only`).

- **Never point the vercel.app host at a redirect to the custom domain.** `BASE_URL` is compared with `startsWith` in `will-navigate`, `did-fail-load` and `did-finish-load`; landing on a foreign origin makes the shell kick its own navigations out to the system browser and silently skips the offline-retry reset and the 0.9 zoom default.
- **Never build a user-facing link from `window.location.origin`.** Staff run the app inside Electron, so that resolves to the vercel.app host. Use `PUBLIC_APP_ORIGIN` — as the "copy creator link" button in `src/app/(main)/creator-portal/custom-requests/page.tsx` and `APP_UPDATE.downloadUrl` do.
- OAuth is unaffected: `redirect_uri` comes from the fixed `NEXT_PUBLIC_REDIRECT_URI` env var (vercel.app), not from the requesting host. Auth state is per-origin (Firebase uses IndexedDB, the app sets no cookies), so the two hosts have independent sessions by design.

### The core constraint: two update channels
- **Renderer (the web app) updates instantly** via Vercel — but only reaches a user **on a full page load**, which a desktop app does not perform on its own. See [Renderer staleness](#renderer-staleness-the-app-that-is-never-closed).
- **The native shell updates per-platform.** **macOS** builds are Developer ID signed + notarized, so `electron-updater` installs them in-app — checked **once at app start**, never mid-session. **Windows** has no real signing cert, so those users must manually reinstall; they're nudged by the version-gated banner. Pushes are rare either way, and a mac user only picks one up when they **restart the app while clocked out** — so **never assume a given native version is deployed**.

**Implication for every change:** put capability + robustness in the native shell (`electron/`), keep *policy* in the renderer (`src/`). New native APIs must be **feature-detected** on the renderer side (`window.electronAPI?.x?.y`) so the renderer keeps working on older installed builds and can light up new behavior as users update. See the version-gated update nudge below.

## Files

| File | Purpose |
|---|---|
| `electron/main.js` | Main process: window creation, IPC handlers, deep-link OAuth, crash recovery, offline fallback, power events, lifecycle. |
| `electron/preload.js` | `contextBridge` — exposes `window.electronAPI` to the renderer. The **only** bridge between renderer and main. |
| `electron/loading.html` | Local splash shown instantly on launch (logo inlined as data-URI), then the app navigates to Vercel. |
| `electron/offline.html` | Local retry screen shown when the Vercel app can't load (logo data-URI + "Try again" button → `app:retry-load`). |
| `electron/widget.html` | The **Windows** timer HUD page (see [Session timer widget](#session-timer-widget-tray-title--docked-hud)). Renders nothing on its own — main sends it a finished string each second. |
| `electron/widget-preload.js` | Preload for `widget.html` **only** — exposes `onTick` plus the four drag channels (`setInteractive`/`dragStart`/`dragEnd`/`resetPosition`), and nothing else. Deliberately not the app preload; the drag channels carry no coordinates, and main accepts them only from the HUD window. |
| `electron/public/tray/*.png` | Timer-state glyphs (`*Template.png` + `@2x`), black + alpha. macOS template images; the Windows HUD uses the same files as a CSS mask. |
| `electron/package.json` | App version, npm scripts, and the full `electron-builder` config (incl. the `build.files` allowlist). |
| `electron/public/logo/*` | App icons (`icon.icns`, `icon.ico`). |
| `electron/public/*.mp3` | Notification sound (played in the renderer). |
| `electron/build-assets/` | NSIS installer background. Signing key/cert are **gitignored** (see Security). |

> **`build.files` is an allowlist.** Any local file the main process loads at runtime (e.g. `loading.html`, `offline.html`) **must** be listed there or it won't be in the packaged `app.asar`. A missing file → `loadFile` fails silently. This has bitten us before.

## IPC surface

All renderer↔main communication goes through `preload.js` → `window.electronAPI`. Types live in `src/types/electron.d.ts` (new/optional APIs are typed `?:` because older builds lack them). Renderer must always feature-detect.

> **Everything under `window.*` is sender-scoped** — see [Multi-window](#multi-window-the-main-window-and-its-satellites). A handler resolves its window from `BrowserWindow.fromWebContents(event.sender)`, so a satellite that calls `setSize` resizes *itself*.

| `electronAPI.*` | Direction | Main handler | Notes |
|---|---|---|---|
| `auth.startGoogleOAuth()` | invoke | `auth:start-google-oauth` | opens `/auth/google` in the external browser |
| `auth.onOAuthCallback/onOAuthError` | main→renderer | — | fired from the `bluu://` deep-link handler |
| `window.setResizable/setSize` | send | `window:set-*` | resize the calling window (login vs app); `setSize` **clamps to the work area** then re-centers |
| `window.getSize()` | invoke | `window:get-size` | current **outer** window size `[w,h]`; used to persist user resizes without title-bar drift |
| `window.getState()` | invoke | `window:get-state` | `{ width, height, isMaximized }` — outer size **plus** maximize state (optional; absent pre-fix) |
| `window.getWorkArea()` | invoke | `window:get-work-area` | work area of the display the calling window is on, in **DIPs** (optional; absent pre-fix) |
| `window.maximize/minimize/focus()` | send | `window:*` | (optional) |
| `window.close()` | send | `window:close` | **satellites only** — main ignores it for the main window, which must close through the clock-out flush (v0.10.0+) |
| `window.setAlwaysOnTop(bool)` / `isFocused()` / `setZoom(f)` / `getZoom()` | both | `window:*` | per-window; `setZoom` is remembered on the record so a reload keeps it instead of snapping back to 0.9 (v0.10.0+) |
| `window.setOverlayIcon(dataUrl, desc)` | send | `window:set-overlay-icon` | **Windows** taskbar badge. The *renderer* draws the image, so the badge restyles without a native build. No-op elsewhere (v0.10.0+) |
| `window.flashFrame(bool)` | send | `window:flash-frame` | Windows/Linux taskbar attention (v0.10.0+) |
| `window.onUserResized(cb)` | main→renderer | `window:user-resized` | **user-initiated** resize/maximize only — never the programmatic auto-size (optional; absent pre-fix) |
| `window.onFocusChange(cb)` | main→renderer | `window:focus-changed` | focus/blur of *this* window — decide whether a message deserves a notification (v0.10.0+) |
| `window.openSatellite(idToken, opts)` | invoke | `window:open-satellite` | the generalised spawner (v0.10.0+). `closeSatellite(key)` / `listSatellites()` alongside it |
| `onlyfans.openWindow(idToken, opts?)` | invoke | `onlyfans:open-window` | Same handler, legacy name. Spawns an OF satellite; **verifies the page permission server-side first**; one window per `key`; **not** an Electron child window. Optional — feature-detect. See [Multi-window](#multi-window-the-main-window-and-its-satellites) and [onlyfans-crm.md](onlyfans-crm.md#the-window) |
| `timeTracking.getIdleTime()` | invoke | `timeTracking:getIdleTime` | `powerMonitor.getSystemIdleTime()` |
| `timeTracking.getActivitySince(sinceMs)` | invoke | `timeTracking:getActivitySince` | 5s idle-time samples (45-min rolling buffer) for accurate activity % |
| `timeTracking.captureScreenshot()` | invoke | `timeTracking:captureScreenshot` | `desktopCapturer`, all screens → base64 PNGs |
| `timeTracking.setPowerSaveBlocker(bool)` | invoke | `timeTracking:setPowerSaveBlocker` | keep display awake while working |
| `timerWidget.update(payload)` | send | `timer-widget:update` | Always-visible session timer. Carries an **anchor**, not a time; **main-window only**. Optional — feature-detect. See [Session timer widget](#session-timer-widget-tray-title--docked-hud) |
| `notifications.show(opts)` | invoke | `notifications:show` | native `Notification` + optional renderer sound/navigate. **Routed to a window** via `opts.target` — see [Notifications](#notifications-routed-to-a-window) |
| `notifications.close(id)` | invoke | `notifications:close` | dismiss a banner shown with that `id` (v0.10.0+) |
| `notifications.onActivated/onReply/onAction(cb)` | main→renderer | `notification:*` | click (with `id`), macOS inline reply text, action-button index (v0.10.0+) |
| `clipboard.readImage()` | invoke | `clipboard:readImage` | `{dataUrl,width,height}` or null. The **only** clipboard read path — `clipboard-read` stays denied (v0.10.0+) |
| `files.save(opts)` | invoke | `dialog:saveFile` | native save dialog + write. Renderer supplies bytes, never a path (v0.10.0+) |
| `files.download(opts)` | invoke | `download:start` | streams an http(s) URL to disk with a save dialog — for large media. Progress via `onDownloadProgress`/`onDownloadDone` (v0.10.0+) |
| `files.showInFolder/open(path)` | invoke | `shell:*` | **only** paths this session wrote (v0.10.0+) |
| `permissions.requestScreenAccess/requestNotification` | invoke | `permissions:*` | OS permission prompts |
| `app.getPlatform()` | invoke | `app:getPlatform` | `process.platform` |
| `app.getVersion()` / `getVersions()` | invoke | `app:getVersion` / `app:getVersions` | fleet version reporting + update nudge |
| `app.setBadgeCount(n)` | invoke | `app:setBadgeCount` | macOS/Linux dock number. Windows has none — use `window.setOverlayIcon` (v0.10.0+) |
| `app.bounceDock(type)` / `cancelBounce(id)` | both | `app:bounceDock` / `app:cancelBounce` | macOS dock bounce (v0.10.0+) |
| `app.getPendingDeepLink()` / `onDeepLink(cb)` | invoke / main→renderer | `app:getPendingDeepLink` / `deeplink:route` | **non-OAuth** `bluu://` URLs, parsed but uninterpreted — see [Deep-link OAuth](#deep-link-oauth-bluu) (v0.10.0+) |
| `app.signalReady()` | send | `app:ready` | renderer signals React mounted |
| `app.closingFlushed()` | send | `app:closing-flushed` | renderer acks it finished flushing on close (see Clock-out flush) |
| `app.retryLoad()` | send | `app:retry-load` | offline screen "Try again" — reloads the **calling window's own** route |
| `power.onEvent(cb)` | main→renderer | — | native `suspend`/`resume`/`lock`/`unlock` (see Power events). Main window only |
| `bugs.onReport(cb)` | main→renderer | — | main-process errors forwarded so renderer POSTs `/api/bugs`. Main window only |
| `updater.getPending()` | invoke | `updater:getPending` | result of the start-up check (`{version}` or null); **v0.8.0+ — feature-detect** |
| `updater.download()` | send | `updater:download` | begin download; only ever from an explicit user click. **v0.8.0+** |
| `updater.onAvailable/onProgress/onStatus/onBeforeInstall`, `readyToInstall()` | both | `updater:*` | live on macOS; inert on Windows (auto-update is darwin-gated) |
| `updater.check()` | invoke | `updater:check` | re-run the start-up check on demand. **Typed optional; the main-process handler is NOT built yet** — it ships with the next Electron build. Until then the renderer's "Check again" button falls back to re-reading `getPending()` |

## Renderer staleness: the app that is never closed

"Vercel deploys in seconds" is true of the *server*. The **client bundle** only changes on a full page load, and the shell never performs one on its own:

- `main.js` reloads a window on exactly three events, all failures — `render-process-gone` (crash), `did-fail-load` (offline screen), and the offline screen's retry button. Nothing else.
- **Sleep/wake is not a page lifecycle event.** The renderer keeps its process (`backgroundThrottling: false` keeps its timers alive), Firestore listeners reconnect silently, and `TimeTrackingContext` patches the sleep gap into the session log. All three paths are built to *survive* without a reload, which is exactly why none causes one. Clocking out doesn't reload either.
- There is no service worker and no `location.reload()` in app code.

The only other refresh path is Next's own: the App Router hard-navigates (`doMpaNavigation`) when an RSC response's build id differs from the client's. That fires only on a navigation that actually reaches the network, so a user who moves around the app picks up a deploy within minutes — and a user parked on one page (clock out → leave the app open → sleep → wake → repeat) picks it up **never**. Weeks-old client code against a current backend.

**Two mechanisms address this, and they are not alternatives:**

1. **Read policy over HTTP, not from the bundle.** Anything that decides whether a user is blocked, prompted or gated must not be a compiled-in constant, because a stale renderer never sees the new value. `fetchAppUpdateConfig()` → `GET /api/app-update` is the worked example: it is what makes "arm the config → the fleet is prompted" true for the never-quits user. Apply the same shape to any future kill switch.
2. **[`DeploymentRefresher`](../src/components/DeploymentRefresher.tsx)** (mounted in `(main)/layout.tsx`) forces the page load itself. `GET /api/deployment` returns the id of the deployment serving production; the client learns its own id on first check and reloads when it changes.

### DeploymentRefresher's rules

| | |
|---|---|
| **Checks on** | window focus, window blur, `visibilitychange`, a clock-out transition, and a 30-min backstop interval. Rate-limited to one request per minute. |
| **Why DOM events, not `power:event`** | The native wake signal would be more precise, but `TimeTrackingContext` calls `power.removeEventListener()` (= `removeAllListeners`) in its effect cleanup, so a second listener there is torn out at the first dependency change. Regaining focus after a wake covers the same ground with no shared state. |
| **Reloads only while `clocked-out`** | An **allowlist of one state**, not "not `working`" — `idle`, `paused` and `on-break` all mean the session is still open and are all excluded. Nor is it deferred to a quiet moment mid-shift; it simply does not happen. Staleness latches in a ref and every later trigger re-tests the gate, and clock-out is itself a trigger, so the wait ends there. Same gate, same form, in `UpdateAvailableBanner`. |
| **Never reloads** | over a desktop update that is downloading/installing ([`updateInFlight.ts`](../src/lib/updateInFlight.ts), set by `UpdateAvailableBanner`), while an input/textarea/contenteditable has focus, or anywhere under `/onboarding`. A forced reload discards unsubmitted form state. |
| **Fail-safe** | `/api/deployment` returns `{ id: null }` when it can't determine one (local dev). Null is treated as "don't know", never as "changed" — a per-request-varying id would put every client into a reload loop. |
| **Main window only** | It lives in `(main)/layout.tsx`; the OF Manager satellite has its own layout and must never reload under an operator mid-conversation. |

## Multi-window: the main window and its satellites

The shell owns **one main window and zero or more satellites**. A satellite is a co-equal top-level window loading an app route (today: OF Manager); it is *not* an Electron child window — a parented window is pinned above its parent on macOS forever, which makes the main window unusable.

**The rule that makes this work: no handler may close over `mainWindow`.** Every window-scoped IPC resolves its target with `BrowserWindow.fromWebContents(event.sender)`. Before v0.10.0 they were all hardwired to the main window, so a satellite calling `setSize` silently resized the *main* window. Per-window state (geometry floors, remembered zoom, offline backoff, crash counters) lives on a record in the `winRecords` map keyed by `win.id`, not in module-level variables.

`attachWindowBehaviour(win, …)` applies one identical posture to every window: navigation (app origin in-window, everything else to the system browser), `did-fail-load` → offline screen with backoff, `render-process-gone` → auto-reload with a 3-per-60s loop guard, unresponsive reporting, manual-resize reporting, focus reporting, the 90% zoom default, and the context menu. Each window's offline screen retries **its own route**, not the app root.

### Routes are a prefix allowlist, not an enum

`openSatellite(idToken, { path, key, … })` accepts **any path under an allowlisted prefix**:

```js
const SATELLITE_PREFIXES = [
  { prefix: '/of-manager', accessPath: '/api/onlyfans/access', title: 'OF Manager' },
];
```

So `/of-manager`, `/of-manager/chat/abc`, `/of-manager/vault` all work — a popped-out chat window, a media viewer or a vault browser ships as a **renderer-only change**. Adding a whole new *prefix* is the only thing that needs a native build, because each prefix names the access route that guards it.

The path is treated as untrusted input: same origin, under a prefix, no `..`, no `\`, no protocol-relative host. `key` identifies the window instance (defaults to the path) — a repeat call with the same key **focuses** the existing window rather than spawning a second. Capped at `SATELLITE_MAX` (8) windows.

**Permission is verified server-side before the window is created:** main POSTs the renderer's Firebase ID token to the prefix's `accessPath` and only proceeds on a 200. Hiding the sidebar item is a convenience; this is the gate a determined renderer cannot skip.

Satellites are destroyed on the main window's `closed` (hooked to `closed`, not `close`, so the clock-out flush veto still runs). Without that, `window-all-closed` never fires and the app never quits. Satellites themselves have **no** close flush — they hold no time-tracking state.

## Notifications: routed to a window

`notifications.show({ …, target })` picks the destination: omitted → **the calling window** (identical to the old main-window-only behaviour when called from the main window), `'main'` → the main window, any other string → that satellite key (falling back to main). Click focuses *that* window and sends `notification:navigate` to it — a new-DM alert raised by the OF window must not drag the operator out of the inbox.

- `id` — stable identity. A repeat `show` with the same id **replaces** the banner instead of stacking five alerts for one chat, and it is echoed back on click/reply/action. It is also the handle for `notifications.close(id)`.
- `hasReply` + `replyPlaceholder` — macOS inline reply. The text arrives on `onReply`; it deliberately does **not** focus the window, because replying inline exists precisely so the operator doesn't have to switch.
- `actions` — up to 3 macOS buttons; the index arrives on `onAction`.

## Unread badges

Three mechanisms, because badge support is per-platform and none of it has a web equivalent. The renderer picks:

- **macOS / Linux** — `app.setBadgeCount(n)`, a real dock number.
- **Windows** — no numeric badge exists. `window.setOverlayIcon(dataUrl, desc)` takes an image the **renderer** draws (canvas → data URL), so the badge can be restyled without shipping a native build. `null` clears it.
- **Attention** — `window.flashFrame(true)` (Windows/Linux) and `app.bounceDock()` (macOS).

## Session timer widget (tray title / docked HUD)

Keeps the live session clock on screen while the app is buried. Toggled per user in **Settings → App Settings → Timer Widget** (`users/{uid}.timerWidgetEnabled`, **default on** — absent means enabled, so read it with `!== false`).

| State | Widget shows |
|---|---|
| `working` | Session time, counting up |
| `on-break` | **Break allowance remaining**, counting down |
| `idle`, `paused` | The clock **stopped**, holding its last value |
| `clocked-out` | **Nothing — the widget is destroyed.** Not greyed out, not zeroed. |

### The anchor rule (the thing that makes it correct)

**The renderer pushes the inputs the display is derived from — never a formatted time.** `{ mode, baseSeconds, anchorMs }`, where `baseSeconds` was true at `anchorMs`. Main re-derives the number every second with the same arithmetic `TimeTrackingContext`'s own tick runs.

This is not a micro-optimisation, it is what makes "always in sync with the time tracking service" true rather than aspirational:

- **The two clocks are the same formula over the same anchor**, so they cannot drift. Pushing a per-second string instead would make the widget a *copy* of the timer, correct only as long as every message lands.
- **It survives a starved renderer.** The renderer's 1s tick freezes when the main thread blocks (the reason `TimeTrackingContext` has a `visibilitychange`/`focus` self-heal at all). A renderer-driven widget would freeze with it; an anchor-driven one keeps counting because main is a different process.
- **One IPC per transition, not one per second.**

`buildTimerWidgetPayload` ([`src/lib/timerWidget.ts`](../src/lib/timerWidget.ts)) is the only sanctioned way to build the payload, and the effect that pushes it lives **inside `TimeTrackingProvider`** — the one place holding `sessionBaseSecondsRef`, `entryStartTime` and `breakStartTime`. Its break countdown recomputes `allowanceAtStart` from the same two refs the tick's break branch reads, at the same commit, so the two agree by construction. **Don't move this push to a component or widen the context to feed it** — a consumer that only sees `elapsedSeconds` can push a *number*, and the drift is back.

### Per platform

- **macOS — `tray.setTitle()`** (a darwin-only API) with `fontType: 'monospacedDigit'`, so the digits don't jitter as they change width. `tray.setImage()` swaps the state glyph. Clicking the tray focuses the main window (`focusMainWindowFromWidget`, shared with the Windows HUD).
- **Windows — a frameless, transparent, always-on-top HUD** pinned to the bottom-right of the **work area**, which is precisely "just above the system tray" (`workArea` already excludes the taskbar, and follows it if the user moves it to another edge). It is `focusable: false`, `skipTaskbar: true`, `type: 'toolbar'`, shown with `showInactive()`, and held at the `'screen-saver'` always-on-top level because plain `alwaysOnTop` loses to a fair number of Windows shells. Repositioned from `registerDisplayListeners` — it has no window record, so the clamp loop does not cover it. It is **draggable, and clicking it focuses the main window** — see below.
- **Anything else** — ignored; there is no equivalent surface.

### The HUD is draggable, and clickable (Windows)

The tray corner is the **default**, not a fixture: the widget sits in the busiest corner of the desktop and sometimes covers the thing the user needs to read.

| Gesture | Result |
|---|---|
| **Left-click** (press that doesn't move) | Focuses the main window — same as clicking the macOS tray (`focusMainWindowFromWidget`) |
| **Left-drag** | Moves the widget; the new position is saved |
| **Right-click** | Snaps back to the tray-corner dock and forgets the saved position |

**Click vs drag is decided in main, not the page**, in the `timer-widget:drag-end` handler: main is what tracked whether the pill actually moved (`timerWidgetDrag.moved`), so `moved` → persist, `!moved` → focus. The page only reports that a press started and ended. **Reset is right-click and not double-click on purpose** — a left press that doesn't move is already a click, so a double-click gesture would raise the main window on its way through.

- **Click-through survives.** The resting state is `setIgnoreMouseEvents(true, { forward: true })` — clicks still pass to whatever is underneath, and `forward` keeps delivering mouse *moves* to the page, which is the only signal the HUD has that the cursor arrived. The page then asks main to make the window solid (`timer-widget:set-interactive`) and hands the corner straight back on exit. **Don't "simplify" this to a plain `setIgnoreMouseEvents(false)`** — that permanently swallows clicks in the corner, which is the thing the original click-through decision existed to prevent.
- **The drag is driven from main off the OS cursor**, not from renderer deltas. The page sends *no coordinates*: it reports grab start/end, and main translates `getCursorScreenPoint()` by a grab offset captured once. Renderer-reported deltas accumulate rounding error against a window that is moving under the pointer — the classic visibly-sliding hand-rolled Electron drag. It also means the HUD cannot ask to be put anywhere in particular.
- **The position persists** in `timer-widget-position.json` under `userData`, and survives every teardown/rebuild (i.e. every clock-out → clock-in). Best-effort: an unwritable file loses the position, never throws.
- **A press that never moves does not latch a position** (`timerWidgetDrag.moved`) — otherwise a stray click would silently opt the widget out of the default dock and it would stop following the taskbar.
- **Every origin is clamped** into the nearest display's `workArea`, so a saved position cannot strand the widget off-screen after a monitor is unplugged or the resolution changes. `positionTimerWidget` no-ops mid-drag rather than fighting the cursor.
- Renderer uses **pointer capture** so a fast drag that outruns the window still receives its `pointerup`; main additionally abandons a drag after 60s in case that release is lost entirely.

### Template images — verified

**The claim is true.** macOS treats an image whose filename ends in `Template` as a *template image*: it discards the colour, uses only the alpha channel, and re-tints it for the light/dark menu bar and for the pressed state. Electron mirrors AppKit's behaviour for `createFromPath`, and `nativeImage.setTemplateImage()` / `isMacTemplateImage` are typed `@platform darwin`. `trayIconFor()` relies on the suffix **and** calls `setTemplateImage(true)` explicitly, so a future rename can't silently turn the icon into a black-on-black blob.

**The trade-off this forces:** a template image is monochrome by definition, so the tray icon **cannot** carry the `STATE_CONFIG` hue. State is encoded by **glyph shape** instead — the same four lucide icons the time-tracking page uses (`ClockCheck` / `ClockAlert` / `Coffee` / `CirclePause`), which are distinguishable at 16px. Legibility in both menu bars was judged worth more than colour that is redundant with the shape. The Windows HUD has no such constraint and *does* take the hue — **which it receives in the tick payload, sourced from `STATE_CONFIG`, so no state hex is ever re-typed natively** (DESIGN.md §2).

The PNGs are black + alpha at 16px and 32px (`@2x`, auto-selected by `nativeImage`), rendered from the lucide paths at stroke-width 2.4 (lucide's 2 scales to a washed-out 1.33px at 16px; 2.4 lands at ~1.6px, matching the system weight). **One asset set serves both platforms** — Windows tints the same files through `-webkit-mask-image`.

### Failure behaviour

The widget is ambient: nothing depends on it, and it never blocks a session.

- A **stale anchor is worse than no widget**, so main tears it down on the main window's `render-process-gone` and on `did-fail-load` (offline screen). The provider re-pushes on its next mount, so it comes back by itself.
- The whole `ensure`/`render` path is wrapped in a `try`/`catch` that degrades to "no widget" — a tray asset missing from the asar must not surface as an uncaught exception.
- Payloads are validated as untrusted input (state/mode against fixed sets, finite numbers, `#rrggbb` colour, control chars stripped from the label) and **accepted only from the main window** — a satellite cannot paint the menu bar.
- Teardown on the main window's `closed` is also what lets the app quit: a live `Tray` (or the HUD window) would otherwise keep `window-all-closed` from firing.

## Right-click menu and spellcheck

Chromium's spellchecker is on by default, but **Electron renders no suggestion UI unless the main process builds the menu** — and without a `context-menu` handler there is no cut/copy/paste either. `attachContextMenu(win)` builds one from `params`: spelling suggestions + "Add to Dictionary" when `misspelledWord` is set, link open/copy, image copy/save, then the editing roles gated on `params.editFlags`, plus Inspect Element in dev. It is attached to every window.

## Saving files

Two paths, both consented through a native save dialog, and the renderer **never names a filesystem path**:

- `files.save({ suggestedName, filters, dataBase64 })` — main shows the dialog and writes the bytes. Capped at ~200 MB decoded.
- `files.download({ url, suggestedName })` — main calls `webContents.downloadURL` and a session-wide `will-download` handler sets the save-dialog default and forwards `download:progress` / `download:done`. Use this for large media so the bytes never sit in renderer memory. http(s) only.

`files.showInFolder(path)` / `files.open(path)` are restricted to the `savedPaths` set — paths this session actually wrote. An arbitrary path from the renderer is refused.

## Window sizing & persistence

> This section describes the **main** window. The same IPCs work for a satellite (they are sender-scoped), but the persistence policy below — the `bluu_window_size` key, login/logout triggers — is main-window policy in the renderer. A satellite that wants to remember its size needs its own key; do not reuse this one.

The window opens at `1430×870`, `resizable:false` for the login page (`minWidth/minHeight` `1024×720` guard once resizing is enabled). **Both the initial size and the min sizes are capped by the primary display's work area** — a 1920×1080 @150% Windows laptop has only `1280×672` DIPs, and an un-resizable window larger than that is unusable.

Sizing **policy lives in the renderer** — [`src/lib/windowSize.ts`](../src/lib/windowSize.ts) + the login/logout effect in [`src/components/AuthWrapper.tsx`](../src/components/AuthWrapper.tsx) — but **display geometry is owned by the main process**.

**The spec, in one line: auto-size by default; once the user resizes by hand that size sticks and auto-sizing never runs again — until they log in again.**

- **On login**, it restores the remembered size (fitted to the current work area), or — when there is none — sizes the window to **85% width × 80% height** of the work area returned by `window.getWorkArea()`. If the saved state was `maximized`, it calls `setResizable(true)` then `maximize()` instead of restoring bounds.
- **On a manual resize** (logged in), `window:user-resized` arrives from main and is saved to the single `localStorage` key `bluu_window_size` as `{ width, height, maximized }`.
- **On logout**, the key is cleared, so the next login re-runs the dynamic 85/80 sizing. The key is intentionally **not** per-uid: forgetting on logout is the spec, and a shared key cleared at logout is the exact implementation (this also covers the `revoked`/`displaced` forced sign-outs, which flip login state through the same effect).

**The presence of the key is the entire "has the user chosen a size?" signal**, so it must only ever be written by a *genuine user resize*. Do **not** persist from the DOM `resize` event: it also fires for the auto-size itself, which writes the auto-sized value to storage and permanently disables auto-sizing (a relaunch then replays a stale hard number instead of fitting the current display). Main gates this with the window's `resized` / `maximize` / `unmaximize` events plus a short suppression window around its own `setSize` calls (`applyWindowSize`), and `setSize` passes `animate:false` because an animated setSize on macOS emits `resized` when it finishes.

Save and restore both use the **outer** window size (`getSize`/`setSize`), so no title-bar drift accumulates across launches. Only size is persisted, not position.

### Three rules that keep the window on-screen

Each of these was, on its own, enough to make the window open larger than the user's screen (observed on Windows):

1. **Never persist maximized bounds.** On Windows a maximized window's outer bounds include the invisible resize border — so saving them and replaying them via `setSize` on an un-maximized window yields a window wider than the display. Main tracks `lastNormalSize` and reports *that* (plus an `isMaximized` flag) in both `window:get-state` and `window:user-resized`, so un-maximizing on a later launch still lands somewhere sane.
2. **Never derive geometry from `window.screen.*`.** Those are CSS pixels — the forced 90% zoom skews them — and they describe whichever display Chromium considers current, not the one the window is on. Use `window.getWorkArea()` (DIPs, `screen.getDisplayMatching(...)`). The `window.screen` path survives only as a fallback for older installed builds.
3. **The main process clamps every `setSize`.** `window:set-size` fits the requested size into `screen.getDisplayMatching(win.getBounds()).workAreaSize` before applying it — where `win` is the **calling** window, and the floor comes from that window's record (the main window's `1024×720`, or the satellite's own minimums) — the renderer's numbers are never trusted verbatim, because a size persisted on a larger monitor, on an older build, or before a DPI change will otherwise reopen off-screen. `screen`'s `display-metrics-changed` / `display-added` / `display-removed` re-clamp mid-session (unplugging an external monitor, RDP at a lower resolution, a scaling change), skipping maximized/full-screen windows.

All four new IPCs are **optional** in `electron.d.ts` and feature-detected. On an older installed build the renderer falls back to `window.screen` for the auto-size and — lacking `onUserResized` — never persists a size at all, so it auto-sizes on every launch. That is the correct default rather than a regression: the authoritative clamp and manual-size persistence both arrive with the native update.

**Content zoom** is forced to **90%** (`webContents.setZoomFactor(0.9)`) in the app-URL branch of the `did-finish-load` handler in `main.js` — user screenshots showed screens overly zoomed in. It re-asserts on every full page load (boot, reload, crash-recovery) but not on Next.js client-side navigation (zoom is a webContents property and persists across SPA routing). A user's manual Cmd+/Cmd− is therefore reset to 90% on the next full reload, by design.

## Window load flow, offline fallback

- **Dev** (`ELECTRON_DEV=true`): loads `http://localhost:3000` directly.
- **Prod**: `loadFile(loading.html)` → on `did-finish-load` → `loadAppUrl()` (Vercel). Satellites skip the splash and load their route directly.
- `did-fail-load` (main frame, non-abort) on the app URL → `showOfflineScreen(win)` (loads `offline.html`, schedules a capped exponential-backoff retry **to that window's own route**). Successful app load clears the backoff. The offline page's button and the `online` event call `app.retryLoad()`, which is sender-scoped.
- `will-navigate` / `setWindowOpenHandler`: same-origin app navigation stays in-window; everything else is opened in the external browser via `openExternalSafe()` (**http/https/mailto only** — never `file:` or custom schemes). Renderer-initiated `file://` navigation is allowed **only** to `loading.html` / `offline.html` by exact URL — the previous blanket `file://` allowance was unnecessary and the OF window renders fan-supplied content. (`loadFile`/`loadURL` from main do not emit `will-navigate`, so this restricts pages, not us.)

## Deep-link OAuth (`bluu://`)

OAuth runs in the system browser (native `signInWithCustomToken` flow, not `signInWithPopup`). The browser redirects to `bluu://callback?code=…`; the OS hands it to the app via `open-url` (macOS) or `second-instance` argv (Windows; single-instance lock enforced). `handleDeepLink` parses the code and sends `oauth-callback`/`oauth-error` to the renderer (`src/components/Login.tsx`). If the window isn't ready, the URL is stashed and replayed on `did-finish-load`.

**Any other `bluu://` URL is a routing request the shell deliberately does not interpret.** It is parsed into `{ url, host, pathname, params }` and handed to the main window on `deeplink:route`; the renderer owns routing policy and can, for example, turn `bluu://of/chat/123` into `openSatellite(token, { path: '/of-manager/chat/123' })`. New deep-link routes therefore never need a native build. The payload is also cached and readable once via `app.getPendingDeepLink()` — same pattern as `updater:getPending`, because the URL can arrive before React mounts and the event alone would be missed.

**The renderer-side consumer is [`DeepLinkRouter`](../src/components/DeepLinkRouter.tsx)**, mounted in `(main)/layout.tsx` outside `LazyProviders` (a link can launch a cold app, and must be honoured before the lazily-imported providers arrive). It reads the pending payload on mount **and** subscribes — both intakes are required, for the reason above.

| Host | Routes to |
|---|---|
| `prompt` (`bluu://prompt?id=<promptId>`) | `/applications/apps-prompt-library?prompt=<id>` — opens the prompt's detail dialog. Fired by the public share page's "Open in Bluu Backend" ([prompt-library.md](prompt-library.md#back-into-the-app)) |

Two rules for adding a host:
- **Arm the watchdog.** These navigations are imperative, and `NavigationWatchdog`'s own listener only sees anchor clicks — call `watchNavigation(to)` before `router.push`. Same category as notification `actionUrl`s ([notifications.md](notifications.md) RULE 3).
- **Ignore unknown hosts silently.** A shell installed for weeks can emit a route this bundle has never heard of, and vice versa; doing nothing is the correct handling of both.

## Robustness (crash recovery, unresponsive)

The renderer *is* the product, so a renderer crash must not leave a blank window. All of this is applied by `attachWindowBehaviour` to **every** window, satellites included — before v0.10.0 the OF window had none of it and a Vercel hiccup left the operator with a blank window and no retry:
- `render-process-gone` → report to `/api/bugs` (via `forwardErrorToRenderer` → `bug:report`, always delivered to the main window), then auto-reload. A **per-window loop-guard** (max 3 reloads / 60s) parks on the offline screen if it keeps crashing. `clean-exit` is ignored.
- `unresponsive`/`responsive` and `child-process-gone` are logged/reported.
- Main-process `uncaughtException`/`unhandledRejection` are forwarded to `/api/bugs` too.

## Clock-out flush on app close

Time-tracking data integrity depends on the renderer completing its clock-out POST before the process dies. The **window `close` event** is the single choke-point (covers both the X button and Cmd/Ctrl-Q — `before-quit` misses the X path because the window is destroyed first). On close: `preventDefault()`, send `app-closing`, then complete the close only when the renderer calls `app.closingFlushed()` **or** a 4s hard timeout elapses. Renderer side: `TimeTrackingContext.clockOutAndFlush` runs then calls `closingFlushed()` in a `finally`. See [time-tracking.md](time-tracking.md).

## Power events → precise session boundaries

Main forwards `powerMonitor` `suspend`/`resume`/`lock-screen`/`unlock-screen` as a single `power:event` IPC. `TimeTrackingContext` transitions to **idle immediately** on `lock`/`suspend` while working (instead of waiting up to 15 min for the idle poll); the idle-resume poll returns to `working` on unlock/resume. Feature-detected — no-ops on builds that don't forward power events.

## Version reporting & the update prompt

The shell exposes its version so the fleet can be tracked and nudged:
- `app.getVersion()` → attached to `active_sessions` (at clock-in, via `/api/time-tracking/start`) and every `/api/bugs` report (via `src/lib/appVersion.ts` + `bugReporter`). Gives a live view of who is on which build.
- **Persisted per user** → `users/{uid}.appVersion` / `.appPlatform` / `.appVersionUpdatedAt`, so the build survives clock-out and is visible for users who never clock in. Written by [`AppVersionReporter`](../src/components/AppVersionReporter.tsx) (mounted in `(main)/layout.tsx`) via `POST /api/user/app-version`. **Write-on-change only:** the reporter compares `getAppInfo()` against the `useUserData()` snapshot it already has and posts nothing on a normal start-up — no extra read, and one write per update. Machine-reported, so the field is deliberately *not* on the `/api/user/update` whitelist. Surfaced in User Management → user detail, under the email.

`src/components/UpdateAvailableBanner.tsx` (in `(main)/layout.tsx`) owns every update prompt. It separates **policy** (what the user is told) from **delivery** (what the button does) — the two are decided independently, and conflating them is the easiest way to break this component.

### Policy — `src/lib/appUpdateConfig.ts` is the only gate

```ts
APP_UPDATE = {
  mac: { latestVersion, compulsory } | null,   // null → macOS never prompted
  win: { latestVersion, compulsory } | null,   // null → Windows never prompted
  downloadUrl,                                 // manual-install landing page
  releaseNote: { version } | null,             // null → nobody gets a "what's new"
}
```

- `getPlatformUpdate(platform)` maps `darwin`/`win32` onto its entry. **`null` → nothing renders at all** — that's the resting state between releases, and how you ship a mac-only release without nagging Windows (v0.8.0 is exactly this). `null` does **not** mean "optional".
- **macOS is gated by this file too.** A published GitHub release prompts nobody on its own; `mac.latestVersion` decides who is asked, `electron-updater` only supplies the artifact. If the config targets a version the updater can't see (release not published yet), the prompt is suppressed rather than showing a button that can't work.
- `compulsory: true` → blocking `AlertDialog`, no cancel. `false` → dismissible `Card` (bottom-right). Same meaning on both platforms.
- **Old builds without `app.getVersion`** can't be compared, so they're forced — but only if their platform is targeted at all. Self-resolving; guarded by `isElectron`, so a browser is never blocked.
- **`releaseNote` is the same file's mirror image**: `mac`/`win` target people who have **not** updated; `releaseNote` sends a one-off "what's new" notification to each user once their installed build reaches `version`. Not per-platform — unlike the prompt, it asks nothing of anyone. It is the one field here that is **safe to arm in the same push as the code** — it cannot fire for a build that does not exist yet. Copy lives in `notifications.releaseNote()` and must be rewritten in the same commit that bumps the version. Full mechanism: [notifications.md](notifications.md#release-notes-whats-new--gated-on-the-installed-build).

### Delivery — feature-detected, with one hard platform rule

> **macOS is NEVER given the download link.** `electron-updater` is the only sanctioned way a Mac updates. A hand reinstall over a running signed app is how users end up on the wrong architecture (the x64 `.dmg` carries no arch suffix, so Apple Silicon users land on Rosetta and then take x64 updates forever) or on a build that quietly stops auto-updating.

| Delivery | When | What the user gets |
|---|---|---|
| **auto** | `updater.getPending`/`download` present **and** an update pending | `updater.download()` → `Progress` bar from `updater:progress` → flush → restart |
| **restart** | **macOS**, targeted, nothing pending **yet** | "Bluu Backend is contacting the update server…" + a **Check again** button. **Provisional** — it polls `getPending()` and upgrades itself to `auto`. Still no download link |
| **manual** | **Windows** | Opens the config's `downloadUrl` for a hand reinstall (no valid signing cert → no auto-update there) |

The `restart` case is not an edge: the shell checks GitHub **once at start-up**, so any app that has been running since before the release shipped has nothing pending, and that is precisely the never-quits user this whole surface is trying to reach. It used to render nothing at all.

> ### `pending === null` is a "not yet", never a verdict
>
> **This is what stranded the fleet on v0.10.0 (Aug 2026).** The `restart` prompt originally *closed* the decision — it set `mode`, which is the latch — so the `updater:available` listener added for exactly this case hit the `mode !== 'none'` guard and was discarded. And a null read is the **expected** one on a slow link: the shell's check is two GitHub round trips (releases feed, then `latest-mac.yml` behind a redirect to `objects.githubusercontent.com`) racing a renderer that needs one warm Vercel call to hydrate. Every relaunch re-ran the same race at the same odds, which is why quitting and reopening — the only thing the dialog told users to do — never helped. With `compulsory: true` the app was unusable, permanently, for anyone the race went against.
>
> Worse, the advice was **untrue**: `autoDownload` and `autoInstallOnAppQuit` are both `false`, so a relaunch installs nothing on its own — it only re-runs the check. The prompt deliberately rendered **no button**, so a compulsory update on this path had no reachable action anywhere in the app.
>
> Three things now hold, all renderer-side:
> - **The restart path does not latch.** The decision effect's guard is `mode !== 'none' && delivery !== 'restart'`, so a late `updater:available` (or any clock-out) re-evaluates and can upgrade it.
> - **It polls itself out of existence** — `getPending()` every 2s for 60s, upgrading to `auto` in place; the dialog turns into a working Download button under the user. After the window expires the copy says so, and **Check again** re-polls (and calls `updater.check()` when the shell exposes it).
> - **A failed check is visible.** `updater:status` errors are registered on *every* delivery path now, not just `auto` — main only `console.error`s the check failure, so this is the only evidence a user ever gets. An app auto-launched at login before Wi-Fi is up lands here.
>
> Disarming the platform entry in `appUpdateConfig.ts` is the **emergency lever** for a fleet stuck behind this prompt, and it now clears a visible prompt without a relaunch (`setMode('none')` on the `!cfg` path).

**Known limit:** a mac build old enough to expose **no updater API at all** (pre-0.8.0) also lands on `restart`, where reopening cannot help it — that user needs a support-assisted reinstall. Check `users/{uid}.appVersion` (User Management → user detail) before assuming this population is empty.

### The never-interrupt-a-session rules

- **The only trigger condition is `displayState === 'clocked-out'`**, and it is re-checked for the **whole app session** — not latched at boot. A user mid-session at launch sees nothing (compulsory or not) and is prompted the moment they clock out. `mode !== 'none'` is the latch; `evaluatingRef` stops overlapping async runs.
- **Both** delivery paths re-check live clock state (via a ref) after their `await`s, because a slow check can resolve after the user has clocked in. Bailing is cheap now — the next clock-out re-runs the decision.
- Nothing downloads until the user clicks (`autoDownload = false`) — a background download would burn a metered connection unannounced.
- **An in-flight auto download escalates to the modal even when optional.** The app is about to restart itself; leaving a dismissible card would let the user clock in and start working underneath it. An optional download that *errors* offers "Later" so the user isn't trapped in a modal over a non-critical update.
- The dialog **does not** call `updater.removeListeners()` on unmount: that's `removeAllListeners` on shared channels and would rip out TimeTrackingContext's before-install flush handler.

### Three ways users used to escape the prompt (all closed)

The rules above are about not *over*-prompting. These were the failure modes in the other direction — a targeted user who was simply never asked. All three are renderer-side; none needed a native build.

| Escape route | Why it happened | Fix |
|---|---|---|
| **Clocked in during the check** | The decision ran two `await`s (version IPC, updater IPC) after hydration settled; the auto path bailed if the user clocked in meanwhile, and because the decision also **latched**, bailing meant never prompted that launch. | De-latched — the next clock-out re-runs it. Both paths re-check, not just auto. The window itself is small: Clock In is disabled while `isHydrating`. |
| **Never quitting the app** | Two separate staleness problems. (a) The decision was boot-only, so someone who clocks in and out for a week off one launch was asked exactly once. (b) Worse, **the config itself was stale**: Electron only picks up a new Vercel bundle on a *full page load*, so that renderer keeps evaluating the `APP_UPDATE` constant from the day it launched — arming a release could not reach it at all. | (a) Re-evaluate on every clock-out. (b) `fetchAppUpdateConfig()` reads the live policy from **`GET /api/app-update`** (no-store, shape-checked, falls back to the compiled constant when the request fails). |
| **The updater hadn't answered (macOS)** | `updater.getPending()` returns the result of the **start-up** check against GitHub. Null if that check hasn't resolved, or if the release was published after this app launched — and the code returned on null, showing nothing. The `updater:available` event *was* emitted, into a component that never listened for it. | Listen on `onAvailable` → re-evaluate when the late answer lands. And a null `pending` shows the **restart** prompt rather than silence: the version comparison has already established the user is behind. Not a download link — see the platform rule above. ⚠️ **The first version of this fix caused the v0.10.0 lockout** — the restart prompt latched, so the late answer had nothing to land in. See the callout above; the prompt is now provisional and polled. |

> **`/api/app-update` is unauthenticated by design** — it returns a public version number and the public `/download` URL, the same facts as the GitHub release, with no reads, writes or user data. `appUpdateConfig.ts` remains the single gate; the route just delivers it to a client whose bundle is older than the deploy.

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (preload only uses `contextBridge` + `ipcRenderer`), `backgroundThrottling: false` (keeps renderer timers running when minimized — critical for time-tracking).
- `openExternalSafe()` restricts `shell.openExternal` to http/https/mailto.
- `setPermissionRequestHandler` + `setPermissionCheckHandler` deny every renderer permission request except **`clipboard-sanitized-write`** (`ALLOWED_PERMISSIONS` in `main.js`); screen capture uses `desktopCapturer`, not `getUserMedia`, so it's unaffected.
  - **Do not re-broaden this to a blanket deny.** `navigator.clipboard.writeText()` routes through these handlers, so denying it breaks every "copy link"/"copy" button in the app at once, app-wide — the failure surfaces only as a `Could not copy link` toast (or, where the caller has no `catch`, as nothing at all), which makes it easy to misread as a page bug. Regression history: the blanket deny shipped in v0.7.0 and broke copy everywhere until v0.8.3.
  - `clipboard-read` stays denied. Pasting a screenshot into a composer goes through the explicit **`clipboard.readImage()`** IPC instead: image only, never text, and only on a deliberate renderer call rather than a standing capability handed to every page.
  - **Microphone/camera remain denied.** Voice messages would need `media` widened here — a native change, so decide before shipping, not after.
- **Untrusted input from the renderer** — a satellite `path` is validated (same origin, allowlisted prefix, no traversal), `download.start` accepts http(s) only, `files.showInFolder/open` accept only paths this session wrote, and save targets always come from a native dialog rather than the renderer.
- **Signing material** — `electron/build-assets/**` is **deny-by-default gitignored**; only `*.plist` and `*.png` are allowed back. The folder holds the Developer ID `.p12`, its base64 export, and the App Store Connect `.p8` — none may ever be committed. A private key was historically committed — purge from git history + rotate the cert is a pending manual follow-up.

## Screen-capture permission repair (macOS TCC, temporary)

> **Temporary migration — remove once the fleet is off pre-signing builds.** Tracked in [CLAUDE.md](../CLAUDE.md#temporary-screenshot-tcc-repair-remove-after-fleet-migrates-off-pre-signing-builds), which owns the removal checklist.

Builds before the app was Developer ID signed left a **stale ScreenCapture TCC record** keyed to the old (unsigned/ad-hoc) code identity. After signing + notarization, macOS sees a different identity for `com.bluu.app` and **re-prompts on every capture** even though the Screen Recording toggle still shows "on" — the toggle is displaying the stale record, so flipping it off/on does nothing. Only `tccutil reset` clears it.

**The renderer decides, the native side executes.** This split is deliberate — it keeps *policy* (which users, when) in the web app where the user identity lives, and *capability* in the shell:

1. **Who** — the `screenshotBugFixed` user-doc flag. Set `true` at creation in `ensureUserExists` ([userService.ts](../src/lib/services/userService.ts)); **absent/falsy on pre-existing users**, who are exactly the affected population. Read for free off the `useUserData()` snapshot (no extra Firestore I/O). New users are `true`, so they **never** trigger a reset — this is what stops a healthy install from re-granting for nothing.

   It is also **latched `true` the moment a reset fires** — from both the automatic path and the Settings button — via [`markScreenshotBugFixed.ts`](../src/lib/markScreenshotBugFixed.ts) → the `screenshotBugFixed` entry on the `/api/user/update` allowlist (server-validated as a **one-way latch**: clients may only ever set it `true`, never re-arm themselves). **This write is the once-ever cap on the automatic reset, and it is load-bearing** — see the prompt-loop regression below. It is fire-and-forget: a failed write costs at most one extra reset next session.
2. **When** — two trigger sites, both feature-detected (`?.`) so older installed builds no-op:
   - **Onboarding, macOS only** — [`onboarding/permission/screen/page.tsx`](../src/app/(main)/onboarding/permission/screen/page.tsx) fires the reset on mount, before the user grants in the Screen Recording step, so their grant registers against the signed identity. New users (a clean machine) get a harmless no-op; the point is to guarantee a clean grant for anyone whose machine carries a stale record into onboarding. The step's button also triggers a real `captureScreenshot()` on macOS (not just opening System Settings) so the OS prompt fires and the app **re-registers** in the Screen Recording list — a reset removes it until the next capture attempt, and macOS lists an app only once it has tried to capture. (The old "just open Settings" behavior was a workaround from when the app was unsigned and couldn't hold a durable grant.)
   - **Existing users** — [`TimeTrackingContext.tsx`](../src/contexts/TimeTrackingContext.tsx) fires on the **first `capture-failed`** screenshot failure (not a network failure — those are branched to a different toast), gated on `!screenshotBugFixed` and a once-per-session ref. Firing on failure **#1** (not the 3rd) lands the reset **before** the user is nudged to "enable it in OS settings" — enabling a stale record does nothing, so nudging first would send them in circles; after the reset the next prompt is clean and sticks. Already-onboarded users never revisit the onboarding step, which is why this second path exists.
   - **Manual escape hatch** — Settings → **App Settings** → "Reset Screenshot Permissions" ([`AppSettingsForm.tsx`](../src/components/settings/AppSettingsForm.tsx)). Rendered **only when `app.getPlatform()` is `darwin`**, and only when the API exists (older builds toast "please update"). The automatic paths above did not stick for every user — this lets support tell an affected user to press one button, and it can be pressed repeatedly. Its toast tells them to grant on the next screenshot prompt and then Quit & Reopen.
3. **How** — `permissions:resetScreenCapture` in `main.js` runs `tccutil reset ScreenCapture com.bluu.app`. **darwin-only**; no root needed (verified); `execFile` (no shell). **No native gate beyond the platform check** — there was a `.screencapture-tcc-reset-done` marker in `userData`, removed because it silently swallowed the Settings button for anyone whose automatic reset had already burned the one allowed run (exactly the users still broken). `tccutil reset` is idempotent; the cost of an extra run is one fresh OS prompt on the next capture, which is what every trigger site already promises the user.

### The prompt-loop regression — why the flag write exists

Removing the marker without replacing the once-ever cap put affected users into an **OS permission prompt on every app start**. The mechanism: `tccResetAttemptedRef` is only **per-session**, and `screenshotBugFixed` never changed on its own, so each launch → first capture failure → reset → the grant the user gave last launch is wiped → macOS prompts again, forever.

The cap was restored in the **renderer** (latch the flag) rather than the shell (bring back the marker), deliberately:

- **It ships instantly.** Renderer + API route only — no `electron/` change, so no build, no tag, no waiting for the fleet to update. A marker file cannot reach a user who is being prompted *today*.
- **The Settings button stays re-runnable for free.** It simply never consults the flag, so no `force` flag has to be plumbed through IPC.
- **Trade-off:** the flag is per **Bluu uid**, the marker was per **OS user**. A user on two Macs auto-resets once per *account*, not once per *machine* — their second Mac needs the Settings button. Accepted given the size of the affected population.

The flag is latched when the reset **fires**, not when it succeeds: a reset that didn't take won't take on an identical retry either, and that user is precisely who the Settings button is for.

The reset repairs the **next** scheduled capture, not the one that just failed. Residual: an affected user may still see one stale prompt on the very first capture (before the reset fires) and then the clean prompt after — acceptable, and the common case resolves before the 3-failure "Screenshot Failed" notification ever shows.

## Build & release

- Version lives in `electron/package.json` (`build.appId: com.bluu.app`).
- Scripts: `npm run dev` (localhost), `npm run pack` (unsigned `--dir` for local verification), `npm run dist` / `dist:mac` / `dist:win` (packaged installers). `dist:mac` now signs+notarizes, so it **only works with the signing env vars set** — use `pack` for local checks.

### macOS: signed, notarized, auto-updating

- **Signing/notarization** happens only in CI (`.github/workflows/build-mac.yml`), on `v*` tags. Developer ID cert via `CSC_LINK`/`CSC_KEY_PASSWORD`; notarization via the App Store Connect API key (`APPLE_API_KEY` file path + `APPLE_API_KEY_ID`/`APPLE_API_ISSUER`). `mac.notarize: true` + `hardenedRuntime: true` + the two entitlements plists in `build-assets/macos/`.
- **Both arches build in one job.** Each electron-builder run writes a `latest-mac.yml` listing only its own artifacts; splitting arm64/x64 across matrix jobs makes the second manifest clobber the first and breaks auto-update for that arch.
- **`zip` targets are required** alongside `dmg` — Squirrel.Mac downloads the zip. Dropping them silently disables auto-update.
- **Update flow** (`registerAutoUpdater` in `main.js`, darwin-only, skipped in dev): `checkForUpdates()` **once at start** → `update-available` caches `pendingUpdate` + emits `updater:available` → *(user clicks Download in the dialog)* → `updater:download` → `downloadUpdate()` → `download-progress` → `update-downloaded` sends `updater:before-install` → the renderer clocks out and flushes ([`TimeTrackingContext.tsx`](../src/contexts/TimeTrackingContext.tsx)) → `updater:ready-to-install` → `quitAndInstall()`. A 10s timeout installs anyway so a wedged renderer can't strand the update; `installUpdate()` is idempotent.
- **There is deliberately no polling interval.** An update discovered mid-session could only ever interrupt work in progress. Leave the app open for a week → you get it on next launch.
- `pendingUpdate` is cached because **the renderer mounts after the check resolves** — it reads the result via `updater:getPending` on mount rather than relying on catching the event. The event is still emitted for an already-mounted window.
- `autoDownload = false` (user-gated) and `autoInstallOnAppQuit = false` (installing on quit would bypass the flush) — both on purpose.
- The window `close` flush handler **bails out when an update install is in progress** (it already flushed); otherwise it would double-flush and its `preventDefault` can abort the install.

### Windows: manual updates

- Windows is signed only with a **self-generated** certificate, which `electron-updater` cannot validate, so auto-update is darwin-gated and the workflow is unchanged. Windows users update via the `UpdateAvailableBanner` nudge.

## Gotchas checklist

- [ ] New local runtime file (html/asset) → add it to `build.files` or it won't be in the packaged asar.
- [ ] New native IPC → type it **optional** in `src/types/electron.d.ts` and **feature-detect** in the renderer (older installed builds lack it).
- [ ] **Never close over `mainWindow` in a window-scoped handler.** Resolve the window from `event.sender`, and put per-window state on the `winRecords` record — not in a module-level variable. See [Multi-window](#multi-window-the-main-window-and-its-satellites).
- [ ] A new satellite **route** is renderer-only (any path under an allowlisted prefix). A new **prefix** needs a native build, because the prefix names the server-side access route that guards it.
- [ ] New satellite window → it inherits crash/offline handling from `attachWindowBehaviour`. Don't hand-roll a second copy.
- [ ] A notification raised from a satellite must carry `target` (or default to the sender) — routing it to `'main'` drags the operator out of the window they were working in.
- [ ] Anything that must survive app close → route it through the `close`-event flush (`closingFlushed()`), not `before-quit`.
- [ ] **A new kill switch / gate must be read over HTTP, not from a compiled-in constant.** A renderer that is never closed executes the bundle it launched with — see [Renderer staleness](#renderer-staleness-the-app-that-is-never-closed). `DeploymentRefresher` shortens that window; it does not close it, and it deliberately never fires mid-shift.
- [ ] **Timer widget: push an anchor, never a time.** `buildTimerWidgetPayload` builds it and the push lives inside `TimeTrackingProvider`. A per-second string makes the widget a copy of the timer instead of the same clock, and it freezes whenever the renderer's tick does.
- [ ] Timer widget must render **nothing** when clocked out — destroyed, not zeroed — and must **stop** (not keep counting) on idle/paused.
- [ ] The Windows HUD stays **click-through at rest** (`setIgnoreMouseEvents(true, { forward: true })`), solid only while the cursor is on it. It is draggable, but the drag is main-driven off `getCursorScreenPoint()` — the page never sends coordinates.
- [ ] A new tray glyph must be **black + alpha** and named `*Template.png`, or macOS renders it black-on-black in a dark menu bar. Add it (and its `@2x`) to `build.files`.
- [ ] Window size persists via the single `localStorage` key `bluu_window_size`, cleared on logout — keep it **non**-per-uid (reset-on-logout is the spec). Save/restore via **outer** size (`getSize`/`setSize`) to avoid title-bar drift.
- [ ] Window geometry: never persist maximized bounds, never size from `window.screen.*`, always clamp in main. See [Three rules that keep the window on-screen](#three-rules-that-keep-the-window-on-screen). Verify on a **scaled Windows display** (1920×1080 @150%) — maximize, quit, relaunch, log in.
- [ ] `shell.openExternal` only via `openExternalSafe`.
- [ ] The Electron GUI **cannot be launched from a headless env** (`require('electron')` returns the binary path → `app` undefined). Verify runtime with `npm run pack` on a real machine; `node --check` is the only automated check available.
- [ ] **Release in two pushes** — code first (platform entry `null`), then tag + build, then arm the config. Vercel is instant, the build is ~10–30 min; arming in the same push blocks users against a release that doesn't exist yet. Full command sequence: **rule 14 in [CLAUDE.md](../CLAUDE.md)**.
- [ ] **Tag the commit you just pushed.** Actions runs the workflow *from the tagged commit*, and electron-builder names the release from `electron/package.json`, not the tag. Tagging an earlier commit rebuilds the old version and republishes it to the **old** release — the run goes green and no new release appears.
- [ ] After publishing, set the **per-platform** entry in `src/lib/appUpdateConfig.ts` (`mac` / `win`). Leave a platform `null` if the release doesn't affect it — that's how you ship a mac-only build without making Windows reinstall for nothing.
- [ ] Announcing the release? Set `APP_UPDATE.releaseNote` **and rewrite `notifications.releaseNote()`'s copy in the same commit** — a bumped version pointing at the previous release's wording is the failure mode. This one may ship with the code (step 1), not at step 5.
- [ ] Verify the release has `latest-mac.yml` + **both** `.dmg` and **both** `.zip` before arming. A missing zip or manifest = auto-update silently dead. The x64 `.dmg` has **no arch suffix** (`Bluu Backend-0.8.0.dmg` is Intel) — label the download page accordingly, or Apple Silicon users end up on Rosetta and stay on x64 updates forever.
- [ ] Prefer `compulsory: false` on **Windows** for routine releases — updating there means quitting and reinstalling by hand, so blocking is a genuine interruption. macOS installs in one click, so compulsory is cheap there.
