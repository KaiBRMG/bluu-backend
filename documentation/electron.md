# Electron Desktop Shell

Spoke for the `electron/` desktop wrapper. Read this before changing anything in `electron/main.js`, `electron/preload.js`, the build config, or any renderer code that calls `window.electronAPI`.

## What it is

A **thin Electron shell that loads the hosted Next.js web app** (`https://bluu-backend.vercel.app`). It bundles almost no app code — the web app itself is served from Vercel. The shell exists to give employees a desktop app with native capabilities the browser can't offer (OS idle detection, screen capture, native notifications, deep-link OAuth) and to gate the app to desktop-only (`src/middleware.ts` admits requests whose UA contains `Electron/`).

### The core constraint: two update channels
- **Renderer (the web app) updates instantly** via Vercel. Anything in `src/` reaches users on next load.
- **The native shell updates per-platform.** **macOS** builds are Developer ID signed + notarized, so `electron-updater` installs them in-app — checked **once at app start**, never mid-session. **Windows** has no real signing cert, so those users must manually reinstall; they're nudged by the version-gated banner. Pushes are rare either way, and a mac user only picks one up when they **restart the app while clocked out** — so **never assume a given native version is deployed**.

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
| `updater.getPending()` | invoke | `updater:getPending` | result of the start-up check (`{version}` or null); **v0.8.0+ — feature-detect** |
| `updater.download()` | send | `updater:download` | begin download; only ever from an explicit user click. **v0.8.0+** |
| `updater.onAvailable/onProgress/onStatus/onBeforeInstall`, `readyToInstall()` | both | `updater:*` | live on macOS; inert on Windows (auto-update is darwin-gated) |

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

## Version reporting & the update prompt

The shell exposes its version so the fleet can be tracked and nudged:
- `app.getVersion()` → attached to `active_sessions` (at clock-in, via `/api/time-tracking/start`) and every `/api/bugs` report (via `src/lib/appVersion.ts` + `bugReporter`). Gives a live view of who is on which build.

`src/components/UpdateAvailableBanner.tsx` (in `(main)/layout.tsx`) owns every update prompt. It separates **policy** (what the user is told) from **delivery** (what the button does) — the two are decided independently, and conflating them is the easiest way to break this component.

### Policy — `src/lib/appUpdateConfig.ts` is the only gate

```ts
APP_UPDATE = {
  mac: { latestVersion, compulsory } | null,   // null → macOS never prompted
  win: { latestVersion, compulsory } | null,   // null → Windows never prompted
  downloadUrl,                                 // manual-install landing page
}
```

- `getPlatformUpdate(platform)` maps `darwin`/`win32` onto its entry. **`null` → nothing renders at all** — that's the resting state between releases, and how you ship a mac-only release without nagging Windows (v0.8.0 is exactly this). `null` does **not** mean "optional".
- **macOS is gated by this file too.** A published GitHub release prompts nobody on its own; `mac.latestVersion` decides who is asked, `electron-updater` only supplies the artifact. If the config targets a version the updater can't see (release not published yet), the prompt is suppressed rather than showing a button that can't work.
- `compulsory: true` → blocking `AlertDialog`, no cancel. `false` → dismissible `Card` (bottom-right). Same meaning on both platforms.
- **Old builds without `app.getVersion`** can't be compared, so they're forced — but only if their platform is targeted at all. Self-resolving; guarded by `isElectron`, so a browser is never blocked.

### Delivery — feature-detected, never platform-checked

`updater.getPending` present (macOS v0.8.0+) → **auto**: `updater.download()` → `Progress` bar from `updater:progress` → flush → restart. Absent (Windows, or any pre-0.8.0 build, which shipped no updater) → **manual**: opens `APP_UPDATE.downloadUrl`.

Detecting the capability rather than branching on `win32` is deliberate: a pre-0.8.0 mac build would otherwise get an auto button with no updater behind it. It self-resolves as the fleet moves to 0.8.0+.

### The never-interrupt-a-session rules

- The decision **latches once** per app start, after `isHydrating` settles, and **returns early unless the user is clocked OUT** at that moment. A user mid-session at launch sees **nothing at all** — compulsory or not — until their next launch.
- The auto path **re-checks live clock state** (via a ref) before offering, because a slow start-up check can resolve after the user has clocked in.
- Nothing downloads until the user clicks (`autoDownload = false`) — a background download would burn a metered connection unannounced.
- **An in-flight auto download escalates to the modal even when optional.** The app is about to restart itself; leaving a dismissible card would let the user clock in and start working underneath it. An optional download that *errors* offers "Later" so the user isn't trapped in a modal over a non-critical update.
- The dialog **does not** call `updater.removeListeners()` on unmount: that's `removeAllListeners` on shared channels and would rip out TimeTrackingContext's before-install flush handler.

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (preload only uses `contextBridge` + `ipcRenderer`), `backgroundThrottling: false` (keeps renderer timers running when minimized — critical for time-tracking).
- `openExternalSafe()` restricts `shell.openExternal` to http/https/mailto.
- `setPermissionRequestHandler` denies all renderer permission requests (geolocation/camera/mic/etc.); screen capture uses `desktopCapturer`, not `getUserMedia`, so it's unaffected.
- **Signing material** — `electron/build-assets/**` is **deny-by-default gitignored**; only `*.plist` and `*.png` are allowed back. The folder holds the Developer ID `.p12`, its base64 export, and the App Store Connect `.p8` — none may ever be committed. A private key was historically committed — purge from git history + rotate the cert is a pending manual follow-up.

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
- [ ] Anything that must survive app close → route it through the `close`-event flush (`closingFlushed()`), not `before-quit`.
- [ ] Window size persists via the single `localStorage` key `bluu_window_size`, cleared on logout — keep it **non**-per-uid (reset-on-logout is the spec). Save/restore via **outer** size (`getSize`/`setSize`) to avoid title-bar drift.
- [ ] `shell.openExternal` only via `openExternalSafe`.
- [ ] The Electron GUI **cannot be launched from a headless env** (`require('electron')` returns the binary path → `app` undefined). Verify runtime with `npm run pack` on a real machine; `node --check` is the only automated check available.
- [ ] After publishing a native build, set the **per-platform** entry in `src/lib/appUpdateConfig.ts` (`mac` / `win`) and deploy. Leave a platform `null` if the release doesn't affect it — that's how you ship a mac-only build without making Windows reinstall for nothing.
- [ ] Bump `latestVersion` only **after** the artifacts are live (and `downloadUrl` serves the new installer), or `compulsory: true` blocks users on a build they can't obtain.
- [ ] Prefer `compulsory: false` on **Windows** for routine releases — updating there means quitting and reinstalling by hand, so blocking is a genuine interruption. macOS installs in one click, so compulsory is cheap there.
