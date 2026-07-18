// electron/main.js
const { app, BrowserWindow, session, shell, nativeImage, ipcMain, powerMonitor, powerSaveBlocker, desktopCapturer, Notification, systemPreferences } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const isDev = process.env.ELECTRON_DEV === 'true' || !app.isPackaged;
const BASE_URL = isDev ? 'http://localhost:3000' : 'https://bluu-backend.vercel.app';

// Custom protocol for OAuth callback
const PROTOCOL = 'bluu';
let mainWindow = null;
let deeplinkUrl = null; // Store deep link if it arrives before window is ready

// Register custom protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    const registered = app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    console.log(`Protocol ${PROTOCOL}:// registration (dev):`, registered);
  }
} else {
  const registered = app.setAsDefaultProtocolClient(PROTOCOL);
  console.log(`Protocol ${PROTOCOL}:// registration (prod):`, registered);
}

// Handle deep links (macOS)
app.on('open-url', (event, url) => {
  event.preventDefault();
  console.log('open-url event received:', url);

  if (mainWindow && mainWindow.webContents) {
    handleDeepLink(url);
  } else {
    // Store the URL to handle it after window is created
    deeplinkUrl = url;
    console.log('Window not ready, storing deep link for later');
  }
});

// Handle deep links (Windows)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Windows deep link handling
    const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
    if (url) {
      handleDeepLink(url);
    }

    // Focus the window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function handleDeepLink(url) {
  console.log('Deep link received:', url);

  // Focus the app window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (app.dock && process.platform === 'darwin') {
      app.dock.show();
    }
  }

  // Parse the URL to extract the authorization code
  try {
    const urlObj = new URL(url);
    console.log('Parsed URL - host:', urlObj.host, 'pathname:', urlObj.pathname, 'search:', urlObj.search);

    // In custom protocols, 'callback' becomes the host, not the pathname
    // bluu://callback?code=123 -> host: 'callback', pathname: ''
    if (urlObj.host === 'callback' || urlObj.pathname === '/callback') {
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');

      console.log('OAuth callback - code:', code ? 'present' : 'missing', 'error:', error || 'none');

      if (mainWindow && mainWindow.webContents) {
        if (error) {
          console.log('Sending oauth-error to renderer:', error);
          mainWindow.webContents.send('oauth-error', error);
        } else if (code) {
          console.log('Sending oauth-callback to renderer with code');
          mainWindow.webContents.send('oauth-callback', code);
        } else {
          console.error('No code or error in callback URL');
        }
      } else {
        console.error('mainWindow or webContents not available');
      }
    } else {
      console.log('Deep link host/pathname does not match callback. Host:', urlObj.host, 'Pathname:', urlObj.pathname);
    }
  } catch (err) {
    console.error('Error parsing deep link:', err);
  }
}

// IPC handlers for OAuth
ipcMain.handle('auth:start-google-oauth', async () => {
  const authUrl = `${BASE_URL}/auth/google`;

  // Open the browser for OAuth
  shell.openExternal(authUrl);

  return { success: true };
});

// IPC handler for idle time detection
ipcMain.handle('timeTracking:getIdleTime', () => {
  return powerMonitor.getSystemIdleTime();
});

// Activity sampling for productivity % calculation (used at each screenshot interval)
let activitySamples = [];
const SAMPLE_RETENTION_MS = 45 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  activitySamples.push({ sampleMs: now, idleSeconds: powerMonitor.getSystemIdleTime() });
  const cutoff = now - SAMPLE_RETENTION_MS;
  if (activitySamples.length > 0 && activitySamples[0].sampleMs < cutoff) {
    activitySamples = activitySamples.filter(s => s.sampleMs >= cutoff);
  }
}, 5000);

ipcMain.handle('timeTracking:getActivitySince', (_event, sinceMs) => {
  return activitySamples.filter(s => s.sampleMs >= sinceMs);
});

// IPC handler to prevent/allow display sleep based on timer state
let powerSaveBlockerId = null;
ipcMain.handle('timeTracking:setPowerSaveBlocker', (_event, enable) => {
  if (enable) {
    if (powerSaveBlockerId === null) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      console.log('[main] powerSaveBlocker started, id:', powerSaveBlockerId);
    }
  } else {
    if (powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      console.log('[main] powerSaveBlocker stopped, id:', powerSaveBlockerId);
      powerSaveBlockerId = null;
    }
  }
  return { success: true };
});

