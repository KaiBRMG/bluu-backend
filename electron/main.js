// electron/main.js
const { app, BrowserWindow, session, shell, nativeImage, ipcMain, powerMonitor, powerSaveBlocker, desktopCapturer, Notification, systemPreferences, Menu, Tray, clipboard, dialog, screen: electronScreen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fsp = require('fs/promises');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const isDev = process.env.ELECTRON_DEV === 'true' || !app.isPackaged;
const BASE_URL = isDev ? 'http://localhost:3000' : 'https://bluu-backend.vercel.app';
const BASE_ORIGIN = new URL(BASE_URL).origin;

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

// ─── Window plumbing shared by the main window and every satellite ────
// Everything below is deliberately window-agnostic. Handlers resolve the window
// from `event.sender` rather than closing over `mainWindow`, so a satellite that
// calls window.setSize() resizes *itself* — the single most important property
// of this file now that more than one window exists. See documentation/electron.md.

// win.id -> per-window record (geometry floors, offline backoff, crash counters)
const winRecords = new Map();

function sendTo(win, channel, payload) {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function senderWindow(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && !win.isDestroyed() ? win : null;
}

function recordFor(win) {
  if (!win || win.isDestroyed()) return null;
  return winRecords.get(win.id) || null;
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

// A non-OAuth deep link the renderer has not collected yet. Same pattern as
// `updater:getPending`: the event alone is unreliable because the renderer may
// mount *after* the URL arrives, so the payload is also readable on demand.
let pendingDeepLinkRoute = null;

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
      return;
    }

    // Any other bluu:// URL is a routing request. The shell deliberately does not
    // interpret it — it hands the parsed parts to the renderer, which owns routing
    // policy and can (for example) turn bluu://of/chat/123 into a satellite window.
    // Adding a new deep-link route therefore never needs a native build.
    const params = {};
    urlObj.searchParams.forEach((value, key) => { params[key] = value; });
    pendingDeepLinkRoute = { url, host: urlObj.host, pathname: urlObj.pathname, params, at: Date.now() };
    sendTo(mainWindow, 'deeplink:route', pendingDeepLinkRoute);
  } catch (err) {
    console.error('Error parsing deep link:', err);
  }
}

ipcMain.handle('app:getPendingDeepLink', () => {
  const route = pendingDeepLinkRoute;
  pendingDeepLinkRoute = null;
  return route;
});

// IPC handlers for OAuth
ipcMain.handle('auth:start-google-oauth', async () => {
  const authUrl = `${BASE_URL}/auth/google`;

  // Open the browser for OAuth
  shell.openExternal(authUrl);

  return { success: true };
});

// ─── Time tracking ───────────────────────────────────────────────────
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

// ─── Always-visible session timer (macOS tray title / Windows docked HUD) ───
//
// The renderer owns the tracker; this owns the *display*. The renderer pushes
// only on a state transition, and what it pushes is an ANCHOR — `baseSeconds`
// plus the wall-clock instant that base was true — not a formatted time. The
// tick below re-derives the number every second with the identical arithmetic
// TimeTrackingContext runs, so the widget and the time-tracking page cannot
// drift apart, and a renderer whose own 1s tick is starved by a heavy page load
// still shows a correct clock. See src/lib/timerWidget.ts for the other half.
//
// Per platform:
//   • darwin — Tray.setTitle (macOS-only API) + a template icon per state.
//   • win32  — a small frameless, transparent, click-through HUD pinned to the
//              bottom-right of the work area, which is exactly "just above the
//              system tray" (workArea already excludes the taskbar).
//   • other  — ignored; there is no equivalent surface.
const TIMER_WIDGET_STATES = new Set(['working', 'idle', 'on-break', 'paused']);
const TIMER_WIDGET_MODES = new Set(['count-up', 'count-down', 'frozen']);

// Template PNGs rendered from the very lucide glyphs STATE_CONFIG uses on the
// time-tracking page (ClockCheck / ClockAlert / Coffee / CirclePause).
const TRAY_ICON_BASENAME = {
  working: 'working',
  idle: 'idle',
  'on-break': 'break',
  paused: 'paused',
};

const TIMER_WIDGET_PAGE = path.join(__dirname, 'widget.html');
const TIMER_WIDGET_PAGE_URL = pathToFileURL(TIMER_WIDGET_PAGE).href;
const TIMER_WIDGET_W = 142;
const TIMER_WIDGET_H = 38;
const TIMER_WIDGET_MARGIN = 10;
// A clock can outrun a day if a session is never closed; cap it rather than let
// a bad anchor render a title wide enough to crowd out the menu bar.
const TIMER_WIDGET_MAX_SECONDS = 99 * 3600 + 59 * 60 + 59;

let timerWidgetPayload = null;
let timerWidgetTray = null;
let timerWidgetWin = null;
let timerWidgetInterval = null;
let timerWidgetLastState = null;
let timerWidgetLastText = null;
const trayIconCache = new Map();

function trayIconFor(state) {
  if (trayIconCache.has(state)) return trayIconCache.get(state);
  const file = path.join(__dirname, 'public', 'tray', `${TRAY_ICON_BASENAME[state]}Template.png`);
  const image = nativeImage.createFromPath(file);
  // A filename ending in `Template` is already enough for macOS to treat this as
  // a template image (it uses the alpha channel and re-tints for the light/dark
  // menu bar and the pressed state) — VERIFIED, and the reason the files are
  // named that way. Setting it explicitly as well means a future rename cannot
  // silently turn the icon into a black-on-black blob in dark mode.
  if (!image.isEmpty()) image.setTemplateImage(true);
  trayIconCache.set(state, image);
  return image;
}

