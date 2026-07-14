# Electron Desktop Shell

Spoke for the `electron/` desktop wrapper. Read this before changing anything in `electron/main.js`, `electron/preload.js`, the build config, or any renderer code that calls `window.electronAPI`.

## What it is

A **thin Electron shell that loads the hosted Next.js web app** (`https://bluu-backend.vercel.app`). It bundles almost no app code — the web app itself is served from Vercel. The shell exists to give employees a desktop app with native capabilities the browser can't offer (OS idle detection, screen capture, native notifications, deep-link OAuth) and to gate the app to desktop-only (`src/middleware.ts` admits requests whose UA contains `Electron/`).

### The core constraint: two update channels
- **Renderer (the web app) updates instantly** via Vercel. Anything in `src/` reaches users on next load.
- **The native shell only changes when a user manually reinstalls the build.** The app is **not code-signed/notarized**, so `electron-updater` auto-install is disabled. Pushes are rare.

**Implication for every change:** put capability + robustness in the native shell (`electron/`), keep *policy* in the renderer (`src/`). New native APIs must be **feature-detected** on the renderer side (`window.electronAPI?.x?.y`) so the renderer keeps working on older installed builds and can light up new behavior as users update. See the version-gated update nudge below.

## Files

| File | Purpose |
|---|---|
| `electron/main.js` | Main process: window creation, IPC handlers, deep-link OAuth, crash recovery, offline fallback, power events, lifecycle. |
| `electron/preload.js` | `contextBridge` — exposes `window.electronAPI` to the renderer. The **only** bridge between renderer and main. |
| `electron/loading.html` | Local splash shown instantly on launch (logo inlined as data-URI), then the app navigates to Vercel. |
| `electron/offline.html` | Local retry screen shown when the Vercel app can't load (logo data-URI + "Try again" button → `app:retry-load`). |
| `electron/package.json` | App version, npm scripts, and the full `electron-builder` config (incl. the `build.files` allowlist). |
| `electron/public/logo/*` | App icons (`icon.icns`, `icon.ico`). |
| `electron/public/*.mp3` | Notification sound (played in the renderer). |
| `electron/build-assets/` | NSIS installer background. Signing key/cert are **gitignored** (see Security). |

> **`build.files` is an allowlist.** Any local file the main process loads at runtime (e.g. `loading.html`, `offline.html`) **must** be listed there or it won't be in the packaged `app.asar`. A missing file → `loadFile` fails silently. This has bitten us before.

## IPC surface

All renderer↔main communication goes through `preload.js` → `window.electronAPI`. Types live in `src/types/electron.d.ts` (new/optional APIs are typed `?:` because older builds lack them). Renderer must always feature-detect.

| `electronAPI.*` | Direction | Main handler | Notes |
|---|---|---|---|
| `auth.startGoogleOAuth()` | invoke | `auth:start-google-oauth` | opens `/auth/google` in the external browser |
| `auth.onOAuthCallback/onOAuthError` | main→renderer | — | fired from the `bluu://` deep-link handler |
| `window.setResizable/setSize` | send | `window:set-*` | resize the desktop window (login vs app); `setSize` re-centers |
| `window.getSize()` | invoke | `window:get-size` | current **outer** window size `[w,h]`; used to persist user resizes without title-bar drift |
| `timeTracking.getIdleTime()` | invoke | `timeTracking:getIdleTime` | `powerMonitor.getSystemIdleTime()` |
| `timeTracking.getActivitySince(sinceMs)` | invoke | `timeTracking:getActivitySince` | 5s idle-time samples (45-min rolling buffer) for accurate activity % |
| `timeTracking.captureScreenshot()` | invoke | `timeTracking:captureScreenshot` | `desktopCapturer`, all screens → base64 PNGs |
| `timeTracking.setPowerSaveBlocker(bool)` | invoke | `timeTracking:setPowerSaveBlocker` | keep display awake while working |
| `notifications.show(opts)` | invoke | `notifications:show` | native `Notification` + optional renderer sound/navigate |
| `permissions.requestScreenAccess/requestNotification` | invoke | `permissions:*` | OS permission prompts |
| `app.getPlatform()` | invoke | `app:getPlatform` | `process.platform` |
| `app.getVersion()` / `getVersions()` | invoke | `app:getVersion` / `app:getVersions` | fleet version reporting + update nudge |
| `app.signalReady()` | send | `app:ready` | renderer signals React mounted |
| `app.closingFlushed()` | send | `app:closing-flushed` | renderer acks it finished flushing on close (see Clock-out flush) |
| `app.retryLoad()` | send | `app:retry-load` | offline screen "Try again" |
| `power.onEvent(cb)` | main→renderer | — | native `suspend`/`resume`/`lock`/`unlock` (see Power events) |
| `bugs.onReport(cb)` | main→renderer | — | main-process errors forwarded so renderer POSTs `/api/bugs` |
| `updater.*` | main→renderer | — | retained but inert (auto-update disabled) |