// ─── TEMPORARY: stale ScreenCapture permission repair (remove after fleet migrates) ───
//
// Builds before the app was Developer ID signed left a TCC permission record
// keyed to the old (unsigned/ad-hoc) code identity. Now that the app is signed +
// notarized, macOS sees a *different* identity for com.bluu.app and re-prompts on
// every capture even though the Screen Recording toggle shows "on" (it displays
// the stale record). A one-time `tccutil reset` clears it so the next capture
// re-prompts cleanly against the new identity, after which it sticks.
//
// The RENDERER decides when to call this (TimeTrackingContext): only for existing
// users (`screenshotBugFixed` falsy) and only on a capture — not network —
// failure, so new/healthy installs never invoke it. This handler is the native
// side of that; its own gates are:
//   1. darwin-only.
//   2. A marker file in userData caps the reset at once per OS user, ever, even
//      if the renderer calls repeatedly. Written BEFORE tccutil so a crash mid-
//      reset can't loop. userData survives app updates/reinstalls, and TCC is
//      keyed per OS-user + bundle id (not per Bluu uid) — the correct granularity
//      (it also means a second Bluu account on the same Mac won't re-reset an
//      already-fixed record).
// See the "Temporary: screenshot TCC repair" note in CLAUDE.md for removal.
ipcMain.handle('permissions:resetScreenCapture', async () => {
  if (process.platform !== 'darwin') return { success: false };

  const marker = path.join(app.getPath('userData'), '.screencapture-tcc-reset-done');
  if (fs.existsSync(marker)) return { success: false, alreadyReset: true };

  try {
    fs.writeFileSync(marker, new Date().toISOString());
  } catch (err) {
    console.error('[Screenshot] Could not write TCC reset marker — skipping one-time reset:', err.message);
    return { success: false, error: err.message };
  }

  const status = systemPreferences.getMediaAccessStatus('screen');
  try {
    await execFileAsync('tccutil', ['reset', 'ScreenCapture', 'com.bluu.app']);
    console.log(`[Screenshot] OS status "${status}" — reset stale ScreenCapture TCC record (one-time). A fresh prompt is expected on the next capture.`);
    return { success: true };
  } catch (err) {
    // Non-fatal (e.g. bundle id not registered in a dev run). Marker is already
    // written, so we won't retry.
    console.error('[Screenshot] tccutil reset failed (continuing):', err.message);
    return { success: false, error: err.message };
  }
});

// IPC handler for screenshot capture (all screens)
ipcMain.handle('timeTracking:captureScreenshot', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (sources.length === 0) {
      return { success: false, error: 'No screen sources available' };
    }

    // Capture all connected screens, filtering out empty captures
    const screens = sources
      .map(source => source.thumbnail.toPNG().toString('base64'))
      .filter(b64 => b64.length > 0);

    if (screens.length === 0) {
      return { success: false, error: 'All screen captures were empty (check screen recording permissions)' };
    }

    consecutiveEmptyCaptures = 0;
    return { success: true, screens };
  } catch (err) {
    console.error('[Screenshot] Capture failed:', err);
    return { success: false, error: err.message };
  }
});

// IPC handler for system notifications + sound
ipcMain.handle('notifications:show', async (_event, { title, body, playSound, actionUrl }) => {
  if (Notification.isSupported()) {
    const notif = new Notification({ title, body, silent: true });

    if (actionUrl && mainWindow) {
      notif.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          mainWindow.webContents.send('notification:navigate', actionUrl);
        }
      });
    }

    notif.show();
  }

  if (playSound && mainWindow) {
    mainWindow.webContents.send('notifications:play-sound');
  }

  return { success: true };
});

// IPC handler to open System Settings for screen recording access (macOS).
// On Windows, triggers a getSources call which prompts the user.
ipcMain.handle('permissions:requestScreenAccess', async () => {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    return { success: true };
  }
  try {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    return { success: true };
  } catch {
    return { success: false };
  }
});

// IPC handler to trigger a test notification (prompts OS permission on first run)
ipcMain.handle('permissions:requestNotification', async () => {
  if (Notification.isSupported()) {
    const notif = new Notification({
      title: 'Bluu Backend',
      body: 'Notifications are enabled.',
      silent: true,
    });
    notif.show();
    return { success: true };
  }
  return { success: false };
});