function formatHms(totalSeconds) {
  const s = Math.max(0, Math.min(Math.floor(totalSeconds), TIMER_WIDGET_MAX_SECONDS));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// The one place the widget's number comes from. Mirrors TimeTrackingContext's
// tick: count up from the segment start, count the break allowance down, or hold
// still while idle/paused (the session clock genuinely stops there).
function timerWidgetSeconds(payload, nowMs) {
  const elapsed = Math.floor((nowMs - payload.anchorMs) / 1000);
  if (payload.mode === 'count-up') return payload.baseSeconds + Math.max(0, elapsed);
  if (payload.mode === 'count-down') return Math.max(0, payload.baseSeconds - Math.max(0, elapsed));
  return payload.baseSeconds;
}

// The payload crosses a trust boundary, so treat it as untrusted input: the
// colour is interpolated into the HUD's styles and the label into its tooltip.
function sanitizeTimerWidgetPayload(raw) {
  if (!raw || typeof raw !== 'object' || raw.visible !== true) return null;
  if (!TIMER_WIDGET_STATES.has(raw.state) || !TIMER_WIDGET_MODES.has(raw.mode)) return null;

  const baseSeconds = Number(raw.baseSeconds);
  if (!Number.isFinite(baseSeconds)) return null;

  const frozen = raw.mode === 'frozen';
  const anchorMs = frozen ? Date.now() : Number(raw.anchorMs);
  if (!frozen && !Number.isFinite(anchorMs)) return null;

  return {
    state: raw.state,
    mode: raw.mode,
    baseSeconds: Math.max(0, Math.min(Math.floor(baseSeconds), TIMER_WIDGET_MAX_SECONDS)),
    anchorMs,
    color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#ffffff',
    label: typeof raw.label === 'string' ? raw.label.replace(/[\u0000-\u001f]/g, '').slice(0, 40) : '',
  };
}

function positionTimerWidget() {
  if (!timerWidgetWin || timerWidgetWin.isDestroyed()) return;
  // workArea already excludes the taskbar, so its bottom-right corner IS the
  // space immediately above the system tray — and it stays correct for a
  // taskbar the user has moved to another edge.
  const { workArea } = electronScreen.getPrimaryDisplay();
  timerWidgetWin.setBounds({
    x: Math.round(workArea.x + workArea.width - TIMER_WIDGET_W - TIMER_WIDGET_MARGIN),
    y: Math.round(workArea.y + workArea.height - TIMER_WIDGET_H - TIMER_WIDGET_MARGIN),
    width: TIMER_WIDGET_W,
    height: TIMER_WIDGET_H,
  });
}

function ensureTimerWidgetSurface(state) {
  if (process.platform === 'darwin') {
    if (timerWidgetTray && !timerWidgetTray.isDestroyed()) return;
    timerWidgetTray = new Tray(trayIconFor(state));
    timerWidgetTray.setIgnoreDoubleClickEvents(true);
    timerWidgetTray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
    return;
  }

  if (process.platform !== 'win32') return;
  if (timerWidgetWin && !timerWidgetWin.isDestroyed()) return;

  timerWidgetWin = new BrowserWindow({
    width: TIMER_WIDGET_W,
    height: TIMER_WIDGET_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Not a window the user manages: it must not take a taskbar button, appear
    // in Alt-Tab, or ever steal focus from what they are actually working in.
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    type: 'toolbar',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'widget-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // Plain alwaysOnTop loses to a fair number of Windows shells; the screen-saver
  // level is what actually keeps a HUD pinned.
  timerWidgetWin.setAlwaysOnTop(true, 'screen-saver');
  timerWidgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Click-through. A floating always-on-top window that swallowed clicks in the
  // busiest corner of the desktop would be worse than no widget at all.
  timerWidgetWin.setIgnoreMouseEvents(true);

  // It renders a static local page and needs none of attachWindowBehaviour's
  // navigation/offline/crash policy — but it must still be unable to navigate.
  timerWidgetWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  timerWidgetWin.webContents.on('will-navigate', (e, url) => {
    if (url.split('?')[0] !== TIMER_WIDGET_PAGE_URL) e.preventDefault();
  });

  timerWidgetWin.on('closed', () => { timerWidgetWin = null; });
  // The HUD can finish loading well after the first tick was pushed, and a
  // frozen (idle/paused) clock produces no further change for renderTimerWidget
  // to send — so the page would stay blank until the next state transition.
  // Force one full paint once its listener is actually attached.
  timerWidgetWin.webContents.on('did-finish-load', () => {
    timerWidgetLastState = null;
    timerWidgetLastText = null;
    renderTimerWidget();
  });
  timerWidgetWin.loadFile(TIMER_WIDGET_PAGE);
  // showInactive, not show — showing it must never pull focus off the user's work.
  timerWidgetWin.once('ready-to-show', () => {
    if (!timerWidgetWin || timerWidgetWin.isDestroyed()) return;
    positionTimerWidget();
    timerWidgetWin.showInactive();
  });
  positionTimerWidget();
}

function renderTimerWidget() {
  const payload = timerWidgetPayload;
  if (!payload) return;

  const text = formatHms(timerWidgetSeconds(payload, Date.now()));
  const stateChanged = payload.state !== timerWidgetLastState;
  if (!stateChanged && text === timerWidgetLastText) return;

  if (timerWidgetTray && !timerWidgetTray.isDestroyed()) {
    if (stateChanged) timerWidgetTray.setImage(trayIconFor(payload.state));
    // monospacedDigit stops the title jittering as the digits change width.
    timerWidgetTray.setTitle(text, { fontType: 'monospacedDigit' });
    timerWidgetTray.setToolTip(payload.label ? `${payload.label} — ${text}` : text);
  }
  sendTo(timerWidgetWin, 'timer-widget:tick', {
    text,
    state: payload.state,
    color: payload.color,
    label: payload.label,
  });

  timerWidgetLastState = payload.state;
  timerWidgetLastText = text;
}

function teardownTimerWidget() {
  if (timerWidgetInterval) {
    clearInterval(timerWidgetInterval);
    timerWidgetInterval = null;
  }
  if (timerWidgetTray && !timerWidgetTray.isDestroyed()) timerWidgetTray.destroy();
  timerWidgetTray = null;
  if (timerWidgetWin && !timerWidgetWin.isDestroyed()) timerWidgetWin.destroy();
  timerWidgetWin = null;
  timerWidgetPayload = null;
  timerWidgetLastState = null;
  timerWidgetLastText = null;
}

ipcMain.on('timer-widget:update', (event, raw) => {
  // Only the main window carries time-tracking state, so only it may drive the
  // widget — a satellite must not be able to paint the menu bar.
  const rec = recordFor(senderWindow(event));
  if (!rec || !rec.isMain) return;

  const payload = sanitizeTimerWidgetPayload(raw);
  // Hidden covers clocked-out (an explicit requirement — the widget must never
  // show a closed session), the Settings toggle being off, and a malformed push.
  if (!payload) {
    teardownTimerWidget();
    return;
  }
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;

  timerWidgetPayload = payload;
  // The widget is an ambient convenience — nothing else depends on it, so a
  // failure here (a tray asset missing from the asar, a display API throwing)
  // must degrade to "no widget" rather than surface as an uncaught exception.
  try {
    ensureTimerWidgetSurface(payload.state);
    // A push only ever happens on a real transition, so repaint unconditionally
    // rather than letting renderTimerWidget's no-change guard swallow it (a new
    // anchor can produce the same digits — a sleep-gap patch, for instance).
    timerWidgetLastText = null;
    renderTimerWidget();
    if (!timerWidgetInterval) timerWidgetInterval = setInterval(renderTimerWidget, 1000);
  } catch (err) {
    console.error('[main] timer widget failed:', err.message);
    teardownTimerWidget();
  }
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
// The RENDERER decides when to call this: automatically for existing users
// (`screenshotBugFixed` falsy, once per session, on a capture — not network —
// failure) in TimeTrackingContext, on mount in the onboarding screen step, and
// on demand from Settings → App Settings → "Reset OS Permissions".
//
// The only native gate is darwin-only. There is deliberately NO once-per-machine
// marker: the automatic reset did not stick for every user, so the manual
// Settings button must be able to re-run it as many times as it takes. tccutil
// reset is idempotent and cheap — the cost of running it again is one fresh OS
// prompt on the next capture, which is exactly what the button promises.
// See the "Temporary: screenshot TCC repair" note in CLAUDE.md for removal.
ipcMain.handle('permissions:resetScreenCapture', async () => {
  if (process.platform !== 'darwin') return { success: false };

  const status = systemPreferences.getMediaAccessStatus('screen');
  try {
    await execFileAsync('tccutil', ['reset', 'ScreenCapture', 'com.bluu.app']);
    console.log(`[Screenshot] OS status "${status}" — reset ScreenCapture TCC record. A fresh prompt is expected on the next capture.`);
    return { success: true };
  } catch (err) {
    // Non-fatal (e.g. bundle id not registered in a dev run).
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

    return { success: true, screens };
  } catch (err) {
    console.error('[Screenshot] Capture failed:', err);
    return { success: false, error: err.message };
  }
});

// ─── Notifications ───────────────────────────────────────────────────
// Notifications are routed to a *window*, not to `mainWindow`. A new-DM alert
// raised by the OF Manager window must focus and navigate that window — routing
// everything to the main window (the pre-multi-window behaviour) would drag the
// operator out of the inbox they were working in.
//
// `target` selects the destination: omitted/'sender' → the window that called
// (the default, and identical to the old behaviour for the main window), 'main'
// → the main window, any other string → that satellite key, falling back to main.
const activeNotifications = new Map(); // id -> Notification

function resolveTargetWindow(event, target) {
  if (target === 'main') return mainWindow;
  if (typeof target === 'string' && target && target !== 'sender') {
    const satellite = satelliteWindows.get(target);
    if (satellite && !satellite.isDestroyed()) return satellite;
    return mainWindow;
  }
  return senderWindow(event) || mainWindow;
}

ipcMain.handle('notifications:show', async (event, options = {}) => {
  const { id, title, body, playSound, actionUrl, target, hasReply, replyPlaceholder, actions } = options;
  const targetWin = resolveTargetWindow(event, target);

  if (Notification.isSupported()) {
    const notif = new Notification({
      title,
      body,
      silent: true,
      // macOS inline reply — lets an operator answer a DM without switching windows.
      hasReply: !!hasReply,
      replyPlaceholder: typeof replyPlaceholder === 'string' ? replyPlaceholder : undefined,
      actions: Array.isArray(actions)
        ? actions.slice(0, 3).map(a => ({ type: 'button', text: String((a && a.text) || '') }))
        : undefined,
    });

    const focusTarget = () => {
      if (!targetWin || targetWin.isDestroyed()) return;
      if (targetWin.isMinimized()) targetWin.restore();
      targetWin.show();
      targetWin.focus();
    };

    notif.on('click', () => {
      focusTarget();
      if (actionUrl) sendTo(targetWin, 'notification:navigate', actionUrl);
      if (id) sendTo(targetWin, 'notification:activated', { id });
    });
    // Deliberately does NOT focus: replying inline exists so the operator can stay
    // in whatever they were doing.
    notif.on('reply', (_e, reply) => sendTo(targetWin, 'notification:reply', { id: id || null, reply }));
    notif.on('action', (_e, index) => sendTo(targetWin, 'notification:action', { id: id || null, index }));
    notif.on('close', () => { if (id) activeNotifications.delete(id); });

    if (id) {
      // Same id → replace, so a chat that receives five messages doesn't stack
      // five banners in Notification Center.
      const previous = activeNotifications.get(id);
      if (previous) previous.close();
      activeNotifications.set(id, notif);
    }

    notif.show();
  }

  if (playSound) sendTo(targetWin, 'notifications:play-sound');

  return { success: true };
});

ipcMain.handle('notifications:close', (_event, id) => {
  const notif = id ? activeNotifications.get(id) : null;
  if (!notif) return { success: false };
  notif.close();
  activeNotifications.delete(id);
  return { success: true };
});

// ─── Dock / taskbar attention ────────────────────────────────────────
// An unread inbox has to be visible when the app isn't focused. Badge support is
// per-platform and there is no web equivalent, so all three mechanisms are exposed
// and the renderer picks: macOS/Linux take the numeric badge, Windows takes a
// taskbar overlay icon the *renderer* draws (so the badge can be restyled without
// a native build), and flashFrame/dock bounce cover the "look at me" case.
ipcMain.handle('app:setBadgeCount', (_event, count) => {
  const value = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  try {
    return { success: app.setBadgeCount(value) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('window:set-overlay-icon', (event, { dataUrl, description } = {}) => {
  if (process.platform !== 'win32') return;
  const win = senderWindow(event);
  if (!win) return;
  try {
    if (!dataUrl) {
      win.setOverlayIcon(null, '');
      return;
    }
    const image = nativeImage.createFromDataURL(String(dataUrl));
    if (image.isEmpty()) return;
    win.setOverlayIcon(image, String(description || ''));
  } catch (err) {
    console.warn('[main] setOverlayIcon failed:', err.message);
  }
});

ipcMain.on('window:flash-frame', (event, flag) => {
  const win = senderWindow(event);
  if (win) win.flashFrame(!!flag);
});

ipcMain.handle('app:bounceDock', (_event, type) => {
  if (process.platform !== 'darwin' || !app.dock) return null;
  return app.dock.bounce(type === 'critical' ? 'critical' : 'informational');
});

ipcMain.on('app:cancelBounce', (_event, id) => {
  if (process.platform !== 'darwin' || !app.dock) return;
  if (typeof id === 'number') app.dock.cancelBounce(id);
});

// ─── Clipboard ───────────────────────────────────────────────────────
// `clipboard-read` stays denied at the Chromium permission layer, so
// navigator.clipboard.read() cannot see the user's clipboard. This is the one
// narrow exception: an explicit, renderer-initiated read of an *image*, for
// pasting a screenshot into the message composer. Text is not exposed — the
// normal paste path already delivers it without any permission.
ipcMain.handle('clipboard:readImage', () => {
  try {
    const image = clipboard.readImage();
    if (!image || image.isEmpty()) return null;
    const { width, height } = image.getSize();
    return { dataUrl: image.toDataURL(), width, height };
  } catch (err) {
    console.warn('[main] clipboard.readImage failed:', err.message);
    return null;
  }
});

// ─── Saving and revealing files ──────────────────────────────────────
// Two paths, both user-consented via a native save dialog:
//   • dialog:saveFile — renderer hands over bytes (generated exports, small media).
//   • download:start  — main streams a remote URL (large media; no base64 in RAM).
// The renderer never names a filesystem path, and showItemInFolder/openPath are
// restricted to paths this session actually wrote.
const savedPaths = new Set();
const MAX_SAVE_BASE64_LEN = 280_000_000; // ~200 MB decoded

function sanitizeFileName(name, fallback) {
  // Illegal path characters and control bytes only. Spaces are legal in a
  // filename and mangling them turns "Fan photo.jpg" into something the
  // operator will not recognise in their Downloads folder.
  const base = path.basename(String(name || '')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  if (!base || base === '.' || base === '..') return fallback;
  return base.slice(0, 180);
}

ipcMain.handle('dialog:saveFile', async (event, { suggestedName, filters, dataBase64 } = {}) => {
  if (typeof dataBase64 !== 'string' || !dataBase64) return { success: false, error: 'no-data' };
  if (dataBase64.length > MAX_SAVE_BASE64_LEN) return { success: false, error: 'too-large' };

  const win = senderWindow(event) || mainWindow;
  const name = sanitizeFileName(suggestedName, 'download');
  const result = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('downloads'), name),
    filters: Array.isArray(filters) ? filters : undefined,
  });
  if (result.canceled || !result.filePath) return { success: false, canceled: true };

  try {
    await fsp.writeFile(result.filePath, Buffer.from(dataBase64, 'base64'));
    savedPaths.add(result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    console.error('[main] saveFile failed:', err);
    return { success: false, error: err.message };
  }
});

// url -> { id, winId, name } for downloads we initiated, so `will-download` can
// correlate the item back to the caller.
const pendingDownloads = new Map();

ipcMain.handle('download:start', async (event, { url, suggestedName, id } = {}) => {
  const win = senderWindow(event);
  if (!win) return { success: false, error: 'no-window' };

  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return { success: false, error: 'bad-url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { success: false, error: 'bad-scheme' };

  const downloadId = typeof id === 'string' && id ? id : `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingDownloads.set(parsed.href, {
    id: downloadId,
    winId: win.id,
    name: sanitizeFileName(suggestedName || path.basename(parsed.pathname), 'download'),
  });
  win.webContents.downloadURL(parsed.href);
  return { success: true, id: downloadId };
});

// Signed media URLs redirect, and after a redirect `item.getURL()` is the final
// hop — so match against the whole chain or a redirected download loses its id
// (and with it, progress reporting) even though the save itself still works.
function takePendingDownload(item) {
  const chain = typeof item.getURLChain === 'function' ? item.getURLChain() : [];
  for (const url of [item.getURL(), ...chain]) {
    const pending = pendingDownloads.get(url);
    if (pending) {
      pendingDownloads.delete(url);
      return pending;
    }
  }
  return null;
}

function registerDownloadHandler() {
  session.defaultSession.on('will-download', (_event, item, webContents) => {
    const pending = takePendingDownload(item);

    const win = pending ? BrowserWindow.fromId(pending.winId) : BrowserWindow.fromWebContents(webContents);
    const id = pending ? pending.id : null;
    const name = (pending && pending.name) || item.getFilename();

    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), name) });

    item.on('updated', (_e, state) => {
      if (!id) return;
      sendTo(win, 'download:progress', {
        id,
        state,
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
      });
    });

    item.once('done', (_e, state) => {
      const filePath = item.getSavePath();
      if (state === 'completed' && filePath) savedPaths.add(filePath);
      if (id) sendTo(win, 'download:done', { id, state, filePath: state === 'completed' ? filePath : null });
    });
  });
}

ipcMain.handle('shell:showItemInFolder', (_event, filePath) => {
  if (typeof filePath !== 'string' || !savedPaths.has(filePath)) return { success: false, error: 'unknown-path' };
  shell.showItemInFolder(filePath);
  return { success: true };
});

ipcMain.handle('shell:openPath', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !savedPaths.has(filePath)) return { success: false, error: 'unknown-path' };
  const error = await shell.openPath(filePath);
  return { success: !error, error: error || undefined };
});

// ─── Platform / version info ─────────────────────────────────────────
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

// ─── Window geometry ─────────────────────────────────────────────────
// The main process is the authority on display geometry. The renderer must never
// derive a window size from `window.screen.*`: those are CSS pixels, so the forced
// 90% zoom (see the did-finish-load handler) skews them, and they describe whatever
// display Chromium considers current rather than the one the window is on.
//
// Every handler here is SENDER-SCOPED. The minimum sizes are per-window too (the
// main window's floor is 1024x720; a satellite sets its own), which is why the
// floor lives on the window record rather than in a module constant.
const WINDOW_MIN_W = 1024;
const WINDOW_MIN_H = 720;
const LOGIN_W = 1430;
const LOGIN_H = 870;

const ZOOM_DEFAULT = 0.9;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

// Work area (screen minus taskbar/dock) of the display the given window is on, in
// DIPs — the same unit setSize/getSize use. Falls back to the primary display.
// Only safe to call after app.whenReady().
function workAreaFor(win) {
  try {
    const display = win && !win.isDestroyed()
      ? electronScreen.getDisplayMatching(win.getBounds())
      : electronScreen.getPrimaryDisplay();
    return display.workAreaSize;
  } catch {
    return { width: LOGIN_W, height: LOGIN_H };
  }
}

// Never hand setSize a value larger than the display. The floor is itself capped by
// the work area, so a small or heavily-scaled display can't be given a window it
// cannot fit (a 1920x1080 @150% Windows laptop has only 1280x672 DIPs to work with).
function clampToWorkArea(win, width, height) {
  const wa = workAreaFor(win);
  const rec = recordFor(win);
  const minW = rec ? rec.minWidth : WINDOW_MIN_W;
  const minH = rec ? rec.minHeight : WINDOW_MIN_H;
  return {
    width: Math.min(Math.max(width, Math.min(minW, wa.width)), wa.width),
    height: Math.min(Math.max(height, Math.min(minH, wa.height)), wa.height),
  };
}

// Apply a size we chose (not the user). Clamped, re-centred, and flagged so the
// resulting `resized` event is not mistaken for a manual resize.
function applyWindowSize(win, width, height) {
  const rec = recordFor(win);
  if (!rec) return;
  const size = clampToWorkArea(win, Math.round(width), Math.round(height));
  rec.suppressResizedUntil = Date.now() + 750;
  // animate:false — an animated setSize on macOS emits `resized` when it finishes.
  win.setSize(size.width, size.height, false);
  win.center();
  rec.lastNormalSize = size;
}

// Current persistable window state: the last *normal* size plus the maximize flag.
function currentWindowState(win) {
  const rec = recordFor(win);
  if (!rec) return null;
  const [width, height] = win.getSize();
  const isMaximized = win.isMaximized();
  if (!isMaximized) rec.lastNormalSize = { width, height };
  const size = rec.lastNormalSize || { width, height };
  return { width: size.width, height: size.height, isMaximized };
}

// IPC handler for window resizability
ipcMain.on('window:set-resizable', (event, resizable) => {
  const win = senderWindow(event);
  if (win) win.setResizable(!!resizable);
});

// IPC handler for window size. Clamped — a size persisted on a larger monitor (or by an
// older build that saved maximized bounds) must not reopen off-screen here.
ipcMain.on('window:set-size', (event, width, height) => {
  if (typeof width !== 'number' || typeof height !== 'number') return;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  const win = senderWindow(event);
  if (win) applyWindowSize(win, width, height);
});

// IPC handler to read the current outer window size (used to persist user resizes
// without title-bar drift — getSize/setSize both operate on the outer window bounds).
ipcMain.handle('window:get-size', (event) => {
  const win = senderWindow(event);
  return win ? win.getSize() : null;
});

// Outer (normal) size plus maximize state.
ipcMain.handle('window:get-state', (event) => currentWindowState(senderWindow(event)));

// Authoritative work area in DIPs, for the renderer's dynamic first-run sizing.
ipcMain.handle('window:get-work-area', (event) => workAreaFor(senderWindow(event)));

ipcMain.on('window:maximize', (event) => {
  const win = senderWindow(event);
  if (win) win.maximize();
});

ipcMain.on('window:minimize', (event) => {
  const win = senderWindow(event);
  if (win) win.minimize();
});

ipcMain.on('window:focus', (event) => {
  const win = senderWindow(event);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// A satellite closing itself (e.g. a "Close" button in its own chrome). The main
// window is excluded: closing it must go through the clock-out flush path, and a
// renderer bug must not be able to bypass that.
ipcMain.on('window:close', (event) => {
  const win = senderWindow(event);
  const rec = recordFor(win);
  if (!rec || rec.isMain) return;
  win.close();
});

ipcMain.on('window:set-always-on-top', (event, flag) => {
  const win = senderWindow(event);
  if (win) win.setAlwaysOnTop(!!flag);
});

ipcMain.handle('window:is-focused', (event) => {
  const win = senderWindow(event);
  return !!(win && win.isFocused());
});

// Zoom is a per-window property. The 90% default is re-asserted on every full page
// load; a renderer-set factor is remembered on the record so a reload keeps it.
ipcMain.on('window:set-zoom', (event, factor) => {
  const win = senderWindow(event);
  const rec = recordFor(win);
  if (!rec || typeof factor !== 'number' || !Number.isFinite(factor)) return;
  const clamped = Math.min(Math.max(factor, ZOOM_MIN), ZOOM_MAX);
  rec.zoomFactor = clamped;
  win.webContents.setZoomFactor(clamped);
});

ipcMain.handle('window:get-zoom', (event) => {
  const win = senderWindow(event);
  return win ? win.webContents.getZoomFactor() : null;
});

// The renderer only re-sizes on login, so without this a window sized on one display
// stays that size after the display changes underneath it — unplugging an external
// monitor, an RDP session at a smaller resolution, or a DPI-scaling change all leave
// the window larger than the screen for the rest of the session. Applies to every
// window, satellites included.
function registerDisplayListeners() {
  const reclamp = () => {
    // The HUD is docked to a corner of the work area, so a resolution change, a
    // scaling change or the taskbar moving all shift where that corner is. It
    // carries no window record (it is not an app window), so it is repositioned
    // explicitly rather than through the clamp loop below.
    positionTimerWidget();
    for (const rec of winRecords.values()) {
      const win = rec.win;
      if (!win || win.isDestroyed()) continue;
      if (win.isMaximized() || win.isFullScreen()) continue;
      const [width, height] = win.getSize();
      const size = clampToWorkArea(win, width, height);
      if (size.width === width && size.height === height) continue;
      console.log(`[main] display changed — clamping window ${width}x${height} → ${size.width}x${size.height}`);
      applyWindowSize(win, size.width, size.height);
    }
  };
  electronScreen.on('display-metrics-changed', reclamp);
  electronScreen.on('display-removed', reclamp);
  electronScreen.on('display-added', reclamp);
}

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

// The only two local pages a renderer is allowed to navigate to. `will-navigate`
// fires for renderer-initiated navigation only (loadFile/loadURL from main do not
// emit it), so this is a whitelist of what a *page* may navigate to — previously a
// blanket `file://` allowance, which the OF window does not need and which renders
// fan-supplied content.
const LOADING_PAGE = path.join(__dirname, 'loading.html');
const OFFLINE_PAGE = path.join(__dirname, 'offline.html');
const LOCAL_PAGE_URLS = new Set([pathToFileURL(LOADING_PAGE).href, pathToFileURL(OFFLINE_PAGE).href]);

// ─── App load + offline fallback (per window) ────────────────────────
// The renderer IS the product (hosted on Vercel). If it fails to load we
// show a branded offline screen and retry with backoff instead of leaving
// the raw Chrome error page (or a blank window) on screen. Each window carries
// its own backoff and its own app URL, so a satellite recovers to the route it
// was opened on rather than to the app root.
const OFFLINE_RETRY_BASE = 2000;
const OFFLINE_RETRY_MAX = 30000;

function clearOfflineRetry(rec) {
  if (!rec) return;
  if (rec.offlineTimer) {
    clearTimeout(rec.offlineTimer);
    rec.offlineTimer = null;
  }
  rec.offlineDelay = OFFLINE_RETRY_BASE;
}

function loadAppUrl(win) {
  const rec = recordFor(win);
  if (!rec) return;
  clearOfflineRetry(rec);
  win.loadURL(rec.appUrl);
}

function showOfflineScreen(win) {
  const rec = recordFor(win);
  if (!rec) return;
  win.loadFile(OFFLINE_PAGE).catch(() => {});
  // Auto-retry with capped exponential backoff; the offline page also has a
  // manual "Try again" button (app:retry-load).
  if (!rec.offlineTimer) {
    rec.offlineTimer = setTimeout(() => {
      rec.offlineTimer = null;
      loadAppUrl(win);
    }, rec.offlineDelay);
    rec.offlineDelay = Math.min(rec.offlineDelay * 2, OFFLINE_RETRY_MAX);
  }
}

ipcMain.on('app:retry-load', (event) => loadAppUrl(senderWindow(event)));

// Renderer-crash reload loop-guard: if the renderer keeps dying we stop
// auto-reloading and park on the offline/error screen. Counted per window.
const RELOAD_WINDOW_MS = 60000;
const RELOAD_MAX = 3;

// Max time to hold the window close while the renderer clocks out and flushes.
const QUIT_FLUSH_TIMEOUT_MS = 4000;

// ─── Right-click menu + spellcheck ───────────────────────────────────
// Chromium's spellchecker is on by default, but Electron renders NO suggestion UI
// unless the main process builds the menu — and without a context menu there is no
// cut/copy/paste either. In a window whose whole job is typing messages to fans,
// both are table stakes. Built from `params` so it adapts to what was right-clicked.
function attachContextMenu(win) {
  win.webContents.on('context-menu', (_event, params) => {
    const template = [];

    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, 5);
      if (suggestions.length === 0) {
        template.push({ label: 'No spelling suggestions', enabled: false });
      } else {
        for (const suggestion of suggestions) {
          template.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) });
        }
      }
      template.push({ type: 'separator' });
      template.push({
        label: 'Add to Dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      template.push({ type: 'separator' });
    }

    if (params.linkURL) {
      template.push({ label: 'Open Link in Browser', click: () => openExternalSafe(params.linkURL) });
      template.push({ label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) });
      template.push({ type: 'separator' });
    }

    if (params.mediaType === 'image' && params.srcURL) {
      template.push({ label: 'Copy Image', click: () => win.webContents.copyImageAt(params.x, params.y) });
      if (/^https?:/.test(params.srcURL)) {
        template.push({
          label: 'Save Image As…',
          click: () => {
            pendingDownloads.set(params.srcURL, {
              id: null,
              winId: win.id,
              name: sanitizeFileName(path.basename(new URL(params.srcURL).pathname), 'image'),
            });
            win.webContents.downloadURL(params.srcURL);
          },
        });
      }
      template.push({ type: 'separator' });
    }

    const { editFlags } = params;
    if (params.isEditable || params.selectionText) {
      template.push({ role: 'cut', enabled: !!(editFlags && editFlags.canCut) });
      template.push({ role: 'copy', enabled: !!(editFlags && editFlags.canCopy) });
      template.push({ role: 'paste', enabled: !!(editFlags && editFlags.canPaste) });
      if (params.isEditable && process.platform === 'darwin') {
        template.push({ role: 'pasteAndMatchStyle', enabled: !!(editFlags && editFlags.canPaste) });
      }
      template.push({ type: 'separator' });
      template.push({ role: 'selectAll' });
    }

    if (isDev) {
      template.push({ type: 'separator' });
      template.push({ label: 'Inspect Element', click: () => win.webContents.inspectElement(params.x, params.y) });
    }

    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

// ─── Shared window behaviour ─────────────────────────────────────────
// Navigation posture, offline fallback, crash recovery, unresponsive reporting,
// manual-resize reporting, focus reporting and the context menu, applied
// identically to the main window and to every satellite. Before this existed the
// satellite had only a zoom handler: a Vercel hiccup or a renderer crash left the
// operator staring at a blank window with no retry.
function attachWindowBehaviour(win, { isMain, appUrl, minWidth, minHeight, satelliteKey = null }) {
  const rec = {
    win,
    isMain,
    appUrl,
    satelliteKey,
    minWidth,
    minHeight,
    zoomFactor: ZOOM_DEFAULT,
    lastNormalSize: null,
    suppressResizedUntil: 0,
    offlineTimer: null,
    offlineDelay: OFFLINE_RETRY_BASE,
    reloadCount: 0,
    reloadWindowStart: Date.now(),
  };
  winRecords.set(win.id, rec);

  // ─── User-initiated resize → renderer ──────────────────────────────
  // Only a MANUAL resize may be persisted. The DOM `resize` event can't express that:
  // it also fires for our own auto-size, which would write the auto-sized value to
  // storage and stop auto-sizing from ever running again. `resized` fires when the user
  // finishes dragging (the suppression window covers platforms that also emit it for
  // setSize), and maximize/unmaximize carry the state without the maximized bounds.
  const notifyUserResize = () => {
    if (Date.now() < rec.suppressResizedUntil) return;
    const state = currentWindowState(win);
    if (state) sendTo(win, 'window:user-resized', state);
  };
  win.on('resized', notifyUserResize);
  win.on('maximize', notifyUserResize);
  win.on('unmaximize', notifyUserResize);

  // Lets a window decide whether an incoming message deserves a notification, or
  // whether the thread on screen should be marked read.
  win.on('focus', () => sendTo(win, 'window:focus-changed', { focused: true }));
  win.on('blur', () => sendTo(win, 'window:focus-changed', { focused: false }));

  // Open external links (target=_blank) in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });

  // Prevent navigation to other origins from the electron window
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(BASE_URL) || LOCAL_PAGE_URLS.has(url.split('?')[0])) return;
    e.preventDefault();
    openExternalSafe(url);
  });

  // On a real load failure of the app URL, show the offline screen and retry
  // with backoff. Ignore sub-frame failures and user-aborted loads (-3).
  win.webContents.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (validatedURL.startsWith(BASE_URL)) {
      console.log(`[main] did-fail-load (${errorCode}) for ${validatedURL} — showing offline screen`);
      // The tracker's renderer is gone, so its anchor is stale — the widget would
      // otherwise keep counting up against a session nobody is holding. It comes
      // back on its own: the provider pushes fresh state when the app reloads.
      if (isMain) teardownTimerWidget();
      showOfflineScreen(win);
    }
  });

  // Successful app load — reset the offline backoff.
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed() && win.webContents.getURL().startsWith(BASE_URL)) {
      clearOfflineRetry(rec);
      // Default the app to 90% zoom — screenshots showed users' screens overly
      // zoomed in. A renderer-chosen factor (window:set-zoom) wins.
      win.webContents.setZoomFactor(rec.zoomFactor);
    }

    if (!isMain) return;

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
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] render-process-gone:', details.reason, details.exitCode);
    forwardErrorToRenderer(
      'electron:main:render-process-gone',
      `Renderer gone (${satelliteKey || 'main'}): ${details.reason} (exit ${details.exitCode})`,
      undefined,
    );
    // Same reasoning as did-fail-load: a dead renderer's anchor is stale, so
    // stop the widget rather than let it tick on by itself.
    if (isMain) teardownTimerWidget();
    // A clean exit isn't a crash.
    if (details.reason === 'clean-exit') return;

    const now = Date.now();
    if (now - rec.reloadWindowStart > RELOAD_WINDOW_MS) {
      rec.reloadWindowStart = now;
      rec.reloadCount = 0;
    }
    rec.reloadCount += 1;

    if (rec.reloadCount > RELOAD_MAX) {
      console.error('[main] renderer crashed too many times — parking on offline screen');
      showOfflineScreen(win);
      return;
    }
    setTimeout(() => loadAppUrl(win), 500);
  });

  win.webContents.on('child-process-gone', (_e, details) => {
    console.error('[main] child-process-gone:', details.type, details.reason);
  });

  // ─── Unresponsive detection ────────────────────────────────────────
  win.on('unresponsive', () => {
    console.warn('[main] window became unresponsive');
    forwardErrorToRenderer('electron:main:unresponsive', `Renderer became unresponsive (${satelliteKey || 'main'})`, undefined);
  });
  win.on('responsive', () => {
    console.log('[main] window became responsive again');
  });

  attachContextMenu(win);

  win.on('closed', () => {
    clearOfflineRetry(rec);
    winRecords.delete(win.id);
    if (satelliteKey) satelliteWindows.delete(satelliteKey);
  });

  return rec;
}

// ─── Satellite windows (OF Manager and anything after it) ────────────
// OnlyFans messaging lives in its own window, spawned from the sidebar. Three
// properties are load-bearing:
//   • **Co-equal with the main window, not a child.** It is deliberately NOT
//     created with `parent: mainWindow`: on macOS a parented window is pinned
//     above its parent forever, so the main window sits permanently behind it
//     and cannot be worked in. Operators need both windows side by side and
//     either one on top, so the close-dependency below is enforced by hand
//     (`closeAllSatellites()` on the main window's `closed`) instead.
//   • `resizable: true` with its own minimum — operators size the inbox
//     independently of the main window, which is locked to its own geometry.
//   • one window per `key` — a second request with the same key focuses it.
//
// Permission is verified SERVER-SIDE before the window is created: the renderer
// hands over its Firebase ID token and main calls the prefix's access route with
// it. Hiding the sidebar item is a UI convenience; this is the check that counts.
//
// The route is NOT an enum. Any path under an allowlisted prefix is accepted, so
// new sub-routes (a popped-out chat, a vault browser, a media viewer) ship as
// renderer-only changes — no native build. Adding a whole new *prefix* is the only
// thing that needs one, because each prefix names the access route that guards it.
const SATELLITE_PREFIXES = [
  { prefix: '/of-manager', accessPath: '/api/onlyfans/access', title: 'OF Manager' },
];
const SATELLITE_MAX = 8;
const SATELLITE_MIN_DIMENSION = 360;

// key -> BrowserWindow
const satelliteWindows = new Map();
// Keys whose server-side access check is in flight (see openSatelliteWindow).
const openingSatellites = new Set();

function matchSatellitePrefix(pathname) {
  return SATELLITE_PREFIXES.find(p => pathname === p.prefix || pathname.startsWith(`${p.prefix}/`)) || null;
}

// The renderer supplies the route, so it is validated as untrusted input: same
// origin, under an allowlisted prefix, no traversal, no protocol-relative host.
function normalizeSatelliteTarget(raw) {
  const value = typeof raw === 'string' && raw ? raw : SATELLITE_PREFIXES[0].prefix;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('..')) return null;
  let parsed;
  try {
    parsed = new URL(value, BASE_URL);
  } catch {
    return null;
  }
  if (parsed.origin !== BASE_ORIGIN) return null;
  const prefix = matchSatellitePrefix(parsed.pathname);
  if (!prefix) return null;
  return { prefix, pathname: parsed.pathname, relative: `${parsed.pathname}${parsed.search}` };
}