## Window sizing & persistence

The window opens at a fixed `1430×870`, `resizable:false` for the login page (`minWidth/minHeight` `1024×720` guard once resizing is enabled). Sizing **policy lives in the renderer** — [`src/lib/windowSize.ts`](../src/lib/windowSize.ts) + the login/logout effect in [`src/components/AuthWrapper.tsx`](../src/components/AuthWrapper.tsx):

- **On login**, it restores the remembered size, or — when there is none — sizes the window to **85% width × 80% height** of the display work area (`window.screen.availWidth/availHeight`, clamped to the min).
- **On resize** (logged in), the debounced handler reads the true outer size via `window.getSize()` and saves it to a single `localStorage` key `bluu_window_size`.
- **On logout**, the key is cleared, so the next login re-runs the dynamic 85/80 sizing. The key is intentionally **not** per-uid: forgetting on logout is the spec, and a shared key cleared at logout is the exact implementation (this also covers the `revoked`/`displaced` forced sign-outs, which flip login state through the same effect).

Save and restore both use the **outer** window size (`getSize`/`setSize`), so no title-bar drift accumulates across launches. Only size is persisted, not position.

## Window load flow, offline fallback

- **Dev** (`ELECTRON_DEV=true`): loads `http://localhost:3000` directly.
- **Prod**: `loadFile(loading.html)` → on `did-finish-load` → `loadAppUrl()` (Vercel).
- `did-fail-load` (main frame, non-abort) on the app URL → `showOfflineScreen()` (loads `offline.html`, schedules a capped exponential-backoff retry). Successful app load clears the backoff. The offline page's button and the `online` event call `app.retryLoad()`.
- `will-navigate` / `setWindowOpenHandler`: same-origin app navigation stays in-window; everything else is opened in the external browser via `openExternalSafe()` (**http/https/mailto only** — never `file:` or custom schemes).

## Deep-link OAuth (`bluu://`)

OAuth runs in the system browser (native `signInWithCustomToken` flow, not `signInWithPopup`). The browser redirects to `bluu://callback?code=…`; the OS hands it to the app via `open-url` (macOS) or `second-instance` argv (Windows; single-instance lock enforced). `handleDeepLink` parses the code and sends `oauth-callback`/`oauth-error` to the renderer (`src/components/Login.tsx`). If the window isn't ready, the URL is stashed and replayed on `did-finish-load`.

## Robustness (crash recovery, unresponsive)

The renderer *is* the product, so a renderer crash must not leave a blank window:
- `render-process-gone` → report to `/api/bugs` (via `forwardErrorToRenderer` → `bug:report`), then auto-reload. A **loop-guard** (max 3 reloads / 60s) parks on the offline screen if it keeps crashing. `clean-exit` is ignored.
- `unresponsive`/`responsive` and `child-process-gone` are logged/reported.
- Main-process `uncaughtException`/`unhandledRejection` are forwarded to `/api/bugs` too.

## Clock-out flush on app close

Time-tracking data integrity depends on the renderer completing its clock-out POST before the process dies. The **window `close` event** is the single choke-point (covers both the X button and Cmd/Ctrl-Q — `before-quit` misses the X path because the window is destroyed first). On close: `preventDefault()`, send `app-closing`, then complete the close only when the renderer calls `app.closingFlushed()` **or** a 4s hard timeout elapses. Renderer side: `TimeTrackingContext.clockOutAndFlush` runs then calls `closingFlushed()` in a `finally`. See [time-tracking.md](time-tracking.md).

## Power events → precise session boundaries