// IPC handler to return the current platform
ipcMain.handle('app:getPlatform', () => process.platform);

// IPC handler to return the installed app version (for fleet version tracking + update nudge)
ipcMain.handle('app:getVersion', () => app.getVersion());

// IPC handler to return the underlying runtime versions (diagnostics)
ipcMain.handle('app:getVersions', () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
}));

// IPC handler for window resizability
ipcMain.on('window:set-resizable', (_event, resizable) => {
  console.log('[Performance] IPC setResizable called:', resizable);
  if (mainWindow) {
    mainWindow.setResizable(resizable);
  }
});

// IPC handler for window size
ipcMain.on('window:set-size', (_event, width, height) => {
  if (mainWindow) {
    mainWindow.setSize(width, height, true);
    mainWindow.center();
  }
});

// IPC handler to read the current outer window size (used to persist user resizes
// without title-bar drift — getSize/setSize both operate on the outer window bounds).
ipcMain.handle('window:get-size', () => {
  if (mainWindow) {
    return mainWindow.getSize();
  }
  return null;
});

// Renderer signals that React has mounted and is ready.
// Re-registered on each page load so we always catch the first mount.
function registerAppReadyHandler() {
  ipcMain.once('app:ready', () => {
    console.log('[main] app:ready received — React mounted');
  });
}
registerAppReadyHandler();

// Only ever hand http(s)/mailto URLs to the OS. A compromised or redirected
// page must never be able to invoke shell.openExternal with file://, custom
// schemes, etc.
function openExternalSafe(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      shell.openExternal(url);
      return;
    }
  } catch {
    // fall through to the block-and-log below
  }
  console.warn('[main] Blocked openExternal for unsafe/invalid URL:', url);
}

// ─── App load + offline fallback ─────────────────────────────────────
// The renderer IS the product (hosted on Vercel). If it fails to load we
// show a branded offline screen and retry with backoff instead of leaving
// the raw Chrome error page (or a blank window) on screen.
let offlineRetryTimer = null;
let offlineRetryDelay = 2000;
const OFFLINE_RETRY_MAX = 30000;

function clearOfflineRetry() {
  if (offlineRetryTimer) {
    clearTimeout(offlineRetryTimer);
    offlineRetryTimer = null;
  }
  offlineRetryDelay = 2000;
}

function loadAppUrl() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearOfflineRetry();
  mainWindow.loadURL(BASE_URL);
}

function showOfflineScreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
  // Auto-retry with capped exponential backoff; the offline page also has a
  // manual "Try again" button (app:retry-load).
  if (!offlineRetryTimer) {
    offlineRetryTimer = setTimeout(() => {
      offlineRetryTimer = null;
      loadAppUrl();
    }, offlineRetryDelay);
    offlineRetryDelay = Math.min(offlineRetryDelay * 2, OFFLINE_RETRY_MAX);
  }
}

ipcMain.on('app:retry-load', () => loadAppUrl());

// Renderer-crash reload loop-guard: if the renderer keeps dying we stop
// auto-reloading and park on the offline/error screen.
let reloadCount = 0;
let reloadWindowStart = Date.now();
const RELOAD_WINDOW_MS = 60000;
const RELOAD_MAX = 3;

// Max time to hold the window close while the renderer clocks out and flushes.
const QUIT_FLUSH_TIMEOUT_MS = 4000;