function closeAllSatellites() {
  for (const win of satelliteWindows.values()) {
    if (win && !win.isDestroyed()) win.destroy();
  }
  satelliteWindows.clear();
}

function clampDimension(value, fallback, max) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(Math.max(n, SATELLITE_MIN_DIMENSION), max);
}

async function openSatelliteWindow(options = {}) {
  const { idToken, path: rawPath, key: rawKey, title, alwaysOnTop } = options;

  const target = normalizeSatelliteTarget(rawPath);
  if (!target) return { success: false, error: 'invalid-path' };

  const key = typeof rawKey === 'string' && /^[a-z0-9][a-z0-9._:-]{0,63}$/i.test(rawKey) ? rawKey : target.relative;

  const existing = satelliteWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return { success: true, focused: true, key };
  }

  // The access check is awaited, so two fast clicks would both clear the check
  // above and open two windows for one key — the first then becomes orphaned
  // (unreachable, and only closed when the main window goes). The in-flight set
  // is what makes "one window per key" actually hold.
  if (openingSatellites.has(key)) return { success: false, error: 'already-opening' };

  if (!idToken || typeof idToken !== 'string') {
    return { success: false, error: 'unauthenticated' };
  }
  if (satelliteWindows.size + openingSatellites.size >= SATELLITE_MAX) {
    return { success: false, error: 'too-many-windows' };
  }

  openingSatellites.add(key);
  try {
    const response = await fetch(`${BASE_URL}${target.prefix.accessPath}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) {
      console.warn('[main] satellite access denied:', target.relative, response.status);
      openingSatellites.delete(key);
      return { success: false, error: response.status === 403 ? 'forbidden' : 'unauthenticated' };
    }
  } catch (err) {
    console.error('[main] satellite access check failed:', err);
    openingSatellites.delete(key);
    return { success: false, error: 'offline' };
  }
  openingSatellites.delete(key);

  const workArea = workAreaFor(mainWindow);
  const minWidth = clampDimension(options.minWidth, 900, workArea.width);
  const minHeight = clampDimension(options.minHeight, 600, workArea.height);
  const width = Math.max(clampDimension(options.width, 1200, workArea.width), minWidth);
  const height = Math.max(clampDimension(options.height, 820, workArea.height), minHeight);

  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    resizable: true,
    show: true,
    backgroundColor: '#0A0A0A',
    title: typeof title === 'string' && title ? title.slice(0, 120) : target.prefix.title,
    alwaysOnTop: !!alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  satelliteWindows.set(key, win);
  attachWindowBehaviour(win, {
    isMain: false,
    appUrl: `${BASE_URL}${target.relative}`,
    minWidth,
    minHeight,
    satelliteKey: key,
  });

  win.loadURL(`${BASE_URL}${target.relative}`);
  return { success: true, key };
}

// Legacy channel — pre-generalisation renderers call this with `{ idToken }` only
// and get the OF Manager root, exactly as before.
ipcMain.handle('onlyfans:open-window', (_event, args = {}) => openSatelliteWindow(args));
ipcMain.handle('window:open-satellite', (_event, args = {}) => openSatelliteWindow(args));

ipcMain.handle('window:close-satellite', (_event, key) => {
  const win = typeof key === 'string' ? satelliteWindows.get(key) : null;
  if (!win || win.isDestroyed()) return { success: false };
  win.close();
  return { success: true };
});

ipcMain.handle('window:list-satellites', () => (
  [...satelliteWindows.entries()]
    .filter(([, win]) => win && !win.isDestroyed())
    .map(([key, win]) => ({ key, focused: win.isFocused(), title: win.getTitle() }))
));

// ─── Main window ─────────────────────────────────────────────────────
function createWindow() {
  // Set app icon for macOS dock
  const iconPath = path.join(__dirname, './public/logo/icon.icns');
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(iconPath);
    app.dock.setIcon(image);
  }

  // The login window is fixed and non-resizable, so it must fit the display up front —
  // a 1430x870 window on a 1280x672 work area (1920x1080 @150% scaling, common on
  // Windows) opens larger than the screen with no way for the user to shrink it.
  const workArea = electronScreen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(LOGIN_W, workArea.width),
    height: Math.min(LOGIN_H, workArea.height),
    // Floor so a resized window can't break the UI (only applies once resizable),
    // itself capped by the work area so it can't force an oversized window.
    minWidth: Math.min(WINDOW_MIN_W, workArea.width),
    minHeight: Math.min(WINDOW_MIN_H, workArea.height),
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
      spellcheck: true,           // suggestions surface through the context menu (attachContextMenu)
      backgroundThrottling: false, // keep renderer timers (heartbeat, idle checks, screenshot scheduler) running when minimized
      v8CacheOptions: 'code',  // Enable V8 code caching for faster startup
    },
  });

  attachWindowBehaviour(mainWindow, {
    isMain: true,
    appUrl: BASE_URL,
    minWidth: WINDOW_MIN_W,
    minHeight: WINDOW_MIN_H,
  });

  // In dev, load local Next.js
  if (isDev) {
    mainWindow.loadURL(BASE_URL);
    // mainWindow.webContents.openDevTools();
  } else {
    // Show local loading screen instantly, then navigate to the hosted app once it's ready
    mainWindow.loadFile(LOADING_PAGE);
    mainWindow.webContents.once('did-finish-load', () => {
      loadAppUrl(mainWindow);
    });
  }

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

  // Satellites are satellites of this window. They are not Electron child windows
  // (that would pin them above the main window on macOS and make it unusable), so
  // the dependency is enforced here instead. Hooked to `closed`, not `close`, so it
  // survives the flush veto above — and without it `window-all-closed` would never
  // fire and the app would never quit.
  mainWindow.on('closed', () => {
    closeAllSatellites();
    // A live Tray keeps the app alive on macOS, so this is also what lets
    // window-all-closed actually quit.
    teardownTimerWidget();
    mainWindow = null;
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
  sendTo(mainWindow, channel, payload);
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
// lock/unlock patterns can be recorded. Time tracking lives in the main window
// only, so this stays main-window-scoped.
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
  //
  // `clipboard-sanitized-write` is the ONE exception: navigator.clipboard
  // .writeText() routes through this handler, so a blanket deny silently breaks
  // every "copy link" button in the app. Sanitized write is write-only and
  // cannot read what the user already has on their clipboard — unlike
  // `clipboard-read`, which stays denied (pasting an image goes through the
  // explicit `clipboard:readImage` IPC instead).
  const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)));
  // Chromium also asks synchronously (permissions.query / the write path in some
  // versions), which bypasses the request handler entirely.
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED_PERMISSIONS.has(permission));

  // Spellcheck language. macOS uses the OS spellchecker and rejects this call,
  // so it is best-effort.
  try {
    session.defaultSession.setSpellCheckerLanguages(['en-US']);
  } catch {
    // macOS — the system spellchecker picks the language itself.
  }

  registerDownloadHandler();
  registerPowerListeners();
  registerAutoUpdater();
  registerDisplayListeners();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Forward main-process errors to the renderer so they reach the /api/bugs route
function forwardErrorToRenderer(context, message, stack) {
  sendTo(mainWindow, 'bug:report', { context, message, stack });
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