Main forwards `powerMonitor` `suspend`/`resume`/`lock-screen`/`unlock-screen` as a single `power:event` IPC. `TimeTrackingContext` transitions to **idle immediately** on `lock`/`suspend` while working (instead of waiting up to 15 min for the idle poll); the idle-resume poll returns to `working` on unlock/resume. Feature-detected — no-ops on builds that don't forward power events.

## Version reporting & the update nudge

Because updates are manual, the shell exposes its version so the fleet can be tracked and nudged:
- `app.getVersion()` → attached to `active_sessions` (at clock-in, via `/api/time-tracking/start`) and every `/api/bugs` report (via `src/lib/appVersion.ts` + `bugReporter`). Gives a live view of who is on which build.
- **Update prompt** (`src/components/UpdateAvailableBanner.tsx`, in `(main)/layout.tsx`): compares native `getVersion()` against the code constant **`src/lib/appUpdateConfig.ts`** (`APP_UPDATE = { latestVersion, downloadUrl, compulsory }`). Edit that one file + deploy (Vercel is instant) to announce a build. Two modes:
  - **`compulsory: true`** → a **blocking** shadcn `AlertDialog` ("Update required — important security and app improvements") with no cancel; the user can't navigate or use the app until they update. **Start-up only** and never mid-session: the constant is baked into the bundle the window loaded at launch, so a mid-session publish can't reach a running window; and it only engages when the user is **clocked-out** at start-up, so an active session (e.g. after a crash-reload) is never interrupted — they're blocked at the next launch instead.
  - **`compulsory: false`** → a **dismissible** shadcn `Card` prompt (bottom-right). Re-appears on next start-up, or when the user clocks out (the `bluu:clocked-out` window event dispatched from `TimeTrackingContext.stopTracking`).
  - **Old builds without `app.getVersion`** are treated as a **compulsory** update regardless of the constant — this bootstraps the whole fleet onto a readable version, then self-resolves (once every client exposes `getVersion`, the branch never fires again). Guarded by `window.electronAPI?.isElectron`, so a browser is never blocked.
  - Decision is **latched once** per app start-up, after `isHydrating` settles (so clock state is known). Only renders inside Electron.

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (preload only uses `contextBridge` + `ipcRenderer`), `backgroundThrottling: false` (keeps renderer timers running when minimized — critical for time-tracking).
- `openExternalSafe()` restricts `shell.openExternal` to http/https/mailto.
- `setPermissionRequestHandler` denies all renderer permission requests (geolocation/camera/mic/etc.); screen capture uses `desktopCapturer`, not `getUserMedia`, so it's unaffected.
- **Signing material** (`electron/build-assets/*.key`/`*.pfx`/`*.crt`/`*.cer`) is **gitignored** and untracked. A private key was historically committed — purge from git history + rotate the cert is a pending manual follow-up.

## Build & release

- Version lives in `electron/package.json` (`build.appId: com.bluu.app`). macOS uses ad-hoc signing (`identity: "-"`); Windows NSIS one-click.
- Scripts: `npm run dev` (localhost), `npm run pack` (unsigned `--dir` for local verification), `npm run dist` / `dist:mac` / `dist:win` (packaged installers).
- Auto-update (`electron-updater`, GitHub provider) is **intentionally disabled** — the code path and the preload `updater` surface are retained for the day signing is added.

## Gotchas checklist

- [ ] New local runtime file (html/asset) → add it to `build.files` or it won't be in the packaged asar.
- [ ] New native IPC → type it **optional** in `src/types/electron.d.ts` and **feature-detect** in the renderer (older installed builds lack it).
- [ ] Anything that must survive app close → route it through the `close`-event flush (`closingFlushed()`), not `before-quit`.
- [ ] Window size persists via the single `localStorage` key `bluu_window_size`, cleared on logout — keep it **non**-per-uid (reset-on-logout is the spec). Save/restore via **outer** size (`getSize`/`setSize`) to avoid title-bar drift.
- [ ] `shell.openExternal` only via `openExternalSafe`.
- [ ] The Electron GUI **cannot be launched from a headless env** (`require('electron')` returns the binary path → `app` undefined). Verify runtime with `npm run pack` on a real machine; `node --check` is the only automated check available.
- [ ] After publishing a native build, bump `latestVersion` (and `downloadUrl`/`compulsory`) in `src/lib/appUpdateConfig.ts` and deploy so the update prompt fires.