function createWindow() {
  // Set app icon for macOS dock
  const iconPath = path.join(__dirname, './public/logo/icon.icns');
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(iconPath);
    app.dock.setIcon(image);
  }

  mainWindow = new BrowserWindow({
    width: 1430,
    height: 870,
    minWidth: 1024,    // Floor so a resized window can't break the UI (only applies once resizable)
    minHeight: 720,
    resizable: false,  // Start with window locked (login page)
    show: true,
    backgroundColor: '#002333',     // Match your logo's dark background
    icon: iconPath,  // App icon for window
    title: `Bluu Backend (${app.getVersion()})`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,     // important for security
      nodeIntegration: false,     // important for security
      sandbox: true,              // harden the renderer (preload only uses contextBridge + ipcRenderer)
      backgroundThrottling: false, // keep renderer timers (heartbeat, idle checks, screenshot scheduler) running when minimized
      v8CacheOptions: 'code',  // Enable V8 code caching for faster startup
    },
  });

  // In dev, load local Next.js
  if (isDev) {
    mainWindow.loadURL(BASE_URL);
    // mainWindow.webContents.openDevTools();
  } else {
    // Show local loading screen instantly, then navigate to the hosted app once it's ready
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));
    mainWindow.webContents.once('did-finish-load', () => {
      loadAppUrl();
    });
  }

  // Open external links (target=_blank) in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });

  // Prevent navigation to other origins from the electron window
  mainWindow.webContents.on('will-navigate', (e, url) => {
    // Allow same-origin app navigation and our local loading/offline pages.
    if (url.startsWith(BASE_URL) || url.startsWith('file://')) return;
    e.preventDefault();
    openExternalSafe(url);
  });

  // On a real load failure of the app URL, show the offline screen and retry
  // with backoff. Ignore sub-frame failures and user-aborted loads (-3).
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (validatedURL.startsWith(BASE_URL)) {
      console.log(`[main] did-fail-load (${errorCode}) for ${validatedURL} — showing offline screen`);
      showOfflineScreen();
    }
  });

  // Successful app load — reset the offline backoff.
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.getURL().startsWith(BASE_URL)) {
      clearOfflineRetry();
      // Default the app to 90% zoom — screenshots showed users' screens overly zoomed in.
      mainWindow.webContents.setZoomFactor(0.9);
    }

    if (deeplinkUrl) {
      console.log('Processing stored deep link:', deeplinkUrl);
      handleDeepLink(deeplinkUrl);
      deeplinkUrl = null;
    }
    // Re-register so each new page load gets a fresh app:ready listener
    ipcMain.removeAllListeners('app:ready');
    registerAppReadyHandler();
  });

  // ─── Renderer crash recovery ───────────────────────────────────────
  // The renderer is the whole product; a crash otherwise leaves a blank
  // window. Auto-reload with a loop-guard, and report to /api/bugs.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] render-process-gone:', details.reason, details.exitCode);
    forwardErrorToRenderer(
      'electron:main:render-process-gone',
      `Renderer gone: ${details.reason} (exit ${details.exitCode})`,
      undefined,
    );
    // A clean exit isn't a crash.
    if (details.reason === 'clean-exit') return;

    const now = Date.now();
    if (now - reloadWindowStart > RELOAD_WINDOW_MS) {
      reloadWindowStart = now;
      reloadCount = 0;
    }
    reloadCount += 1;

    if (reloadCount > RELOAD_MAX) {
      console.error('[main] renderer crashed too many times — parking on offline screen');
      showOfflineScreen();
      return;
    }
    setTimeout(() => loadAppUrl(), 500);
  });

  mainWindow.webContents.on('child-process-gone', (_e, details) => {
    console.error('[main] child-process-gone:', details.type, details.reason);
  });

  // ─── Unresponsive detection ────────────────────────────────────────
  mainWindow.on('unresponsive', () => {
    console.warn('[main] window became unresponsive');
    forwardErrorToRenderer('electron:main:unresponsive', 'Renderer became unresponsive', undefined);
  });
  mainWindow.on('responsive', () => {
    console.log('[main] window became responsive again');
  });

  // ─── Flush time-tracking before the window closes ──────────────────
  // The window `close` event is the single choke-point that fires for BOTH the
  // X button (window-all-closed → quit) and Cmd/Ctrl-Q. Hold the close until the
  // renderer clocks out and acks ('app:closing-flushed'), or a hard timeout
  // elapses — otherwise the async clock-out POST is killed mid-flight.
  let closeFlushed = false;
  mainWindow.on('close', (e) => {
    if (closeFlushed) return; // second pass — allow the close to proceed
    // The auto-update path already flushed via 'updater:before-install'. Vetoing
    // this close would flush twice and can abort the pending Squirrel install.
    if (updateInstallStarted) return;
    const wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) return;

    e.preventDefault();
    wc.send('app-closing');

    const finish = () => {
      closeFlushed = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    };
    const timer = setTimeout(finish, QUIT_FLUSH_TIMEOUT_MS);
    ipcMain.once('app:closing-flushed', () => {
      clearTimeout(timer);
      finish();
    });
  });

  return mainWindow;
}

// ─── Auto-update (macOS only) ───────────────────────────────────────────
// macOS builds are Developer ID signed + notarized, so Squirrel.Mac can verify
// and install updates in place. Windows builds are signed only with a
// self-generated certificate, which the updater cannot validate, so Windows
// users keep updating manually via the version-gated renderer banner (it
// compares app:getVersion against APP_UPDATE.latestVersion).
//
// The check runs ONCE, at app start. There is deliberately no polling interval:
// an update found mid-session could only ever interrupt work in progress. A user
// who leaves the app open for a week simply picks the update up on next launch.
const AUTO_UPDATE_SUPPORTED = process.platform === 'darwin';
const INSTALL_FLUSH_TIMEOUT_MS = 10000;

let updateInstallStarted = false;
// Set when the start-up check finds an update. The renderer mounts after this
// fires, so the event alone would be missed — it reads this via
// 'updater:getPending' on mount and we also push the event for a mounted window.
let pendingUpdate = null;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Quit into the installer exactly once, whether the renderer flushed in time or
// the timeout fired. A double call would race two Squirrel installs.
function installUpdate() {
  if (updateInstallStarted) return;
  updateInstallStarted = true;
  autoUpdater.quitAndInstall();
}

function registerAutoUpdater() {
  if (!AUTO_UPDATE_SUPPORTED || isDev) return;

  // Nothing downloads until the user presses "Download update" in the renderer
  // dialog: a background download would burn a metered connection unannounced.
  autoUpdater.autoDownload = false;
  // The renderer must clock the user out and flush buffered time-tracking
  // events before the app restarts, so never install silently on quit.
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    pendingUpdate = { version: (info && info.version) || null };
    sendToRenderer('updater:available', pendingUpdate);
  });

  autoUpdater.on('download-progress', (p) => {
    sendToRenderer('updater:progress', {
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
      total: p.total,
      transferred: p.transferred,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    // Give the renderer a bounded window to flush the open session, then
    // install regardless so a wedged renderer can't strand the update.
    const timer = setTimeout(installUpdate, INSTALL_FLUSH_TIMEOUT_MS);
    ipcMain.once('updater:ready-to-install', () => {
      clearTimeout(timer);
      installUpdate();
    });
    sendToRenderer('updater:before-install');
  });

  autoUpdater.on('error', (err) => {
    console.error('autoUpdater error:', err);
    sendToRenderer('updater:status', { status: 'error', message: err && err.message });
  });

  // The renderer mounts well after this resolves; it reads the outcome from
  // 'updater:getPending' rather than relying on catching the event.
  ipcMain.handle('updater:getPending', () => pendingUpdate);

  ipcMain.on('updater:download', () => {
    if (!pendingUpdate) return;
    autoUpdater.downloadUpdate().catch((err) => {
      console.error('Update download failed:', err);
      sendToRenderer('updater:status', { status: 'error', message: err && err.message });
    });
  });

  autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err));
}

// Forward native power/session transitions to the renderer so time-tracking can
// pause/resume precisely (more accurate than the 15-min idle threshold) and so
// lock/unlock patterns can be recorded.
function forwardPowerEvent(name) {
  sendToRenderer('power:event', { event: name, at: Date.now() });
}

function registerPowerListeners() {
  powerMonitor.on('suspend', () => forwardPowerEvent('suspend'));
  powerMonitor.on('resume', () => forwardPowerEvent('resume'));
  powerMonitor.on('lock-screen', () => forwardPowerEvent('lock'));
  powerMonitor.on('unlock-screen', () => forwardPowerEvent('unlock'));
}

app.whenReady().then(() => {
  // Deny renderer permission requests we never need (geolocation, camera,
  // microphone, etc.). Screen capture goes through desktopCapturer, not
  // getUserMedia, so it is unaffected.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  registerPowerListeners();
  registerAutoUpdater();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Forward main-process errors to the renderer so they reach the /api/bugs route
function forwardErrorToRenderer(context, message, stack) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('bug:report', { context, message, stack });
  }
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
  forwardErrorToRenderer('electron:main:uncaughtException', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  console.error('[main] unhandledRejection:', reason);
  forwardErrorToRenderer('electron:main:unhandledRejection', message, stack);
});

// Quit on all windows closed (including macOS). The time-tracking flush happens
// in the window `close` handler (createWindow), which is the single choke-point
// for both the X button and Cmd/Ctrl-Q.
app.on('window-all-closed', () => {
  app.quit();
});
