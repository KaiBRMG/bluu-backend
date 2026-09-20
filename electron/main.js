// electron/main.js
const { app, BrowserWindow, session, shell, nativeImage, ipcMain, powerMonitor, powerSaveBlocker, desktopCapturer, Notification, systemPreferences, Menu, Tray, clipboard, dialog, globalShortcut, webContents, screen: electronScreen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const crypto = require('crypto');
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

/** The `bluu://` URL in an argv array, if the OS launched us with one. */
function deepLinkFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  return argv.find(arg => typeof arg === 'string' && arg.startsWith(`${PROTOCOL}://`)) || null;
}

if (!gotTheLock) {
  app.quit();
} else {
  // Windows/Linux COLD start. `second-instance` only fires when the app was
  // ALREADY running — a link that launches the app puts the URL in *this*
  // process's argv and fires no event at all, so without this the app opened
  // on whatever route it last had and silently dropped the link.
  //
  // Stored rather than handled: there is no window yet. `did-finish-load`
  // replays it, and `handleDeepLink` also parks the parsed route in
  // `pendingDeepLinkRoute` for the renderer to collect once React mounts —
  // which is what covers the first load being the local splash screen.
  //
  // macOS never populates argv this way (it uses `open-url`), so this is inert
  // there. In dev, argv also carries the script path, hence the protocol test
  // rather than a positional read.
  deeplinkUrl = deepLinkFromArgv(process.argv);

  app.on('second-instance', (_event, commandLine) => {
    // Windows deep link handling
    const url = deepLinkFromArgv(commandLine);
    if (url) {
      handleDeepLink(url);
    }

    // Focus the window
    revealMainWindow();
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
    revealMainWindow();
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

// ── Moving the HUD (win32) ────────────────────────────────────────────────────
//
// The dock position is a DEFAULT, not a fixture: the widget sits in the busiest
// corner of the desktop, and the thing it covers is occasionally the thing the
// user needs to read. So it is draggable, and a position the user chose wins
// over the default until they reset it (double-click) — across teardown/rebuild
// (every clock-out → clock-in) and across app restarts.
//
// Click-through is still the resting state (see setIgnoreMouseEvents below), so
// this costs nothing when the user is not actually pointing at the pill.
//
// The drag is driven from MAIN off the OS cursor, not from renderer mouse
// deltas: the renderer only reports "grab started here" once, and every frame
// after that is `getCursorScreenPoint() - grabOffset`. Renderer-reported deltas
// accumulate rounding error against a window that is itself moving underneath
// the pointer, which is what makes hand-rolled Electron drags visibly lag and
// slide. An absolute cursor-to-origin offset cannot drift.
const TIMER_WIDGET_DRAG_INTERVAL_MS = 16; // ~60fps
const TIMER_WIDGET_DRAG_MAX_MS = 60_000; // a drag longer than this is a lost pointerup
/** User-chosen top-left in screen coords, or null to use the tray-corner dock. */
let timerWidgetCustomOrigin = null;
/** `{ moved, interval }` while a drag is in flight, else null. */
let timerWidgetDrag = null;
let timerWidgetOriginLoaded = false;

function timerWidgetPositionFile() {
  return path.join(app.getPath('userData'), 'timer-widget-position.json');
}

// Persistence is best-effort by design: a widget that forgets where it was put
// is a small annoyance, an unhandled rejection at drag-end is a real one.
async function loadTimerWidgetOrigin() {
  if (timerWidgetOriginLoaded) return;
  timerWidgetOriginLoaded = true;
  try {
    const raw = JSON.parse(await fsp.readFile(timerWidgetPositionFile(), 'utf8'));
    if (!Number.isFinite(raw?.x) || !Number.isFinite(raw?.y)) return;
    // A drag that landed while this read was in flight is the newer intent.
    if (timerWidgetCustomOrigin || timerWidgetDrag) return;
    timerWidgetCustomOrigin = { x: raw.x, y: raw.y };
    positionTimerWidget();
  } catch {
    // No file yet (the common case) or an unreadable one — dock to the default.
  }
}

async function saveTimerWidgetOrigin() {
  try {
    if (timerWidgetCustomOrigin) {
      await fsp.writeFile(timerWidgetPositionFile(), JSON.stringify(timerWidgetCustomOrigin), 'utf8');
    } else {
      await fsp.rm(timerWidgetPositionFile(), { force: true });
    }
  } catch (err) {
    console.error('[main] timer widget position not saved:', err.message);
  }
}

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

// workArea already excludes the taskbar, so its bottom-right corner IS the space
// immediately above the system tray — and it stays correct for a taskbar the
// user has moved to another edge.
function defaultTimerWidgetOrigin() {
  const { workArea } = electronScreen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + workArea.width - TIMER_WIDGET_W - TIMER_WIDGET_MARGIN),
    y: Math.round(workArea.y + workArea.height - TIMER_WIDGET_H - TIMER_WIDGET_MARGIN),
  };
}

// Keep the pill whole and on a real work area. This is what stops a saved
// position from stranding the widget off-screen after the display it was
// dragged to is unplugged, or after a resolution/scaling change shrinks the
// desktop under it — the same failure the window clamp loop exists to prevent.
function clampTimerWidgetOrigin(origin) {
  const { workArea } = electronScreen.getDisplayNearestPoint({
    x: Math.round(origin.x + TIMER_WIDGET_W / 2),
    y: Math.round(origin.y + TIMER_WIDGET_H / 2),
  });
  return {
    x: Math.round(Math.min(Math.max(origin.x, workArea.x), workArea.x + workArea.width - TIMER_WIDGET_W)),
    y: Math.round(Math.min(Math.max(origin.y, workArea.y), workArea.y + workArea.height - TIMER_WIDGET_H)),
  };
}

function positionTimerWidget() {
  if (!timerWidgetWin || timerWidgetWin.isDestroyed()) return;
  // A display event mid-drag must not fight the cursor; the drag clamps anyway,
  // and its next frame (16ms away) lands on the new work area.
  if (timerWidgetDrag) return;
  const origin = clampTimerWidgetOrigin(timerWidgetCustomOrigin || defaultTimerWidgetOrigin());
  timerWidgetWin.setBounds({
    x: origin.x,
    y: origin.y,
    width: TIMER_WIDGET_W,
    height: TIMER_WIDGET_H,
  });
}

// Bring the main window back regardless of how it was put away. On macOS the X
// button HIDES the window rather than destroying it (see the `close` handler in
// createWindow), so every "surface the app" path must `show()` — `focus()` alone
// is a no-op on a hidden window and the user sees nothing happen.
function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// What a click on the widget does, on either platform: surface the app. The
// widget is the one piece of the app that stays visible while it is buried, so
// it is also the fastest way back into it.
function focusMainWindowFromWidget() {
  revealMainWindow();
}

function ensureTimerWidgetSurface(state) {
  if (process.platform === 'darwin') {
    if (timerWidgetTray && !timerWidgetTray.isDestroyed()) return;
    timerWidgetTray = new Tray(trayIconFor(state));
    timerWidgetTray.setIgnoreDoubleClickEvents(true);
    timerWidgetTray.on('click', focusMainWindowFromWidget);
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
    // Movable because the user can drag it out of the way. There is no native
    // title bar and no app-region, so nothing moves it except our own
    // setBounds — this flag only stops Electron from refusing that.
    movable: true,
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
  // Click-through, but FORWARDING: a floating always-on-top window that
  // swallowed clicks in the busiest corner of the desktop would be worse than no
  // widget at all, so clicks still pass to whatever is underneath — while
  // `forward: true` keeps delivering mouse *move* events to the page, which is
  // the only way the HUD can notice the cursor has arrived and ask to become
  // grabbable. The page flips this off (interactive) on hover and back on leave,
  // so the pill is solid for exactly as long as the user is pointing at it.
  timerWidgetWin.setIgnoreMouseEvents(true, { forward: true });

  // It renders a static local page and needs none of attachWindowBehaviour's
  // navigation/offline/crash policy — but it must still be unable to navigate.
  timerWidgetWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  timerWidgetWin.webContents.on('will-navigate', (e, url) => {
    if (url.split('?')[0] !== TIMER_WIDGET_PAGE_URL) e.preventDefault();
  });

  timerWidgetWin.on('closed', () => { timerWidgetWin = null; });
  // Fire-and-forget: resolves into a reposition if a saved origin exists, and
  // only ever runs once per app launch.
  loadTimerWidgetOrigin();
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

// ── HUD drag IPC (win32) ──────────────────────────────────────────────────────
//
// Accepted from the HUD window and nowhere else. These move an always-on-top
// window and toggle whether it eats clicks, so a satellite (or the main window)
// must not be able to reach them.
function fromTimerWidget(event) {
  return !!timerWidgetWin && !timerWidgetWin.isDestroyed() && senderWindow(event) === timerWidgetWin;
}

function endTimerWidgetDrag() {
  if (!timerWidgetDrag) return;
  clearInterval(timerWidgetDrag.interval);
  timerWidgetDrag = null;
}

// Solid while the cursor is on the pill, click-through the moment it leaves.
ipcMain.on('timer-widget:set-interactive', (event, interactive) => {
  if (!fromTimerWidget(event)) return;
  // Never go click-through mid-drag: a fast drag can outrun the pointer leaving
  // the window, and losing the grab halfway across the screen is the one failure
  // that would make this feel broken.
  if (!interactive && timerWidgetDrag) return;
  timerWidgetWin.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('timer-widget:drag-start', (event) => {
  if (!fromTimerWidget(event)) return;
  endTimerWidgetDrag();

  const cursor = electronScreen.getCursorScreenPoint();
  const [winX, winY] = timerWidgetWin.getPosition();
  // The grab offset is captured ONCE. Every frame below is an absolute
  // cursor→origin translation of it, so the pill stays exactly where it was
  // grabbed rather than accumulating per-frame rounding error.
  const offsetX = cursor.x - winX;
  const offsetY = cursor.y - winY;
  const startedAt = Date.now();

  timerWidgetDrag = {
    // A press that never moves must NOT latch a custom origin — otherwise a
    // stray click on the pill quietly opts the widget out of the default dock,
    // and it stops following the taskbar for the rest of time.
    moved: false,
    interval: setInterval(() => {
      if (!timerWidgetWin || timerWidgetWin.isDestroyed()) {
        endTimerWidgetDrag();
        return;
      }
      // Safety net: pointerup is the only thing that ends a drag, and a lost one
      // (a crashed HUD, a session lock swallowing the release) would otherwise
      // leave the pill glued to the cursor forever.
      if (Date.now() - startedAt > TIMER_WIDGET_DRAG_MAX_MS) {
        endTimerWidgetDrag();
        return;
      }
      const point = electronScreen.getCursorScreenPoint();
      const origin = clampTimerWidgetOrigin({ x: point.x - offsetX, y: point.y - offsetY });
      if (!timerWidgetDrag.moved) {
        if (origin.x === winX && origin.y === winY) return;
        timerWidgetDrag.moved = true;
      }
      timerWidgetCustomOrigin = origin;
      timerWidgetWin.setPosition(origin.x, origin.y);
    }, TIMER_WIDGET_DRAG_INTERVAL_MS),
  };
});

// A press that ended where it started was never a drag — it was a CLICK, and a
// click surfaces the app (the same thing the macOS tray click does). Main is
// where that distinction lives because main is what tracked the movement; the
// page has no idea whether the pill actually went anywhere.
ipcMain.on('timer-widget:drag-end', (event) => {
  if (!fromTimerWidget(event)) return;
  const moved = !!timerWidgetDrag?.moved;
  endTimerWidgetDrag();
  if (moved) saveTimerWidgetOrigin();
  else focusMainWindowFromWidget();
});

// Escape hatch — right-click snaps back to the tray corner. Without it, a user
// who parks the widget somewhere odd has no way back short of editing a file.
// Right-click rather than double-click because left-click now focuses the app:
// a double-click gesture would fire that focus on its way through.
ipcMain.on('timer-widget:reset-position', (event) => {
  if (!fromTimerWidget(event)) return;
  endTimerWidgetDrag();
  timerWidgetCustomOrigin = null;
  positionTimerWidget();
  saveTimerWidgetOrigin();
});

function teardownTimerWidget() {
  endTimerWidgetDrag();
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

// ─── Snipping Tool ───────────────────────────────────────────────────
//
// A region capture that starts from a global keyboard shortcut or a menu-bar /
// tray item, with no app window open, and ends with a PNG handed to the
// renderer for upload. See documentation/snipping-tool.md.
//
// **Nothing is drawn over the user's screen.** The selection surface is a fully
// transparent window per display: the desktop stays live and visible, the cursor
// becomes a crosshair, and the only ink on screen is the rectangle being
// dragged. There is no scrim, no dimming and no frozen photograph of the
// desktop. A window still has to exist — no OS gives an application a global
// cursor change or global mouse capture without one — but it displays nothing.
//
// **The capture is taken AFTER the selection, not before it.** That ordering is
// what the transparent surface costs and it is worth being explicit about: the
// screen is photographed once the rectangle has been cleared and the surfaces
// hidden, so the selection border never ends up inside its own capture. The
// price is a ~100ms window in which live content could change under the
// rectangle; the alternative (freeze first, select over the still) is what this
// design deliberately replaced.
//
// **Main crops; the renderer never sees the full screen.** The surface reports a
// rectangle and main crops the `NativeImage`, so the only pixels that reach a
// web context are the ones the user selected. A surface that received the whole
// capture and cropped it in the page would be a full-screen screen-reader with
// a `file://` origin — which is also why `snip-preload.js` has no image channel
// at all.
//
// **The renderer owns the upload, not main.** Main has no Firebase session, and
// the bytes must go straight to Cloud Storage over a signed URL rather than
// through a Vercel function (rule 9i) — which is a fetch with an ID token on it.
const SNIP_PAGE = path.join(__dirname, 'snip.html');
const SNIP_PAGE_URL = pathToFileURL(SNIP_PAGE).href;
const SNIP_RECORD_PAGE = path.join(__dirname, 'snip-record.html');
const SNIP_RECORD_PAGE_URL = pathToFileURL(SNIP_RECORD_PAGE).href;
const SNIP_FRAME_PAGE = path.join(__dirname, 'snip-frame.html');

/**
 * How far the recording frame is grown beyond the recorded rectangle, per side.
 *
 * **This number is the reason the frame is not in the recording.** The window
 * is the rectangle grown by this much on every side, and `snip-frame.html`
 * draws its ring in exactly that margin — so the ink is outside the crop by
 * construction rather than by relying on `setContentProtection`, which behaves
 * differently across OS versions. Change the ring's thickness in that file and
 * this has to move with it.
 */
const SNIP_FRAME_PX = 3;

/**
 * The recording caps, mirrored from `src/lib/snips.ts`.
 *
 * Duplicated rather than imported, because main is not part of the Next.js
 * build and cannot import from `src/`. The server re-clamps the duration it is
 * sent and re-checks the byte size against the object, so these two are the
 * *user-facing* limits (the bar counts down against them) and not the
 * enforcement — which is what makes a drift between the copies a cosmetic bug
 * rather than a hole. Keep them in step anyway.
 */
const SNIP_MAX_RECORDING_MS = 10 * 60 * 1000;
const SNIP_RECORDING_WARN_MS = 60 * 1000;

/**
 * Whether the platform can hand us the desktop's own audio output.
 *
 * Electron's `setDisplayMediaRequestHandler` takes `audio: 'loopback'`, and
 * that is a **Windows** capability — macOS has no system-level loopback device
 * without the user installing a virtual audio driver, so asking for it there
 * yields a stream with no audio track rather than an error. The toggle is
 * disabled up front instead of failing silently after the take: see the
 * `sysaudio` flag passed into `snip.html`, and the recorder's own second check
 * for the case where a platform that claims support still returns no track.
 */
const SNIP_SYSTEM_AUDIO_SUPPORTED = process.platform === 'win32';

/** The control bar's window size. The height is a starting value — the page
 *  measures its own layout and asks for the real one via `snip:rec-place`. */
const SNIP_BAR_WIDTH = 380;
const SNIP_BAR_HEIGHT = 56;
/** Kept clear of the recorded rectangle by this much, when there is room. */
const SNIP_BAR_GAP = 14;

/**
 * How long to wait after hiding the surfaces before photographing the screen.
 *
 * Not a guess at a render time — it is a compositor round trip. `win.hide()`
 * returns immediately; the window is gone from the screen a frame or two later,
 * and `desktopCapturer` reads what the compositor has, not what Electron has
 * been told. Too short and the selection border is in its own capture. The page
 * already clears its marks and waits two animation frames before committing, so
 * this is the second of two belts.
 */
const SNIP_SETTLE_MS = 120;

/**
 * Pushed by the renderer, never persisted to disk.
 *
 * That is deliberate. A cached config would arm a global shortcut and a tray
 * item at launch, before anyone has signed in and before we know the page
 * permission still holds — so a revoked user would keep a working capture key
 * until they next opened the app. Arming only on the renderer's push costs a few
 * seconds after launch and makes revocation real.
 */
let snipConfig = {
  enabled: false,
  trayIconEnabled: true,
  shortcutEnabled: true,
  shortcut: null,
  // The System audio toggle's last state, pushed down with the rest of the
  // settings so the bar opens where the user left it. Main holds it only to
  // seed the surface; the durable copy is `users/{uid}.snipSettings`.
  systemAudioEnabled: false,
  // Off until a renderer says otherwise — see `snip:configure`.
  supportsRecording: false,
};
let snipTray = null;
/** The accelerator currently held with the OS, so it can be released exactly. */
let snipRegisteredShortcut = null;
/** BrowserWindow[] — one transparent surface per display while a snip is live. */
let snipOverlays = [];
/** win.id -> { display } for the surface's own display. */
const snipOverlayState = new Map();
/** Guards against a second trigger (a held-down shortcut, a double tray click)
 *  opening a second set of surfaces over the first. */
let snipInFlight = false;
/** Until every surface is on screen, a blur is us showing the next one — not the
 *  user leaving. See `armSnipOverlays`. */
let snipArmed = false;

function snipTrayIcon() {
  const file = process.platform === 'darwin' ? 'snipTemplate.png' : 'snip-win.png';
  const image = nativeImage.createFromPath(path.join(__dirname, 'public', 'tray', file));
  // `Template` in the filename is already enough for macOS to re-tint this for
  // the light/dark menu bar; setting it explicitly means a rename cannot quietly
  // turn the icon into a black-on-black blob. Windows draws the icon as-is,
  // which is why that platform gets a white asset instead.
  if (process.platform === 'darwin' && !image.isEmpty()) image.setTemplateImage(true);
  return image;
}

function destroySnipTray() {
  if (snipTray && !snipTray.isDestroyed()) snipTray.destroy();
  snipTray = null;
}

function ensureSnipTray() {
  if (!snipConfig.enabled || !snipConfig.trayIconEnabled) {
    destroySnipTray();
    return;
  }
  if (snipTray && !snipTray.isDestroyed()) return;

  const icon = snipTrayIcon();
  // A Tray built from an empty image is an invisible menu-bar item the user can
  // neither see nor click — worse than no tray at all.
  if (icon.isEmpty()) {
    console.error('[snip] tray icon asset missing — skipping tray');
    return;
  }

  snipTray = new Tray(icon);
  snipTray.setIgnoreDoubleClickEvents(true);
  snipTray.setToolTip('New snip');

  const menu = Menu.buildFromTemplate([
    { label: 'New Snip', click: () => { startSnip('tray-menu'); } },
    { type: 'separator' },
    {
      label: 'My Snips',
      click: () => {
        revealMainWindow();
        sendTo(mainWindow, 'snip:navigate', '/applications/snipping-tool');
      },
    },
  ]);

  // Platform split, and it is not cosmetic. On macOS `setContextMenu` makes a
  // LEFT click open the menu and suppresses the `click` event entirely, so the
  // one-click capture would be impossible; the menu is popped up manually on
  // right-click instead. On Windows a context menu is what right-click is for
  // and `click` still fires, so the standard wiring is correct there.
  if (process.platform === 'darwin') {
    snipTray.on('right-click', () => snipTray.popUpContextMenu(menu));
  } else {
    snipTray.setContextMenu(menu);
  }
  snipTray.on('click', () => { startSnip('tray'); });
}

/**
 * Registers (or releases) the global shortcut.
 *
 * Returns whether the accelerator is actually held, which the settings dialog
 * surfaces: `globalShortcut.register` returns **false** when another
 * application already owns the combination, and silently doing nothing would
 * leave the user pressing a key that belongs to someone else. It also *throws*
 * on a malformed accelerator rather than returning false, hence the try —
 * though `isValidSnipShortcut` on both the client and the API route should mean
 * a malformed one never reaches here.
 */
function applySnipShortcut() {
  if (snipRegisteredShortcut) {
    globalShortcut.unregister(snipRegisteredShortcut);
    snipRegisteredShortcut = null;
  }
  if (!snipConfig.enabled || !snipConfig.shortcutEnabled || !snipConfig.shortcut) {
    return false;
  }
  try {
    const registered = globalShortcut.register(snipConfig.shortcut, () => { startSnip('shortcut'); });
    if (registered) snipRegisteredShortcut = snipConfig.shortcut;
    else console.warn('[snip] shortcut already taken by another app:', snipConfig.shortcut);
    return registered;
  } catch (err) {
    console.error('[snip] shortcut registration failed:', err.message);
    return false;
  }
}

/** Take every surface off the screen without destroying it. The capture runs
 *  between this and `teardownSnip`, so the windows have to stop being on screen
 *  before their state is thrown away. */
function hideSnipOverlays() {
  snipArmed = false;
  for (const win of snipOverlays) {
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  }
}

function teardownSnip() {
  snipArmed = false;
  for (const win of snipOverlays) {
    if (win && !win.isDestroyed()) win.destroy();
  }
  snipOverlays = [];
  snipOverlayState.clear();
  snipInFlight = false;
}

/**
 * Called once every surface is on screen.
 *
 * Only *after* this does a blur mean the user left, and only when there is a
 * single surface: with two displays there are two windows and exactly one can
 * be key, so treating the non-key one's blur as "user left" would cancel the
 * snip the moment it opened. On a multi-display setup Escape and right-click
 * are the escape hatches, and every surface accepts both.
 */
function armSnipOverlays() {
  snipArmed = true;
  if (snipOverlays.length !== 1) return;
  const win = snipOverlays[0];
  if (!win || win.isDestroyed()) return;
  win.on('blur', () => {
    if (snipArmed) teardownSnip();
  });
}

/**
 * Photographs one display and returns its `NativeImage`.
 *
 * Called AFTER the surfaces are hidden. `desktopCapturer` takes one
 * `thumbnailSize` for every source, so it is the bounding box of the largest
 * display in device pixels and each capture is fitted inside it preserving
 * aspect ratio — which is why the caller reads the returned image's ACTUAL size
 * rather than assuming `scaleFactor`. That is what makes a mixed-DPI setup (a
 * Retina laptop beside a 1080p monitor) crop correctly.
 */
async function captureDisplay(display) {
  // macOS gates screen capture behind a TCC grant, and when it is missing
  // `desktopCapturer` does not throw — it hands back sources whose thumbnails
  // are empty. Checking the status first is the only way to tell "you have not
  // allowed this" apart from "the capture genuinely failed", and they need
  // completely different advice: one is a settings toggle, the other is a retry.
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    return { error: 'permission' };
  }

  const displays = electronScreen.getAllDisplays();
  const box = displays.reduce(
    (acc, d) => ({
      width: Math.max(acc.width, Math.round(d.size.width * (d.scaleFactor || 1))),
      height: Math.max(acc.height, Math.round(d.size.height * (d.scaleFactor || 1))),
    }),
    { width: 0, height: 0 },
  );

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: box,
    fetchWindowIcons: false,
  });
  if (sources.length === 0) return { error: 'no-sources' };

  // `display_id` is the reliable pairing; index order is the fallback for
  // platforms/versions that leave it blank.
  const index = displays.findIndex(d => d.id === display.id);
  const match =
    sources.find(s => s.display_id && String(s.display_id) === String(display.id)) ||
    sources[index] ||
    sources[0];

  // An empty thumbnail with the permission granted means the compositor gave us
  // nothing for this display — a monitor unplugged or a resolution change inside
  // the settle window is the realistic cause.
  if (!match || match.thumbnail.isEmpty()) return { error: 'empty' };
  return { shot: match.thumbnail };
}

async function startSnip(source) {
  if (!snipConfig.enabled) return { success: false, error: 'disabled' };
  if (snipInFlight) return { success: false, error: 'busy' };
  // A recording holds the screen in a way a still capture does not: the
  // selection surfaces are full-screen and always-on-top, so opening a second
  // set over a live recording would both appear in that recording and leave
  // the user unable to reach the Stop button underneath them. The shortcut is
  // global, so this is reachable by a stray keypress rather than only by a
  // deliberate second click.
  if (snipRecording) return { success: false, error: 'recording' };
  snipInFlight = true;

  try {
    const displays = electronScreen.getAllDisplays();
    if (displays.length === 0) throw new Error('no displays');

    // Resolved BEFORE the surfaces are built, not after. It decides two things
    // now: which surface takes the keyboard (below) and which one draws the
    // mode bar — and the bar has to be chosen at `loadFile` time, because it is
    // a query parameter on the page.
    const cursorDisplay = electronScreen.getDisplayNearestPoint(
      electronScreen.getCursorScreenPoint(),
    );

    /** Resolves once each surface has loaded — see the comment by `loaded.push`. */
    const loaded = [];

    for (const display of displays) {
      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        // The whole design. With an opaque window there is nothing to select
        // over but a photograph; with this, the user's real desktop stays live
        // underneath and the only thing they see change is their cursor.
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'snip-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
      });

      // `screen-saver` rather than plain alwaysOnTop: the surface has to sit
      // above the macOS menu bar and the Windows taskbar, or a selection that
      // runs to the edge of the screen is clipped by chrome the user cannot
      // move out of the way.
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

      // It renders a static local page and needs none of attachWindowBehaviour's
      // navigation/offline/crash policy — but it must still be unable to
      // navigate: it is an invisible, always-on-top window watching the mouse.
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (e, url) => {
        if (url.split('?')[0] !== SNIP_PAGE_URL) e.preventDefault();
      });

      snipOverlayState.set(win.id, { display });
      snipOverlays.push(win);

      // Armed BEFORE loadFile, not after. A local file can finish loading in the
      // same tick, and a listener attached afterwards would miss the event and
      // leave every surface waiting on the fallback below.
      loaded.push(new Promise(resolve => {
        win.webContents.once('did-finish-load', () => resolve());
        setTimeout(resolve, 3000);
      }));

      // The mode bar is drawn by exactly ONE surface — the display the cursor
      // is on. Two bars on two monitors would be two sets of toggles
      // disagreeing about a single capture, and the user would have no way to
      // tell which one the commit read.
      const controls = display.id === cursorDisplay.id;
      win.loadFile(SNIP_PAGE, {
        query: {
          controls: controls ? '1' : '0',
          // Not a constant: an old renderer cannot receive a recording, so a
          // shell that can make one must not offer it. See
          // `supportsRecording` in `snip:configure`.
          video: snipConfig.supportsRecording ? '1' : '0',
          sysaudio: SNIP_SYSTEM_AUDIO_SUPPORTED ? '1' : '0',
          sys: snipConfig.systemAudioEnabled ? '1' : '0',
        },
      });
    }

    if (snipOverlays.length === 0) throw new Error('no surface could be opened');

    await Promise.all(loaded);

    // The user may have quit, or a second trigger may have torn this down, while
    // those loads were in flight.
    if (snipOverlays.length === 0) return { success: false, error: 'cancelled' };

    for (const win of snipOverlays) {
      if (!win.isDestroyed()) win.show();
    }

    // Exactly one surface can hold the keyboard, so it has to be the one on the
    // screen the user is actually looking at — otherwise Escape does nothing on
    // the monitor they are pointing at. The cursor is the best available proxy
    // for that, and it is where the drag is about to start anyway. It is also
    // the surface carrying the mode bar, which needs focus to be operable.
    const live = snipOverlays.filter(w => !w.isDestroyed());
    const focusTarget =
      live.find(w => snipOverlayState.get(w.id)?.display.id === cursorDisplay.id) || live[0];
    if (focusTarget) focusTarget.focus();

    armSnipOverlays();
    return { success: true };
  } catch (err) {
    console.error('[snip] start failed:', err.message, `(from ${source})`);
    teardownSnip();
    return { success: false, error: err.message };
  }
}

/** Clamp a surface-reported rectangle into the capture it is supposed to be
 *  inside. The surface is a renderer, so its numbers are untrusted input — and
 *  `NativeImage.crop` with an out-of-bounds rect returns an empty image. */
function clampCrop(rect, width, height) {
  const x = Math.max(0, Math.min(Math.round(rect.x), width - 1));
  const y = Math.max(0, Math.min(Math.round(rect.y), height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(rect.width), width - x)),
    height: Math.max(1, Math.min(Math.round(rect.height), height - y)),
  };
}

ipcMain.on('snip:region', async (event, commit) => {
  const win = senderWindow(event);
  const state = win ? snipOverlayState.get(win.id) : null;
  // Only a live surface may report a region. Without this check any renderer
  // that guessed the channel could ask main to photograph the screen and hand
  // the result to the main window.
  if (!state) return;

  // The payload grew a mode and an audio map when recording was added; a
  // bare rectangle is still accepted so the shapes cannot drift apart if one
  // side is ever updated without the other.
  const rect = commit && commit.rect ? commit.rect : commit;
  const mode = commit && commit.mode === 'video' ? 'video' : 'image';
  const audio = {
    // Re-checked against the platform here and not merely trusted from the
    // page: the surface is a renderer, and a loopback request on a platform
    // that cannot serve one produces a stream that is silently short an audio
    // track rather than an error.
    system: SNIP_SYSTEM_AUDIO_SUPPORTED && !!(commit && commit.audio && commit.audio.system),
  };

  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    teardownSnip();
    return;
  }

  const { display } = state;

  if (mode === 'video') {
    // The surfaces come down and STAY down for a recording. They are
    // full-screen and always-on-top, so leaving them up would mean the user
    // cannot touch the thing they are recording — which is the entire point of
    // recording a region rather than photographing one.
    hideSnipOverlays();
    await new Promise(resolve => setTimeout(resolve, SNIP_SETTLE_MS));
    teardownSnip();
    startSnipRecording({ display, rect, audio });
    return;
  }

  // Off the screen FIRST. The surfaces are transparent and contribute nothing to
  // the screen image, but the selection rectangle is real ink — photographing
  // before hiding would frame every capture in its own blue border. The page has
  // already cleared its marks and waited two frames; this hides the windows and
  // waits for the compositor to catch up.
  hideSnipOverlays();
  await new Promise(resolve => setTimeout(resolve, SNIP_SETTLE_MS));

  let payload = null;
  let failure = 'unknown';
  try {
    const { shot, error } = await captureDisplay(display);
    if (error) failure = error;
    if (shot) {
      const shotSize = shot.getSize();
      // CSS pixels on the surface → device pixels in the capture. Derived from
      // the capture's ACTUAL size rather than from `scaleFactor`, because
      // `desktopCapturer` fits each thumbnail inside one requested box and a
      // display smaller than the largest comes back scaled by something else.
      const sx = shotSize.width / display.size.width;
      const sy = shotSize.height / display.size.height;

      const crop = clampCrop(
        { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy },
        shotSize.width,
        shotSize.height,
      );

      failure = 'crop';
      const cropped = shot.crop(crop);
      const size = cropped.getSize();
      payload = {
        dataBase64: cropped.toPNG().toString('base64'),
        width: size.width,
        height: size.height,
      };
    }
  } catch (err) {
    console.error(`[snip] capture failed (${failure}):`, err.message);
  }

  teardownSnip();

  if (payload) {
    sendTo(mainWindow, 'snip:captured', payload);
  } else {
    // Logged here and not only in the catch: `captureDisplay` returning a reason
    // is not an exception, so this branch used to produce a user-visible toast
    // with NOTHING in the log to explain it. A failure the user can see and
    // nobody can diagnose is the worst of both.
    console.error(`[snip] capture produced nothing (${failure})`);
    sendTo(mainWindow, 'snip:failed', { reason: failure });
  }
});

ipcMain.on('snip:cancel', (event) => {
  const win = senderWindow(event);
  if (!win || !snipOverlayState.has(win.id)) return;
  teardownSnip();
});

// ─── Screen recording ────────────────────────────────────────────────
//
// The still path above is finished the moment `desktopCapturer` returns. A
// recording is a session, and it is shaped by four constraints that pull in
// different directions:
//
//   1. **The user needs their desktop back.** The selection surfaces are
//      full-screen and always-on-top, so they are destroyed before recording
//      starts, and a small control bar takes their place.
//   2. **The bar cannot be in the recording it controls.** It is marked
//      content-protected, and positioned outside the recorded rectangle when
//      there is room — two independent measures, because content protection's
//      behaviour varies by OS version and a bar that turns into a black box in
//      the middle of someone's recording is barely better than one that shows.
//   3. **The stream must not reach remote content.** The recorder is a local
//      `file://` page with its own preload; the main window — which loads the
//      deployment — is never handed a desktop stream. That is the same rule
//      that keeps the selection surface image-free, applied to video.
//   4. **The bytes must not pass through renderer memory in bulk, or through
//      Vercel at all** (rule 9i). Chunks stream renderer → main → a temp file
//      on disk, and main PUTs that file straight to Cloud Storage over a
//      signed URL the app window fetched. A ten-minute recording never exists
//      as a single object in any heap.
//
// The session ends in exactly one of three ways — uploaded, discarded, or
// failed — and every one of them runs `clearSnipRecording`, which is the only
// thing that removes the temp file.

/**
 * The live recording, or null. At most one at a time.
 *
 * `{ window, tempPath, stream, bytes, poster, display, rect, audio, token,
 *    settled }`
 */
let snipRecording = null;

// ─── The durable upload queue ────────────────────────────────────────
//
// **A recording that fails to upload must not be lost.** That is the whole
// reason this is a directory on disk rather than a Map and a temp file.
//
// A screenshot is cheap to retake: the failure costs a second and the user
// still has the thing they were looking at. A ten-minute recording is not —
// by the time the upload fails the moment is gone, the demo has finished, the
// bug no longer reproduces. Losing one is losing work, so the bytes are
// written somewhere durable from the first chunk and stay there until an
// upload actually succeeds or the user says otherwise.
//
// Three properties follow, and each is deliberate:
//
//   • **`userData`, not `os.tmpdir()`.** A temp directory is something the OS
//     is entitled to empty, and on Windows it routinely does. A queued
//     recording has to survive a reboot.
//   • **Written straight into the queue**, not moved there on completion.
//     A crash mid-recording then leaves a playable partial file rather than
//     nothing at all.
//   • **A sidecar `.json` per recording**, so the queue survives the process.
//     The in-memory Map is an index rebuilt from disk at startup, never the
//     source of truth.

/** `userData/pending-recordings/` — created lazily on first use. */
let snipQueueDir = null;

function ensureSnipQueueDir() {
  if (!snipQueueDir) {
    snipQueueDir = path.join(app.getPath('userData'), 'pending-recordings');
    fs.mkdirSync(snipQueueDir, { recursive: true });
  }
  return snipQueueDir;
}

const snipQueuePaths = (token) => {
  const dir = ensureSnipQueueDir();
  return {
    video: path.join(dir, `${token}.webm`),
    poster: path.join(dir, `${token}.png`),
    meta: path.join(dir, `${token}.json`),
  };
};

/**
 * `token -> metadata`, rebuilt from disk at startup.
 *
 * **The renderer is given the token, never the path.** A path handed to the
 * app window is a path that window can be talked into reading or overwriting;
 * a token resolves only inside main, and only to a file main itself wrote.
 * Same reasoning as the download handler's refusal to open a path it did not
 * create.
 */
const snipQueue = new Map();

/**
 * How long a recording nobody has dealt with is kept.
 *
 * Long, because the file is the *backup*: the point of this queue is that a
 * failed upload is recoverable, and a user who closed their laptop on Friday
 * must still find their recording on Monday. It is not the 30-minute reaper
 * this replaced — that deleted exactly the work this is now protecting.
 *
 * It is a floor on "we will not fill your disk forever", not a deadline the
 * user is expected to race.
 */
const SNIP_QUEUE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Total queue size before the oldest entries are dropped regardless of age. */
const SNIP_QUEUE_MAX_BYTES = 4 * 1024 * 1024 * 1024;

function writeSnipQueueMeta(token, patch) {
  const current = snipQueue.get(token) || {};
  const next = { ...current, ...patch, token };
  snipQueue.set(token, next);
  try {
    fs.writeFileSync(snipQueuePaths(token).meta, JSON.stringify(next, null, 2));
  } catch (err) {
    // The bytes matter more than the bookkeeping: a recording whose sidecar
    // cannot be written is still a recording on disk, and the startup scan
    // below reconstructs what it can from the file itself.
    console.error('[snip] could not write queue metadata:', err.message);
  }
  notifySnipQueueChanged();
  return next;
}

function removeSnipQueueEntry(token) {
  const entry = snipQueue.get(token);
  snipQueue.delete(token);
  const paths = snipQueuePaths(token);
  for (const file of [paths.video, paths.poster, paths.meta]) {
    fsp.unlink(file).catch(() => { /* never existed, or already gone */ });
  }
  notifySnipQueueChanged();
  return entry || null;
}

/**
 * What the renderer is allowed to know about the queue.
 *
 * No paths. The Snipping Tool page renders these as rows with a Retry, a Save
 * a copy and a Delete, and none of those needs to know where the file lives.
 */
function snipQueueSnapshot() {
  return [...snipQueue.values()]
    // Newest first: a failure the user just hit is the one they are looking
    // for. The retry sweep walks the opposite way, oldest first.
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map(entry => ({
      token: entry.token,
      createdAt: entry.createdAt || 0,
      durationMs: entry.durationMs || 0,
      width: entry.width || 0,
      height: entry.height || 0,
      bytes: entry.bytes || 0,
      hasPoster: !!entry.hasPoster,
      attempts: entry.attempts || 0,
      lastError: entry.lastError || null,
      lastAttemptAt: entry.lastAttemptAt || 0,
      state: entry.state || 'pending',
    }));
}

function notifySnipQueueChanged() {
  sendTo(mainWindow, 'snip:pending-changed', snipQueueSnapshot());
}

/**
 * Rebuilds the queue from disk at startup, and prunes what has aged out.
 *
 * A `.webm` with no readable sidecar is still kept — the metadata is a
 * convenience, the recording is the thing. It comes back with zeroed duration
 * and dimensions, which the page renders as "unknown"; refusing to list it
 * would mean deleting a user's work over a missing JSON file.
 */
function loadSnipQueue() {
  let files;
  try {
    files = fs.readdirSync(ensureSnipQueueDir());
  } catch (err) {
    console.error('[snip] could not read the recording queue:', err.message);
    return;
  }

  const now = Date.now();
  for (const file of files) {
    if (!file.endsWith('.webm')) continue;
    const token = file.slice(0, -'.webm'.length);
    const paths = snipQueuePaths(token);

    let stat;
    try {
      stat = fs.statSync(paths.video);
    } catch {
      continue;
    }

    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(paths.meta, 'utf8'));
    } catch {
      // Sidecar missing or corrupt — see the note above.
    }

    const createdAt = meta.createdAt || stat.mtimeMs;
    if (now - createdAt > SNIP_QUEUE_TTL_MS) {
      console.warn('[snip] dropping a queued recording past its retention');
      snipQueue.set(token, { token });
      removeSnipQueueEntry(token);
      continue;
    }

    snipQueue.set(token, {
      ...meta,
      token,
      createdAt,
      bytes: stat.size,
      hasPoster: fs.existsSync(paths.poster),
      // An entry that was mid-upload when the process died is pending again,
      // not stuck: the only state that survives a restart is "there are bytes
      // here that have not been stored".
      state: meta.state === 'uploading' ? 'pending' : meta.state || 'pending',
    });
  }

  // Oldest first out, once the queue is larger than anyone intends to keep.
  let total = [...snipQueue.values()].reduce((sum, e) => sum + (e.bytes || 0), 0);
  if (total > SNIP_QUEUE_MAX_BYTES) {
    const oldest = [...snipQueue.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const entry of oldest) {
      if (total <= SNIP_QUEUE_MAX_BYTES) break;
      console.warn('[snip] dropping a queued recording to stay under the queue size cap');
      total -= entry.bytes || 0;
      removeSnipQueueEntry(entry.token);
    }
  }

  if (snipQueue.size > 0) {
    console.log(`[snip] ${snipQueue.size} recording(s) waiting to upload`);
  }
}

/**
 * Where the control bar sits: under the recorded rectangle if it fits, above
 * it if not, and pinned to the bottom of the display when the selection is
 * tall enough to leave no room for either.
 *
 * Content protection is what actually keeps it out of the recording; this is
 * the belt to that pair of braces, and it is also plain courtesy — a bar
 * sitting on top of the thing being demonstrated is in the user's way even
 * when it is invisible to the capture.
 */
function snipBarBounds(display, rect, height) {
  const bounds = display.bounds;
  const width = SNIP_BAR_WIDTH;

  const below = rect.y + rect.height + SNIP_BAR_GAP;
  const above = rect.y - SNIP_BAR_GAP - height;
  let y;
  if (below + height <= bounds.height) y = below;
  else if (above >= 0) y = above;
  else y = bounds.height - height - SNIP_BAR_GAP;

  // Centred on the selection rather than on the display: the user's attention
  // is on the rectangle, and on an ultrawide the middle of the screen can be a
  // foot away from it.
  let x = Math.round(rect.x + rect.width / 2 - width / 2);
  x = Math.max(0, Math.min(x, bounds.width - width));
  y = Math.max(0, Math.min(y, bounds.height - height));

  return {
    x: bounds.x + x,
    y: bounds.y + Math.round(y),
    width,
    height,
  };
}

/**
 * The click-through border marking what is being recorded.
 *
 * Two properties make this safe to leave on screen for ten minutes, and both
 * are non-negotiable:
 *
 *   1. **It cannot be clicked.** `setIgnoreMouseEvents(true)` with no
 *      forwarding, because nothing in it is interactive — every click, drag
 *      and scroll inside the recorded region goes straight through to whatever
 *      the user is actually demonstrating. A frame that ate clicks would make
 *      the region it marks unusable, which is the opposite of the point.
 *   2. **It is outside the crop.** The window is the rectangle grown by
 *      `SNIP_FRAME_PX` per side and the ring is drawn in that margin, so the
 *      border is not in the recording because it is not over it. Content
 *      protection is the second belt.
 */
function createSnipFrame(display, rect) {
  const bounds = display.bounds;
  // Clamped to the display. A selection flush against an edge would otherwise
  // put the window partly offscreen; the frame then overlaps the crop by a few
  // pixels on that side, which is a far better outcome than no frame at all.
  const x = Math.max(0, rect.x - SNIP_FRAME_PX);
  const y = Math.max(0, rect.y - SNIP_FRAME_PX);
  const width = Math.min(rect.width + SNIP_FRAME_PX * 2, bounds.width - x);
  const height = Math.min(rect.height + SNIP_FRAME_PX * 2, bounds.height - y);

  const win = new BrowserWindow({
    x: bounds.x + x,
    y: bounds.y + y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    // Never takes focus, so it cannot steal the keyboard from the application
    // the user went back to.
    focusable: false,
    show: false,
    webPreferences: {
      // No preload at all. This page has no script and nothing to say to main.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  try {
    win.setContentProtection(true);
  } catch {
    // Geometry already keeps the ring out of the crop; this is the second belt.
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  win.loadFile(SNIP_FRAME_PAGE);
  return win;
}

async function startSnipRecording({ display, rect, audio }) {
  if (snipRecording) return;

  // The same up-front check the still path makes, for the same reason:
  // `getDisplayMedia` does not throw when macOS has not granted Screen
  // Recording — it hands back a stream of empty frames — and "you have not
  // allowed this" needs completely different advice from "that failed".
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    sendTo(mainWindow, 'snip:failed', { reason: 'permission' });
    return;
  }

  const id = crypto.randomBytes(12).toString('hex');
  // Straight into the durable queue, not a temp file that is moved on success.
  // A crash mid-recording then leaves a playable partial rather than nothing.
  const tempPath = snipQueuePaths(id).video;

  let stream;
  try {
    stream = fs.createWriteStream(tempPath);
    // A write stream with no `error` listener throws its errors at the process,
    // and a disk filling up mid-recording would take the whole app with it.
    // The recording is lost either way; the app must not be.
    stream.on('error', (err) => {
      console.error('[snip] writing the recording failed:', err.message);
      if (snipRecording && snipRecording.stream === stream) {
        clearSnipRecording();
        sendTo(mainWindow, 'snip:failed', { reason: 'storage' });
      }
    });
  } catch (err) {
    console.error('[snip] could not open a temp file for the recording:', err.message);
    sendTo(mainWindow, 'snip:failed', { reason: 'storage' });
    return;
  }

  const bounds = snipBarBounds(display, rect, SNIP_BAR_HEIGHT);
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'snip-record-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // NOT sandboxed, unlike the selection surface. `MediaRecorder` and
      // `AudioContext` are ordinary web APIs and work fine in a sandbox — but
      // the page needs no Node either way, so this stays as tight as the
      // surface and differs only where it has to.
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // Above the menu bar and the taskbar, like the selection surface: a bar the
  // OS chrome can cover is a Stop button the user cannot reach.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // **Click-through everywhere except the bar itself.**
  //
  // A transparent window still swallows clicks on its transparent pixels, so
  // without this the bar's shadow margin and the transparent wedges outside
  // its rounded corners would be dead zones sitting on top of the user's
  // desktop — invisible, and eating clicks on whatever they are recording.
  //
  // `forward: true` is what makes it recoverable: mouse *move* events still
  // reach the page while clicks pass through, so the page can see the cursor
  // arrive over the bar and ask for interactivity back (`snip:rec-interactive`
  // below). Without forwarding, the bar would be permanently unclickable.
  win.setIgnoreMouseEvents(true, { forward: true });

  // **The bar must not appear in the recording it is making.** On Windows 10
  // 2004+ this excludes the window from capture entirely; on macOS it sets
  // `NSWindowSharingNone`. On an older Windows it renders as a black rectangle
  // in the capture instead of being absent — which is why `snipBarBounds`
  // keeps it outside the recorded region whenever the geometry allows.
  try {
    win.setContentProtection(true);
  } catch (err) {
    console.warn('[snip] content protection unavailable:', err.message);
  }

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split('?')[0] !== SNIP_RECORD_PAGE_URL) e.preventDefault();
  });

  snipRecording = {
    id,
    window: win,
    frame: createSnipFrame(display, rect),
    tempPath,
    stream,
    bytes: 0,
    poster: null,
    display,
    rect,
    audio,
    settled: false,
  };

  win.once('ready-to-show', () => {
    // `showInactive`, not `show`. The user committed a rectangle and is about
    // to go and use the thing they are recording; an always-on-top bar that
    // grabs focus as it appears steals the first keystroke of the take. It is
    // still focusable — clicking Stop focuses it, and from there the controls
    // are keyboard-reachable.
    if (!win.isDestroyed()) win.showInactive();
  });

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    sendTo(win, 'snip:rec-start', {
      rect,
      // CSS pixels. The recorder derives its own scale from the stream's real
      // resolution against these, exactly as the still path derives it from
      // the thumbnail's real size — never from `scaleFactor`.
      display: { width: display.size.width, height: display.size.height },
      audio,
      limits: { maxMs: SNIP_MAX_RECORDING_MS, warnMs: SNIP_RECORDING_WARN_MS },
    });

    // **`getDisplayMedia` requires transient user activation, and an IPC
    // message does not carry one.** This window was opened by main and shown
    // with `showInactive`, so nothing has ever been clicked in it — the user's
    // actual gesture was a drag in a different window that has since been
    // destroyed, and activation does not travel between windows.
    //
    // `executeJavaScript`'s second argument synthesises that activation, which
    // is the whole reason the start is invoked this way rather than run
    // straight out of the message handler above. The page keeps a 400ms
    // fallback in case this never lands.
    win.webContents
      .executeJavaScript('window.__snipBeginCapture && window.__snipBeginCapture()', true)
      .catch((err) => {
        // Not fatal — the page's own fallback still fires. Logged because a
        // recording that then fails on activation would otherwise have no
        // explanation anywhere.
        console.error('[snip] could not start the capture with a user gesture:', err.message);
      });
  });

  // The window going away without a `done` or a `discard` is a crash or a
  // force-quit. The temp file is ours to clean up either way.
  win.on('closed', () => {
    if (snipRecording && snipRecording.window === win && !snipRecording.settled) {
      console.error('[snip] the recorder window closed mid-recording');
      sendTo(mainWindow, 'snip:failed', { reason: 'recorder-lost' });
      clearSnipRecording();
    }
  });

  win.loadFile(SNIP_RECORD_PAGE);
}

/**
 * Tears the session down and removes the temp file.
 *
 * Called on every exit from a recording — uploaded, discarded, failed, window
 * lost. `keepFile` is passed only by the handoff to the upload queue, which
 * takes ownership of the file rather than letting this delete it.
 */
function clearSnipRecording(keepFile = false) {
  const recording = snipRecording;
  snipRecording = null;
  if (!recording) return;

  recording.settled = true;
  // Guarded, not try/caught. A second `end()` on an already-ended stream emits
  // an asynchronous `error` — which a try/catch here would NOT see, and an
  // unhandled stream error takes the main process down. `snip:rec-done` ends
  // the stream itself (it has to wait for the flush before the file is read),
  // and then calls this.
  if (!recording.stream.writableEnded) {
    try { recording.stream.end(); } catch { /* already closed */ }
  }
  if (recording.window && !recording.window.isDestroyed()) recording.window.destroy();
  // The frame goes with the session, always. An always-on-top border left on
  // screen after a recording ended would be unremovable from the user's side —
  // it is click-through and unfocusable, so there is nothing to close.
  if (recording.frame && !recording.frame.isDestroyed()) recording.frame.destroy();
  if (!keepFile) {
    fsp.unlink(recording.tempPath).catch(() => { /* never created, or already gone */ });
  }
}

/** Only the live recorder window may drive the channels below. */
function recordingFrom(event) {
  const win = senderWindow(event);
  if (!snipRecording || !win || win !== snipRecording.window) return null;
  return snipRecording;
}

ipcMain.on('snip:rec-chunk', (event, buffer) => {
  const recording = recordingFrom(event);
  if (!recording || recording.settled) return;
  const chunk = Buffer.from(buffer);
  recording.bytes += chunk.length;
  recording.stream.write(chunk);
});

ipcMain.on('snip:rec-poster', (event, buffer) => {
  const recording = recordingFrom(event);
  if (!recording) return;
  // Held in memory rather than written beside the video: it is one PNG of a
  // single frame, it is uploaded in the same breath as the recording, and a
  // second temp file is a second thing that can be left behind.
  recording.poster = Buffer.from(buffer);
});

/**
 * The page reporting whether the cursor is over the bar itself.
 *
 * This is the other half of the `setIgnoreMouseEvents(true, {forward: true})`
 * above: the window is click-through by default so the user can work on the
 * desktop underneath it, and becomes clickable only while the pointer is
 * actually on the bar. `forward` keeps mouse-move events flowing to the page
 * so it can tell us when that happens.
 *
 * Forwarding stays on in BOTH states. Dropping it while interactive would mean
 * the page never sees the pointer leave, and the bar would keep swallowing
 * clicks for the rest of the recording.
 */
ipcMain.on('snip:rec-interactive', (event, interactive) => {
  const recording = recordingFrom(event);
  if (!recording) return;
  const win = recording.window;
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
});

/** Mirrors pause/resume onto the frame, which has no script of its own. */
ipcMain.on('snip:rec-state', (event, state) => {
  const recording = recordingFrom(event);
  if (!recording) return;
  const frame = recording.frame;
  if (!frame || frame.isDestroyed()) return;
  const paused = state === 'paused';
  frame.webContents
    .executeJavaScript(
      `document.documentElement.setAttribute('data-state', ${JSON.stringify(paused ? 'paused' : 'recording')})`,
    )
    .catch(() => { /* the frame is going away; the colour no longer matters */ });
});

ipcMain.on('snip:rec-place', (event, box) => {
  const recording = recordingFrom(event);
  if (!recording || !box) return;
  const height = Math.max(SNIP_BAR_HEIGHT, Math.min(Math.round(Number(box.height) || 0), 240));
  const win = recording.window;
  if (!win || win.isDestroyed()) return;
  win.setBounds(snipBarBounds(recording.display, recording.rect, height));
});

ipcMain.on('snip:rec-done', (event, summary) => {
  const recording = recordingFrom(event);
  if (!recording || recording.settled) return;

  const { poster, bytes, id } = recording;
  const durationMs = Math.max(0, Math.round(Number(summary && summary.durationMs) || 0));
  const width = Math.max(1, Math.round(Number(summary && summary.width) || 0));
  const height = Math.max(1, Math.round(Number(summary && summary.height) || 0));

  // The write stream has to be flushed and closed before anything reads the
  // file — a PUT that starts while the last cluster is still buffered uploads
  // a truncated WebM, and a truncated WebM plays right up to the point it was
  // cut and then stops, which is the kind of corruption nobody notices until
  // the recipient does.
  recording.settled = true;
  recording.stream.end(() => {
    if (bytes <= 0) {
      console.error('[snip] the recording produced no data');
      sendTo(mainWindow, 'snip:failed', { reason: 'empty-recording' });
      // Nothing to keep, so nothing to queue. An empty file is not work.
      snipQueue.set(id, { token: id });
      removeSnipQueueEntry(id);
      return;
    }
    // The poster is written beside the video rather than held in memory: the
    // queue has to survive a restart, and a thumbnail that only exists in this
    // process would be lost on the retry that matters most.
    if (poster) {
      try {
        fs.writeFileSync(snipQueuePaths(id).poster, poster);
      } catch (err) {
        console.error('[snip] could not write the poster frame:', err.message);
      }
    }

    writeSnipQueueMeta(id, {
      createdAt: Date.now(),
      durationMs,
      width,
      height,
      bytes,
      hasPoster: !!poster && fs.existsSync(snipQueuePaths(id).poster),
      attempts: 0,
      lastError: null,
      state: 'pending',
    });

    sendTo(mainWindow, 'snip:recorded', {
      token: id,
      durationMs,
      width,
      height,
      bytes,
      hasPoster: !!poster && fs.existsSync(snipQueuePaths(id).poster),
    });
  });

  clearSnipRecording(true);
});

ipcMain.on('snip:rec-discard', (event) => {
  if (!recordingFrom(event)) return;
  clearSnipRecording();
});

ipcMain.on('snip:rec-failed', (event, payload) => {
  const recording = recordingFrom(event);
  if (!recording) return;
  let reason = payload && typeof payload.reason === 'string' ? payload.reason : 'unknown';
  if (payload && payload.detail) console.error(`[snip] recording failed (${reason}):`, payload.detail);
  else console.error(`[snip] recording failed (${reason})`);

  // The page reports what `getDisplayMedia` told it, and that is not enough to
  // diagnose with: an empty grant from OUR OWN handler rejects with exactly the
  // same `NotAllowedError` as the OS refusing screen capture. Main knows which
  // it was, so main corrects the reason rather than letting the renderer guess.
  if (reason === 'screen-permission' && recording.denied) {
    reason = recording.denied;
  } else if (reason === 'screen-permission' && process.platform !== 'darwin') {
    // **Windows has no per-app Screen Recording permission at all.** There is
    // no setting to turn on and nothing to open, so telling a Windows user to
    // grant one sends them looking for a switch that does not exist. macOS is
    // the only platform where this reason is actionable.
    reason = 'stream-refused';
  }

  clearSnipRecording();
  sendTo(mainWindow, 'snip:failed', { reason });
});

/**
 * Uploading a recording, from MAIN.
 *
 * **Main uploads, and this is the one place in the app where that is true.**
 * Everywhere else the renderer PUTs its own bytes; here it cannot, for three
 * reasons that all point the same way. The file is on disk and the renderer
 * has no path to it (deliberately). A ten-minute recording read into renderer
 * memory to be PUT is a few hundred megabytes in a heap that is also running
 * the app. And streaming it from disk means the peak memory of an upload is
 * one socket buffer, whatever the recording's length.
 *
 * The signed URL is the capability — minted by an authenticated route against
 * the caller's own page permission and quota — so main is not deciding
 * anything here beyond "send these bytes there".
 */
/**
 * One HTTPS request, with the body either a Buffer, a file slice, or nothing.
 *
 * Deliberately low level: every caller below needs the status AND specific
 * response headers (`Location` to start a session, `Range` to resume one), so
 * a helper that only reported success would have to be unwrapped again.
 */
function snipRequest({ url, method, headers, body, filePath, start, end }) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      resolve({ ok: false, status: 0, error: 'The upload URL was not valid' });
      return;
    }
    // A signed Storage URL is always https. Accepting anything else would make
    // this a general-purpose file exfiltration primitive driven by whatever
    // the renderer passed in.
    if (target.protocol !== 'https:') {
      resolve({ ok: false, status: 0, error: 'The upload URL was not https' });
      return;
    }

    const request = https.request(target, { method, headers }, (response) => {
      // Drained rather than ignored: an undrained response holds the socket
      // open and fills the agent's pool.
      response.resume();
      response.on('end', () => {
        const status = response.statusCode || 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: response.headers,
          error: status >= 200 && status < 300 ? null : `HTTP ${status}`,
        });
      });
    });

    request.on('error', (err) => {
      resolve({ ok: false, status: 0, error: err.message || 'The connection failed' });
    });

    if (filePath) {
      const source = fs.createReadStream(filePath, { start, end });
      source.on('error', () => {
        request.destroy();
        resolve({ ok: false, status: 0, error: 'The recording file could not be read' });
      });
      source.pipe(request);
    } else {
      request.end(body);
    }
  });
}

/**
 * Whether a failure is worth trying again.
 *
 * The distinction matters more here than in most places: retrying a 403 burns
 * minutes of a user's upload allowance to arrive at the same refusal, while
 * *not* retrying a dropped socket throws away a recording over a blip. So the
 * rule is narrow and explicit — transport failures, rate limits and 5xx are
 * transient; every other 4xx is the server telling us something a retry
 * cannot change (a bad signature, an expired session, a refused size).
 */
function isRetryableUploadFailure(status) {
  if (status === 0) return true; // socket error, DNS, offline
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

const SNIP_UPLOAD_MAX_ATTEMPTS = 5;
/** 8 MiB. Must be a multiple of 256 KiB — GCS rejects a chunk that is not. */
const SNIP_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

const snipBackoffMs = (attempt) =>
  Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * PUTs a small object in one request, with retries. Used for the poster.
 */
async function putSmallFile(uploadUrl, contentType, body) {
  for (let attempt = 0; attempt < SNIP_UPLOAD_MAX_ATTEMPTS; attempt++) {
    const result = await snipRequest({
      url: uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'Content-Length': body.length },
      body,
    });
    if (result.ok) return { success: true };
    if (!isRetryableUploadFailure(result.status)) {
      return { success: false, error: result.error };
    }
    if (attempt < SNIP_UPLOAD_MAX_ATTEMPTS - 1) await delay(snipBackoffMs(attempt));
  }
  return { success: false, error: 'The upload kept failing' };
}

/**
 * Uploads a recording to Cloud Storage as a **resumable** session.
 *
 * This is the hardening the whole queue exists to make possible, and the
 * reason it is not a single `PUT`: a plain PUT of 300 MB is one indivisible
 * request, so an interruption at 95% costs every byte already sent. On a
 * connection bad enough to drop it once, retrying the whole thing is a loop
 * that may never finish.
 *
 * The protocol, and what each step is defending against:
 *
 *   1. **POST the signed initiation URL** with `x-goog-resumable: start` —
 *      that header is part of the v4 signature, so it is not optional. The
 *      bucket answers `201` with a session URI in `Location`.
 *   2. **PUT 8 MiB chunks** with `Content-Range: bytes a-b/total`. A `308`
 *      means "stored, keep going" and carries a `Range` header saying exactly
 *      how much the bucket actually holds — which is the number we continue
 *      from, rather than assuming our own arithmetic was right.
 *   3. **On a transient failure, probe and continue.** `PUT` with
 *      `Content-Range: bytes * /total` and an empty body asks the bucket where
 *      it got to. That is what turns a dropped connection into a few seconds
 *      lost instead of the whole file.
 *
 * `onProgress` reports bytes confirmed *by the bucket*, never bytes written to
 * the socket — a chunk in flight when the connection dies was not stored, and
 * a progress bar that counts it would go backwards.
 */
async function uploadRecordingResumable(uploadUrl, filePath, totalBytes, onProgress) {
  const start = await snipRequest({
    url: uploadUrl,
    method: 'POST',
    headers: {
      'x-goog-resumable': 'start',
      'Content-Type': 'video/webm',
      'Content-Length': 0,
    },
  });
  if (!start.ok) {
    return {
      success: false,
      error: `Could not start the upload (${start.error})`,
      retryable: isRetryableUploadFailure(start.status),
    };
  }

  const sessionUri = start.headers && start.headers.location;
  if (!sessionUri) {
    return { success: false, error: 'The upload session had no location', retryable: false };
  }

  let offset = 0;
  let attempt = 0;

  while (offset < totalBytes) {
    const end = Math.min(offset + SNIP_UPLOAD_CHUNK_BYTES, totalBytes) - 1;
    const result = await snipRequest({
      url: sessionUri,
      method: 'PUT',
      headers: {
        'Content-Length': end - offset + 1,
        'Content-Range': `bytes ${offset}-${end}/${totalBytes}`,
      },
      filePath,
      start: offset,
      end,
    });

    // 200/201 = the whole object is stored. 308 = this chunk landed, continue.
    if (result.ok) {
      if (onProgress) onProgress(totalBytes, totalBytes);
      return { success: true };
    }

    if (result.status === 308) {
      attempt = 0;
      offset = parseResumeOffset(result.headers, offset, end);
      if (onProgress) onProgress(offset, totalBytes);
      continue;
    }

    if (!isRetryableUploadFailure(result.status)) {
      return { success: false, error: result.error, retryable: false };
    }

    attempt += 1;
    if (attempt >= SNIP_UPLOAD_MAX_ATTEMPTS) {
      return { success: false, error: result.error, retryable: true };
    }
    await delay(snipBackoffMs(attempt));

    // Ask the bucket where it actually got to rather than assuming the failed
    // chunk stored nothing — a connection that died after the body was sent
    // but before the response arrived may well have stored all of it.
    const probe = await snipRequest({
      url: sessionUri,
      method: 'PUT',
      headers: { 'Content-Length': 0, 'Content-Range': `bytes */${totalBytes}` },
    });
    if (probe.ok) {
      if (onProgress) onProgress(totalBytes, totalBytes);
      return { success: true };
    }
    if (probe.status === 308) {
      offset = parseResumeOffset(probe.headers, offset, offset - 1);
      if (onProgress) onProgress(offset, totalBytes);
    }
  }

  return { success: true };
}

/**
 * `Range: bytes=0-8388607` -> the next byte to send.
 *
 * Falls back to the optimistic offset when the header is absent, which GCS
 * does when it holds nothing yet. Never moves backwards: a malformed header
 * must not rewind an upload that is already further along.
 */
function parseResumeOffset(headers, currentOffset, assumedEnd) {
  const range = headers && headers.range;
  const match = typeof range === 'string' ? /bytes=\d+-(\d+)/.exec(range) : null;
  const confirmed = match ? Number(match[1]) + 1 : assumedEnd + 1;
  return Math.max(currentOffset, Number.isFinite(confirmed) ? confirmed : currentOffset);
}

ipcMain.handle('snip:uploadRecording', async (event, options = {}) => {
  if (senderWindow(event) !== mainWindow) return { success: false, error: 'forbidden' };

  const token = options.token;
  const entry = snipQueue.get(token);
  // An unknown token is a recording that was already uploaded, already
  // discarded, aged out, or never existed. All four are the same answer.
  if (!entry) return { success: false, error: 'That recording is no longer available' };

  const paths = snipQueuePaths(token);
  let totalBytes;
  try {
    totalBytes = fs.statSync(paths.video).size;
  } catch {
    // The row outlived its bytes. Clear it rather than offering a Retry that
    // can never succeed.
    removeSnipQueueEntry(token);
    return { success: false, error: 'That recording is no longer on disk' };
  }

  writeSnipQueueMeta(token, {
    state: 'uploading',
    attempts: (entry.attempts || 0) + 1,
    lastAttemptAt: Date.now(),
    lastError: null,
  });

  const result = options.resumable === false
    ? await putSmallFile(options.uploadUrl, 'video/webm', fs.readFileSync(paths.video))
    : await uploadRecordingResumable(options.uploadUrl, paths.video, totalBytes, (sent, total) => {
        sendTo(mainWindow, 'snip:upload-progress', { token, sent, total });
      });

  if (!result.success) {
    // **The file stays.** This is the whole point of the queue: a failed
    // upload is a recording the user still has, not work they have lost. The
    // page lists it with its error and a Retry.
    writeSnipQueueMeta(token, {
      state: 'failed',
      lastError: result.error || 'The upload failed',
    });
    return { success: false, error: result.error, retryable: result.retryable !== false };
  }

  // The poster is best-effort and its failure must not fail the upload: a
  // recording with no thumbnail is a row the grid renders a placeholder for,
  // where a failed recording is work the user has to redo.
  let posterUploaded = false;
  if (options.posterUploadUrl && entry.hasPoster) {
    try {
      const poster = await putSmallFile(
        options.posterUploadUrl,
        'image/png',
        fs.readFileSync(paths.poster),
      );
      posterUploaded = poster.success;
      if (!poster.success) console.warn('[snip] poster upload failed:', poster.error);
    } catch (err) {
      console.warn('[snip] poster could not be read:', err.message);
    }
  }

  // Only now are the local bytes redundant \u2014 they are in the bucket.
  removeSnipQueueEntry(token);
  return { success: true, posterUploaded };
});

/**
 * The renderer could not finalise, so the local copy is no longer wanted.
 *
 * Distinct from a failed upload: this is called when the slot itself was
 * refused (quota, a revoked page permission) or the user chose to discard.
 * A failed *transfer* keeps its file; a refused *reservation* has nowhere to
 * go and keeping it would grow a queue of recordings that can never upload.
 */
ipcMain.handle('snip:discardRecording', (event, token) => {
  if (senderWindow(event) !== mainWindow) return { success: false };
  removeSnipQueueEntry(token);
  return { success: true };
});

/** Everything waiting to upload, for the Snipping Tool page. */
ipcMain.handle('snip:listPendingRecordings', (event) => {
  if (senderWindow(event) !== mainWindow) return [];
  return snipQueueSnapshot();
});

/**
 * Writes a queued recording somewhere the user chose \u2014 the escape hatch for
 * a recording that will not upload at all.
 *
 * `copyFile`, not a read into memory and a write back out: this is the path
 * for the largest files the app ever handles, and the whole reason it exists
 * is that something has already gone wrong.
 *
 * The renderer names no path. It asks for a save, main shows the native
 * dialog, and the destination is whatever the user picked.
 */
ipcMain.handle('snip:savePendingRecording', async (event, token) => {
  if (senderWindow(event) !== mainWindow) return { success: false };
  const entry = snipQueue.get(token);
  if (!entry) return { success: false, error: 'That recording is no longer available' };

  const stamp = new Date(entry.createdAt || Date.now())
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-');

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save recording',
    defaultPath: path.join(app.getPath('downloads'), `bluu-recording-${stamp}.webm`),
    filters: [{ name: 'WebM video', extensions: ['webm'] }],
  });
  if (canceled || !filePath) return { success: false, canceled: true };

  try {
    await fsp.copyFile(snipQueuePaths(token).video, filePath);
  } catch (err) {
    console.error('[snip] could not save the recording:', err.message);
    return { success: false, error: 'The recording could not be written there' };
  }
  // Deliberately does NOT remove the queue entry. The user asked for a copy,
  // not for the upload to be abandoned \u2014 those are different intentions and
  // conflating them would quietly throw away the retry.
  return { success: true, filePath };
});

/**
 * The microphone's status, and the screen's, for the selection surface's audio
 * toggles.
 *
 * `getMediaAccessStatus` is documented for macOS and Windows; on Linux and on
 * older builds it can throw rather than return, and a throw here would take
 * out the toggle rather than the answer.
 */
/** The Video toggles, relayed to the app window — the only side holding a
 *  Firebase session and therefore the only side that can persist them. */
ipcMain.on('snip:audio-prefs', (event, prefs) => {
  const win = senderWindow(event);
  if (!win || !snipOverlayState.has(win.id)) return;
  const next = {
    systemAudioEnabled: SNIP_SYSTEM_AUDIO_SUPPORTED && !!(prefs && prefs.systemAudioEnabled),
  };
  // Held in main too, so a second capture in the same app session opens with
  // the right toggle even before the write round-trips through Firestore.
  snipConfig.systemAudioEnabled = next.systemAudioEnabled;
  sendTo(mainWindow, 'snip:audio-prefs', next);
});

/**
 * The renderer's push: "this user holds the page, and these are their settings."
 *
 * `enabled` is the page permission, resolved in the renderer against
 * `permittedPageIds` — main cannot read Firestore. It is not the security
 * boundary and does not need to be: every route behind the capture (the signed
 * upload slot, the finalise, the list) re-checks the permission server-side, so
 * the worst a spoofed `enabled: true` buys is a tray icon and a local crop that
 * nothing will store.
 */
ipcMain.handle('snip:configure', (event, raw = {}) => {
  // Only the main window configures this. A satellite must not be able to
  // register a global shortcut or plant a tray item.
  if (senderWindow(event) !== mainWindow) return { ok: false };

  snipConfig = {
    enabled: !!raw.enabled,
    trayIconEnabled: raw.trayIconEnabled !== false,
    shortcutEnabled: raw.shortcutEnabled !== false,
    shortcut: typeof raw.shortcut === 'string' && raw.shortcut ? raw.shortcut : null,
    // `=== true`, matching `resolveSnipSettings`: the one opt-in field.
    systemAudioEnabled: SNIP_SYSTEM_AUDIO_SUPPORTED && raw.systemAudioEnabled === true,
    /**
     * **Capability negotiation, and it runs the OTHER way to the version
     * floor.**
     *
     * The floor in `src/lib/snips.ts` protects a new renderer from an old
     * shell. This protects a new shell from an **old renderer** — the case
     * rule 9c makes normal here, because a page bundle can be weeks older than
     * the app around it.
     *
     * Without it, a shell that can record would offer the Video toggle to a
     * renderer with no `snip:recorded` listener: the user would select Video,
     * record for two minutes, press Stop, and nothing at all would happen —
     * no upload, no error, and a temp file nobody collects. Main cannot read
     * the renderer's version, so the renderer declares the capability instead
     * and the Video toggle is drawn only when it does.
     */
    supportsRecording: raw.supportsRecording === true,
  };

  if (!snipConfig.enabled) {
    teardownSnip();
    // Losing the page permission mid-recording stops the recording. Letting it
    // run to completion would upload through routes that will now refuse it,
    // and leave the user watching a control bar for a file with nowhere to go.
    clearSnipRecording();
  }
  ensureSnipTray();
  const shortcutRegistered = applySnipShortcut();

  return { ok: true, shortcutRegistered };
});

ipcMain.handle('snip:start', (event) => {
  if (senderWindow(event) !== mainWindow) return { success: false, error: 'forbidden' };
  return startSnip('renderer');
});

/**
 * Writes text to the OS clipboard from MAIN.
 *
 * `navigator.clipboard.writeText` is permitted in this app, but it requires the
 * document to be focused — and the whole point of a snip is that it completes
 * while the user is in another application with the Bluu window hidden. The
 * renderer would silently fail to copy the one thing the user wants.
 */
ipcMain.handle('clipboard:writeText', (_event, text) => {
  if (typeof text !== 'string' || text.length > 4096) return { success: false };
  clipboard.writeText(text);
  return { success: true };
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

/**
 * Opens System Settings at Screen Recording — **on macOS, which is the only
 * platform where that sentence means anything.**
 *
 * On Windows this runs a 1x1 `getSources` call and returns success, and the
 * comment here used to say that "prompts the user". It does not: Windows has
 * no per-app screen-recording permission, so there is no prompt, no settings
 * page, and nothing for the user to grant. The call is a no-op that reports
 * success, which is exactly why **no caller may offer this as an "Open
 * Settings" button off macOS** — the user presses it, nothing happens, and
 * they reasonably conclude the app is broken. `SnipController` guards on the
 * platform for this reason; onboarding calls it unconditionally but only to
 * unlock its Next button, never as a promise that a window will open.
 */
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

// macOS convention: closing the window hides it, the app stays running in the
// dock, and only an explicit quit ends the process. Windows/Linux keep the
// close-means-quit behaviour their users expect.
const HIDE_ON_CLOSE = process.platform === 'darwin';
// Set by `before-quit` — the one thing that tells a real quit apart from the X
// button. Read by the main window's `close` handler and by `window-all-closed`.
let isQuitting = false;
app.on('before-quit', () => { isQuitting = true; });

// A global accelerator outlives the window that registered it, so releasing it
// is not optional: Electron documents `unregisterAll()` on quit, and skipping it
// can leave the combination swallowed until the OS notices the process is gone.
app.on('will-quit', () => { globalShortcut.unregisterAll(); });

// A running GoLogin profile must be stopped, not orphaned: `stop()` syncs the
// profile back to the provider, and killing the process instead loses whatever
// the session did. Registered AFTER the listener above so `isQuitting` is
// already true, and latched so the re-quit below cannot loop. Bounded inside
// `stopAllGoLoginSessions` — a quit may be delayed a few seconds, never hung.
let gologinQuitHandled = false;
app.on('before-quit', (event) => {
  if (gologinQuitHandled) return;
  if (![...gologinSessions.values()].some(s => s.gl)) return;
  event.preventDefault();
  gologinQuitHandled = true;
  stopAllGoLoginSessions().finally(() => app.quit());
});

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
  { prefix: '/gologin', accessPath: '/api/gologin/access', title: 'GoLogin' },
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

  // A GoLogin window must not be closed while a profile is still committing its
  // session back to the provider — see guardGoLoginWindowClose.
  if (key === 'gologin') guardGoLoginWindowClose(win);

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

// ─── GoLogin sessions (local Orbita launches) ────────────────────────
// The GoLogin Node SDK downloads and runs **Orbita** — a separate Chromium
// binary — on this machine. Three consequences shape everything below:
//
//   • **The browser is not an Electron window.** Orbita owns its own OS window;
//     `attachWindowBehaviour` never touches it and we cannot restyle, embed or
//     position it. The satellite at /gologin/session/<id> is the *console* for a
//     session (status, stop, errors), not the browser itself.
//   • **Only main can do this.** It is the sole Node context on the user's
//     machine; nothing on Vercel can launch a browser on someone's desk.
//   • **The API token lives here and only here.** It is fetched per launch from
//     /api/gologin/launch-token, which hands over **the calling user's own**
//     GoLogin key — never the shared workspace one, which no longer leaves the
//     server. It is held in memory for the life of the session, never written to
//     disk and never handed back to a renderer.
//   • **A profile may only be open in one place at a time.** GoLogin enforces
//     nothing of the sort, so the lock is ours and it is server-side (two
//     operators are on two machines; no client can see another's sessions). Main
//     claims it before spawning, heartbeats while running, and releases it in the
//     same teardown that closes the browser.
//
// The SDK is **ESM-only**, so it is loaded with a dynamic `import()` — and lazily,
// because it drags in puppeteer-core and a native sqlite3 binding that must not
// cost anything at app start for the users who never open GoLogin.
const GOLOGIN_MAX_SESSIONS = 5;          // ~300–500MB of RAM each, per GoLogin's own docs
const GOLOGIN_LAUNCH_TIMEOUT_MS = 900000; // an Orbita download is hundreds of MB on a slow line

/** Must match HEARTBEAT_INTERVAL_MS in lib/services/gologinLockService.ts. */
const GOLOGIN_HEARTBEAT_MS = 60_000;

/** profileId -> { status, gl, wsUrl, error, startedAtMs, lease, heartbeat, holder } */
const gologinSessions = new Map();

/** Fallback device identity when the renderer has no localStorage. See the launch handler. */
let mainProcessDeviceId = null;

/** Renderer-supplied, so validated as untrusted input before it reaches the SDK. */
function isValidProfileId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(value);
}

/**
 * Did this launch fail because the profile's proxy did not work?
 *
 * The SDK checks the proxy before it spawns anything — `getTimeZone` fetches a
 * timezone *through* the proxy and throws on failure — so this is much the most
 * common launch failure, and it is the one with a remedy the operator can act
 * on. Left as a generic "GoLogin could not start this profile" it sends them to
 * an admin for something they can see and fix in GoLogin themselves.
 *
 * Matched on the message because that is all the SDK gives us: it throws a bare
 * `Error('Proxy Error')` (or `'Proxy Error (Gologin)'`), and for non-SOCKS
 * proxies it rethrows the underlying request error with `(Gologin)` appended.
 * `waitDebuggingUrl` separately produces "Check proxy settings". The word
 * "proxy" appears in an SDK error only when the proxy is the cause, and the
 * worst a false positive can do is label a failure slightly wrong — it is a
 * failure either way.
 */
function isProxyFailure(err) {
  return /proxy/i.test(String(err?.message ?? ''));
}

/**
 * What a renderer is allowed to see. Deliberately omits the `gl` instance (not
 * serialisable, and a handle to the whole session) and the token entirely.
 */
function gologinSnapshot(profileId) {
  const session = gologinSessions.get(profileId);
  if (!session) return { profileId, status: 'idle' };
  return {
    profileId,
    status: session.status,
    error: session.error ?? null,
    startedAtMs: session.startedAtMs ?? null,
    // Who blocked the launch, when the server refused the lock. Display only.
    holder: session.holder ?? null,
    // Present only so a console could say "automation endpoint ready"; it is a
    // localhost CDP socket, not a credential.
    wsUrl: session.wsUrl ?? null,
  };
}

function broadcastGoLoginSession(profileId) {
  const payload = gologinSnapshot(profileId);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('gologin:session-changed', payload);
  }
}

function setGoLoginStatus(profileId, patch) {
  const current = gologinSessions.get(profileId) ?? { profileId };
  gologinSessions.set(profileId, { ...current, ...patch });
  broadcastGoLoginSession(profileId);
}

/**
 * The token is fetched fresh per launch rather than cached: the page permission
 * is re-checked server-side on every call, so access revoked mid-shift stops the
 * next launch instead of the next app start.
 */
async function fetchGoLoginToken(idToken) {
  const response = await fetch(`${BASE_URL}/api/gologin/launch-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    const error = response.status === 403 ? 'forbidden'
      // 428 is "you have not linked a GoLogin account yet", which the window
      // answers with onboarding rather than an error badge.
      : response.status === 428 ? 'not-linked'
      : response.status === 503 ? 'not-configured'
      : 'unauthenticated';
    throw Object.assign(new Error(`launch-token ${response.status}`), { code: error });
  }
  const body = await response.json();
  if (!body?.token) throw Object.assign(new Error('no token'), { code: 'not-configured' });
  return body.token;
}

// ─── The session lock ────────────────────────────────────────────────
// GoLogin has no concurrency control of its own, so a profile open on two
// machines at once is entirely possible — and it is the precise failure an
// anti-detect profile exists to prevent. The lock is server-side because the two
// operators are on two different machines; see lib/services/gologinLockService.ts.
//
// A claim returns a **lease secret**, and that — not a Firebase ID token — is
// what authenticates the heartbeat and the release. A browser session routinely
// outlives the hour an ID token lasts, and main holds no refresh token, so an
// authenticated heartbeat would start failing mid-session and hand a live
// profile to the next person who asked for it.

/** Claim a profile. Resolves `{ ok, secret }` or `{ ok: false, holder }`. */
async function claimGoLoginLock(idToken, profileId, deviceId) {
  const response = await fetch(`${BASE_URL}/api/gologin/session-lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'claim', profileId, deviceId }),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`session-lock ${response.status}`), {
      code: response.status === 403 ? 'forbidden' : 'lock-failed',
    });
  }
  return response.json();
}

/**
 * Heartbeat / release. Never throws — a lock action failing must not take a
 * running browser down with it, and the claim expires on its own if we really
 * have gone away.
 */
async function leaseGoLoginLock(action, profileId, secret) {
  try {
    const response = await fetch(`${BASE_URL}/api/gologin/session-lock/lease`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, profileId, secret }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.warn('[main] gologin lease', action, 'failed:', err?.message ?? err);
    return null;
  }
}

/**
 * Keep the claim alive for as long as the browser is up.
 *
 * If the server says the lease is no longer held, the claim expired (this
 * machine was offline or asleep past the stale window) and someone else may
 * legitimately have the profile now — so the browser is torn down rather than
 * left running against a profile we no longer own.
 */
function startGoLoginHeartbeat(profileId) {
  const session = gologinSessions.get(profileId);
  if (!session?.lease) return;
  const timer = setInterval(async () => {
    const current = gologinSessions.get(profileId);
    if (!current?.lease) return;
    const result = await leaseGoLoginLock('heartbeat', profileId, current.lease);
    if (result && result.held === false) {
      console.warn('[main] gologin: lost the session lock for', profileId, '— stopping');
      void finalizeGoLoginSession(profileId, 'lock-lost');
    }
  }, GOLOGIN_HEARTBEAT_MS);
  // The interval must never hold the app open at quit time.
  if (typeof timer.unref === 'function') timer.unref();
  session.heartbeat = timer;
}

// ─── Orbita: download and update, with progress ──────────────────────
// Orbita is a full Chromium build (hundreds of MB) fetched from GoLogin's CDN.
// Two things make it worth instrumenting rather than leaving to the SDK:
//
//   • The SDK reports progress by drawing a **CLI progress bar to stdout**. In a
//     packaged Electron app that goes nowhere, so a first launch looks like a
//     hang for several minutes.
//   • The required version comes from **the profile's own user agent**
//     (`resolveProfileBrowserVersion`), not from a global "latest". So a
//     download can start in the middle of an ordinary launch, whenever a profile
//     needs a major version this machine does not have yet — which is exactly
//     when the window has to block and say so.
//
// Only `downloadBrowserArchive` is replaced. Extraction, the hash check and the
// install are the SDK's own and stay that way; re-implementing them is how a
// half-written browser directory happens.

const GOLOGIN_ORBITA_PROGRESS_MS = 250;

/** The one place the renderer learns what Orbita is doing. */
const orbitaState = {
  /** 'idle' | 'checking' | 'downloading' | 'installing' | 'ready' | 'failed' */
  phase: 'idle',
  version: null,
  receivedBytes: 0,
  totalBytes: 0,
  error: null,
};

let orbitaLastBroadcastMs = 0;

function broadcastOrbita(force = false) {
  const now = Date.now();
  // Byte-level progress is throttled; a phase change is not.
  if (!force && now - orbitaLastBroadcastMs < GOLOGIN_ORBITA_PROGRESS_MS) return;
  orbitaLastBroadcastMs = now;
  const payload = { ...orbitaState };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('gologin:orbita-changed', payload);
  }
}

function setOrbitaPhase(phase, patch = {}) {
  Object.assign(orbitaState, { phase, error: null, ...patch });
  broadcastOrbita(true);
}

/** Orbita major versions already installed on this machine. */
async function installedOrbitaVersions() {
  const dir = path.join(require('os').homedir(), '.gologin', 'browser');
  try {
    const entries = await fsp.readdir(dir);
    return entries
      .map((name) => /^orbita-browser-(\d+)$/.exec(name))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

/**
 * The SDK's `downloadBrowserArchive`, with byte progress and without the CLI bar.
 * Writes to the same path the SDK's own extraction step reads from.
 */
function downloadOrbitaArchive(link, destination) {
  const { get } = require('https');
  const { createWriteStream } = require('fs');

  return new Promise((resolve, reject) => {
    const file = createWriteStream(destination);
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      file.destroy();
      fsp.unlink(destination).catch(() => {});
      reject(err);
    };

    file.on('error', fail);
    file.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve();
    });

    const request = get(link, { timeout: 30_000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        fail(new Error(`Orbita download failed with ${res.statusCode}`));
        return;
      }
      const total = Number.parseInt(res.headers['content-length'], 10);
      orbitaState.totalBytes = Number.isFinite(total) ? total : 0;
      orbitaState.receivedBytes = 0;
      setOrbitaPhase('downloading');

      res.on('data', (chunk) => {
        orbitaState.receivedBytes += chunk.length;
        broadcastOrbita();
      });
      res.on('error', fail);
      res.pipe(file);
    });

    request.on('timeout', () => request.destroy(new Error('Orbita download timed out')));
    request.on('error', fail);
  });
}

/**
 * Point a `BrowserChecker` at our download instead of the SDK's.
 *
 * Idempotent — the SDK memoises one checker per `GoLogin` instance, but a marker
 * keeps this safe if that ever changes. When no download is needed, nothing here
 * runs and no progress is reported, which is what lets the renderer treat "any
 * progress at all" as "block the window".
 */
function instrumentOrbitaChecker(checker) {
  if (!checker || checker.__bluuInstrumented) return checker;
  checker.__bluuInstrumented = true;

  checker.downloadBrowserArchive = (link, destination) =>
    downloadOrbitaArchive(link, destination);

  const extract = checker.extractBrowser?.bind(checker);
  if (extract) {
    checker.extractBrowser = async () => {
      // Unpacking a few hundred MB is not instant, and a progress bar frozen at
      // 100% reads as a hang. It gets its own phase instead.
      setOrbitaPhase('installing');
      return extract();
    };
  }
  return checker;
}

/**
 * Make sure a given Orbita major version is on this machine, reporting progress.
 * `version` omitted means "whatever GoLogin currently calls latest" — the
 * onboarding case, where there is no profile to take a version from yet.
 */
async function ensureOrbita(version) {
  if (orbitaState.phase === 'downloading' || orbitaState.phase === 'installing') {
    return { success: true, alreadyRunning: true };
  }
  setOrbitaPhase('checking', { version: version ?? null, receivedBytes: 0, totalBytes: 0 });

  try {
    const { GoLogin } = await import('gologin');
    // No token needed: the download path talks to the CDN, not the API. A
    // placeholder keeps the constructor happy during onboarding, when the
    // operator has not pasted a key yet.
    const gl = new GoLogin({ token: 'orbita-download' });
    const checker = instrumentOrbitaChecker(await gl.getBrowserChecker());

    const major = version ?? (await gl.getLatestBrowserVersion());
    orbitaState.version = major;

    const installed = await installedOrbitaVersions();
    if (installed.includes(Number(major))) {
      setOrbitaPhase('ready', { version: major });
      return { success: true, version: major, alreadyInstalled: true };
    }

    // `autoUpdateBrowser: false` — the folder check inside `checkBrowser` is what
    // makes this a no-op when the version is already present. Passing true would
    // re-download every time.
    await checker.checkBrowser({ autoUpdateBrowser: false, majorVersion: String(major) });
    setOrbitaPhase('ready', { version: major });
    return { success: true, version: major };
  } catch (err) {
    console.error('[main] gologin: Orbita download failed:', err);
    setOrbitaPhase('failed', { error: err?.message ?? 'download-failed' });
    return { success: false, error: 'download-failed' };
  }
}

ipcMain.handle('gologin:orbita-status', async () => ({
  ...orbitaState,
  installedVersions: await installedOrbitaVersions(),
}));

ipcMain.handle('gologin:ensure-orbita', async (_event, version) => {
  const major = Number.isFinite(Number(version)) && Number(version) > 0 ? Number(version) : undefined;
  return ensureOrbita(major);
});

/**
 * How long a teardown may take before we stop waiting on it. `stopAndCommit`
 * uploads the profile to GoLogin, so it is a network call — bounded so a row
 * can never be stuck on "Stopping" because the provider is slow.
 */
const GOLOGIN_TEARDOWN_TIMEOUT_MS = 30000;
/** Grace period between asking Orbita to close and forcing it. */
const GOLOGIN_KILL_GRACE_MS = 5000;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * **`gl.stop()` does not close the browser.** It is `stopAndCommit`: sanitize
 * the profile, upload it, wait 3s, delete the local profile files — all while
 * Orbita is still running on those very files. Killing the process is a
 * *separate* method the SDK never calls for you.
 *
 * So teardown here is explicitly two steps in this order: end the process, then
 * commit. `killBrowser()` (SIGTERM via the stored child handle) is used rather
 * than the SDK's `stopBrowser()`, which shells out to `fuser` — absent on both
 * Windows and macOS. SIGTERM also lets Chromium flush its profile before it
 * goes, which is what makes the commit that follows worth anything.
 */
async function closeOrbita(gl) {
  const child = gl?.processSpawned;
  if (!child?.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise(resolve => child.once('exit', resolve));
  try { gl.killBrowser(); } catch (err) { console.error('[main] gologin killBrowser failed:', err); }

  const closed = await Promise.race([exited.then(() => true), wait(GOLOGIN_KILL_GRACE_MS).then(() => false)]);
  if (closed) return;

  // Chromium spawns a tree of renderer processes; on Windows killing the parent
  // alone can leave them (and the profile lock) behind, so force the tree.
  console.warn('[main] gologin: Orbita did not exit on SIGTERM, forcing');
  if (process.platform === 'win32') {
    try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch { /* already gone */ }
  } else {
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  await Promise.race([exited, wait(3000)]);
}

/**
 * The single teardown path, whichever way a session ends: the operator pressing
 * Stop, or **the operator simply closing the Orbita window**. The second was
 * previously invisible to us — nothing watched the process, so the row said
 * "Open here" forever and the profile was never committed back to GoLogin.
 *
 * Re-entrant by design: the exit watcher and an explicit Stop routinely race.
 */
async function finalizeGoLoginSession(profileId, reason) {
  const session = gologinSessions.get(profileId);
  if (!session || session.finalizing) return;
  session.finalizing = true;
  setGoLoginStatus(profileId, { status: 'stopping' });

  // Stop heart-beating before anything slow, so a teardown that takes 30s does
  // not keep re-claiming a profile it is in the middle of giving up.
  if (session.heartbeat) clearInterval(session.heartbeat);

  try {
    // On a user Stop the browser is still up; on 'browser-closed' this is a no-op.
    await closeOrbita(session.gl);
    if (session.gl) {
      // Commit only after the process is gone — the SDK's own order deletes the
      // profile directory out from under a live browser.
      await Promise.race([session.gl.stop(), wait(GOLOGIN_TEARDOWN_TIMEOUT_MS)]);
    }
  } catch (err) {
    console.error('[main] gologin teardown failed:', profileId, reason, err);
  }

  // Released last, and unconditionally: the profile is only free once the
  // browser is really gone AND its state is committed. Releasing earlier would
  // let a colleague launch into a profile still being uploaded. If this fails
  // the claim expires on its own within the stale window.
  if (session.lease) await leaseGoLoginLock('release', profileId, session.lease);

  gologinSessions.delete(profileId);
  broadcastGoLoginSession(profileId);

  // A window waiting on "close after completion" may now be free to go.
  resolveGoLoginPendingClose();
}

/**
 * The missing signal. `spawnBrowser` stores the child on `gl.processSpawned`,
 * so its `exit` is the one authoritative "this profile is no longer open" —
 * covering a manual window close, a crash, and the OS killing it alike.
 */
function watchOrbitaExit(profileId, gl) {
  const child = gl?.processSpawned;
  if (!child?.once) {
    console.warn('[main] gologin: no process handle to watch for', profileId);
    return;
  }
  child.once('exit', () => {
    console.log('[main] gologin: Orbita exited for', profileId);
    void finalizeGoLoginSession(profileId, 'browser-closed');
  });
}

ipcMain.handle('gologin:launch', async (_event, args = {}) => {
  const { idToken, profileId, deviceId } = args;
  if (!isValidProfileId(profileId)) return { success: false, error: 'invalid-profile' };
  if (!idToken || typeof idToken !== 'string') return { success: false, error: 'unauthenticated' };

  const existing = gologinSessions.get(profileId);
  if (existing && (existing.status === 'starting' || existing.status === 'running')) {
    // Idempotent: a second Launch (or a reopened window) adopts the session that
    // is already up rather than spawning a second Orbita on the same profile.
    return { success: true, session: gologinSnapshot(profileId) };
  }

  const live = [...gologinSessions.values()].filter(
    s => s.status === 'starting' || s.status === 'running',
  ).length;
  if (live >= GOLOGIN_MAX_SESSIONS) return { success: false, error: 'too-many-sessions' };

  // A renderer that cannot mint a device id (blocked storage) still has to be
  // able to launch, so main falls back to an id of its own. It is stable for the
  // life of the process, which is all the lock needs — a restart stops the
  // heartbeat, and the claim then expires on its own.
  const device = /^[A-Za-z0-9_:.-]{6,128}$/.test(String(deviceId ?? ''))
    ? String(deviceId)
    : (mainProcessDeviceId ??= `main-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  setGoLoginStatus(profileId, {
    status: 'starting', error: null, wsUrl: null, holder: null, startedAtMs: Date.now(),
  });

  let gl;
  let lease = null;
  try {
    // 1. The lock first, before anything is spawned or downloaded. Losing the
    //    race here has to cost nothing but a message.
    const claim = await claimGoLoginLock(idToken, profileId, device);
    if (!claim?.ok) {
      const holder = claim?.holder ?? null;
      setGoLoginStatus(profileId, { status: 'failed', error: 'in-use', holder, gl: null });
      return { success: false, error: 'in-use', holder, session: gologinSnapshot(profileId) };
    }
    lease = claim.secret ?? null;
    gologinSessions.set(profileId, { ...gologinSessions.get(profileId), lease });

    // 2. This user's own GoLogin token — never the shared workspace key.
    const token = await fetchGoLoginToken(idToken);
    const { GoLogin } = await import('gologin');
    gl = new GoLogin({
      token,
      profile_id: profileId,
      // Cookies stay on this machine unless GoLogin already has them: uploading
      // a fan/creator session's cookies on every stop is a data movement nobody
      // asked for. Flip it only deliberately.
      uploadCookiesToServer: false,
    });

    // 3. Instrument the browser checker BEFORE start(). The required Orbita
    //    version comes from the profile's own user agent, so `start()` may
    //    download one mid-launch — and that is precisely when the window has to
    //    block on a progress bar rather than look frozen.
    instrumentOrbitaChecker(await gl.getBrowserChecker());

    gologinSessions.set(profileId, { ...gologinSessions.get(profileId), gl });

    const started = await Promise.race([
      gl.start(),
      new Promise((_, reject) => setTimeout(
        () => reject(Object.assign(new Error('timeout'), { code: 'timeout' })),
        GOLOGIN_LAUNCH_TIMEOUT_MS,
      )),
    ]);

    // A download that finished as part of this launch leaves the gate showing
    // "installing" forever otherwise.
    if (orbitaState.phase === 'downloading' || orbitaState.phase === 'installing') {
      setOrbitaPhase('ready');
    }

    // Attach BEFORE reporting running: a browser that dies immediately must
    // still flip the row back, not leave it claiming to be open.
    watchOrbitaExit(profileId, gl);
    setGoLoginStatus(profileId, { status: 'running', wsUrl: started?.wsUrl ?? null, error: null });
    startGoLoginHeartbeat(profileId);
    return { success: true, session: gologinSnapshot(profileId) };
  } catch (err) {
    console.error('[main] gologin launch failed:', err);
    // The SDK may have got far enough to spawn something before throwing, so the
    // failure path still tries to tear down rather than leaving a stray Orbita.
    if (gl) { try { await closeOrbita(gl); await gl.stop(); } catch { /* nothing to clean up */ } }
    // Give the lock back on every failure — a profile must not stay claimed by a
    // launch that never happened.
    if (lease) await leaseGoLoginLock('release', profileId, lease);
    if (orbitaState.phase === 'downloading' || orbitaState.phase === 'installing') {
      setOrbitaPhase('failed', { error: 'The browser download did not finish.' });
    }
    const code = err?.code === 'forbidden' ? 'forbidden'
      : err?.code === 'not-configured' ? 'not-configured'
      : err?.code === 'not-linked' ? 'not-linked'
      : err?.code === 'timeout' ? 'timeout'
      : err?.code === 'unauthenticated' ? 'unauthenticated'
      : err?.code === 'lock-failed' ? 'lock-failed'
      // Checked last among the SDK failures, so an explicit code always wins —
      // a timeout that happens to mention a proxy is still a timeout.
      : isProxyFailure(err) ? 'proxy-error'
      : 'launch-failed';
    setGoLoginStatus(profileId, { status: 'failed', error: code, gl: null, lease: null, wsUrl: null });
    return { success: false, error: code, session: gologinSnapshot(profileId) };
  }
});

ipcMain.handle('gologin:stop', async (_event, profileId) => {
  if (!isValidProfileId(profileId)) return { success: false, error: 'invalid-profile' };
  const session = gologinSessions.get(profileId);
  if (!session?.gl) {
    // No browser, but a claim may still exist from a launch that failed after
    // taking the lock. Hand it back rather than waiting out the stale window.
    if (session?.heartbeat) clearInterval(session.heartbeat);
    if (session?.lease) await leaseGoLoginLock('release', profileId, session.lease);
    gologinSessions.delete(profileId);
    broadcastGoLoginSession(profileId);
    return { success: true };
  }

  // One teardown path for every ending — see finalizeGoLoginSession. It closes
  // the browser first and only then commits, and it is bounded, so Stop always
  // resolves and the row always leaves "Stopping".
  await finalizeGoLoginSession(profileId, 'user-stop');
  return { success: true };
});

// ─── Guarding the window while a profile is still saving ─────────────
// `gl.stop()` uploads the profile's cookies and local state back to GoLogin.
// Interrupt it and the operator's session work is gone — they log into an
// account, close the browser, and are logged out again next time. The teardown
// is bounded at 30s but routinely takes several seconds, and during that window
// the row says "Stopping" and nothing else stops the user walking away.
//
// Closing the window does **not** by itself abort a teardown: sessions live in
// this process, not the renderer, so the commit finishes regardless. The guard
// exists because closing the window removes the only surface reporting the save,
// and the natural next step — quitting the app — *is* destructive (quit waits
// 12s and then gives up).

/** Windows told to close as soon as the last session finishes. */
const gologinPendingClose = new WeakSet();
/** Windows the operator has explicitly chosen to close anyway. */
const gologinForceClose = new WeakSet();

/**
 * Sessions that make closing the window a bad idea, and why.
 *
 * Two distinct situations, both worth stopping for and each with its own remedy:
 *
 *   • **`stopping`** — mid-upload. Interrupting loses the operator's session.
 *   • **`starting` / `running`** — an Orbita browser is open. Closing the window
 *     does not close it, so the operator ends up with a browser nothing in Bluu
 *     is showing them, and the profile stays locked to their machine until they
 *     quit the app or find the window again.
 */
function gologinBusyProfiles() {
  return [...gologinSessions.entries()]
    .filter(([, s]) => s.status === 'starting' || s.status === 'running' || s.status === 'stopping')
    .map(([profileId, s]) => ({ profileId, status: s.status }));
}

/**
 * Close the window once nothing is busy, if it asked to be closed.
 * Called from every teardown completion.
 */
function resolveGoLoginPendingClose() {
  // Checks *busy*, not just saving: after "Save & quit" a session is briefly
  // still `running` before its teardown flips it to `stopping`, and closing in
  // that gap would be exactly the early exit this whole guard exists to prevent.
  if (gologinBusyProfiles().length) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || !gologinPendingClose.has(win)) continue;
    gologinPendingClose.delete(win);
    gologinForceClose.add(win);
    win.close();
  }
}

function guardGoLoginWindowClose(win) {
  win.on('close', (event) => {
    if (gologinForceClose.has(win)) return;
    const busy = gologinBusyProfiles();
    if (!busy.length) return;

    // Held open and handed to the renderer, which owns the dialog — main has no
    // business drawing UI, and a native dialog here would look nothing like the
    // window it is interrupting.
    event.preventDefault();
    win.webContents.send('gologin:close-blocked', { profiles: busy });
  });
}

/** The renderer's answer to that dialog. */
ipcMain.handle('gologin:close-decision', (event, decision) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { success: false };

  if (decision === 'cancel') {
    gologinPendingClose.delete(win);
    return { success: true };
  }
  if (decision === 'force') {
    gologinPendingClose.delete(win);
    gologinForceClose.add(win);
    win.close();
    return { success: true };
  }
  if (decision === 'after-completion') {
    gologinPendingClose.add(win);
    // The last save may have landed between the click and this call.
    resolveGoLoginPendingClose();
    return { success: true };
  }
  if (decision === 'stop-and-close') {
    // "Save & quit": close every open browser, commit each profile, then let
    // `resolveGoLoginPendingClose` shut the window when the last one lands.
    //
    // Not awaited. Each teardown takes seconds and the renderer needs its
    // `stopping` broadcasts *now* to show the operator what is happening — an
    // awaited call would leave the dialog inert for the whole shutdown and the
    // IPC channel blocked behind it.
    gologinPendingClose.add(win);
    for (const { profileId } of gologinBusyProfiles()) {
      void finalizeGoLoginSession(profileId, 'window-close');
    }
    // Covers the case where nothing needed stopping after all.
    resolveGoLoginPendingClose();
    return { success: true };
  }
  return { success: false };
});

/** What is still open or saving, for a window that has just mounted. */
ipcMain.handle('gologin:busy-profiles', () => ({ profiles: gologinBusyProfiles() }));

ipcMain.handle('gologin:get-session', (_event, profileId) => (
  isValidProfileId(profileId) ? gologinSnapshot(profileId) : { profileId: null, status: 'idle' }
));

ipcMain.handle('gologin:list-sessions', () => (
  [...gologinSessions.keys()].map(gologinSnapshot)
));

/**
 * Quitting with profiles running would orphan Orbita processes **and** skip the
 * profile commit, which is how a profile's session data is lost. Runs the same
 * two-step teardown as Stop; best-effort and bounded, so a quit is delayed a
 * few seconds and never hung.
 */
async function stopAllGoLoginSessions() {
  const running = [...gologinSessions.entries()].filter(([, s]) => s.gl);
  if (!running.length) return;
  await Promise.race([
    Promise.allSettled(running.map(([id]) => finalizeGoLoginSession(id, 'quit'))),
    wait(12000),
  ]);
  gologinSessions.clear();
}

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
  // X button (Windows: window-all-closed → quit) and Cmd/Ctrl-Q. Hold the close
  // until the renderer clocks out and acks ('app:closing-flushed'), or a hard
  // timeout elapses — otherwise the async clock-out POST is killed mid-flight.
  //
  // On macOS the X button does NOT reach that flush at all: it hides the window
  // and the app keeps running (standard mac behaviour — the dock icon, Cmd+Tab
  // and the tray widget all bring it back). That is deliberate for time
  // tracking too: hiding a window is not clocking out, so an open session must
  // survive it untouched. Only a real quit (Cmd+Q, "Quit" menu, restart for an
  // update) sets `isQuitting`, and that is the path that flushes.
  let closeFlushed = false;
  mainWindow.on('close', (e) => {
    if (closeFlushed) return; // second pass — allow the close to proceed
    // The auto-update path already flushed via 'updater:before-install'. Vetoing
    // this close would flush twice and can abort the pending Squirrel install.
    if (updateInstallStarted) return;

    if (HIDE_ON_CLOSE && !isQuitting) {
      e.preventDefault();
      // Hiding a full-screen window leaves an empty black Space behind on
      // macOS, so drop out of full screen first and hide once that lands.
      if (mainWindow.isFullScreen()) {
        mainWindow.once('leave-full-screen', () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
        });
        mainWindow.setFullScreen(false);
      } else {
        mainWindow.hide();
      }
      return;
    }

    const wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) return;

    e.preventDefault();
    wc.send('app-closing');

    const finish = () => {
      closeFlushed = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      // Vetoing the close above also cancelled the `app.quit()` that triggered
      // it, and on macOS `window-all-closed` no longer quits — so a real quit
      // has to be re-issued here or the app would linger with no windows.
      if (isQuitting) app.quit();
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
    // Same reasoning for the snip tray — and the global shortcut has to go with
    // it, or the accelerator stays held by a process with no window to deliver a
    // capture to.
    destroySnipTray();
    teardownSnip();
    // A live recording outliving the window that would upload it is a control
    // bar floating over a desktop with nothing behind it, so that stops.
    //
    // **The queue does NOT.** It used to be emptied here, which was exactly
    // backwards: a user quitting the app is the single most likely moment for
    // an upload to be cut short, and deleting the queue at that point would
    // destroy the recordings this whole mechanism exists to protect. They stay
    // on disk and are offered again at next launch.
    clearSnipRecording();
    snipConfig = {
      enabled: false,
      trayIconEnabled: true,
      shortcutEnabled: true,
      shortcut: null,
      systemAudioEnabled: false,
      supportsRecording: false,
    };
    applySnipShortcut();
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
// The check used to run ONCE, at app start, on the reasoning that a user who
// leaves the app open for a week picks up the update on their next launch.
// HIDE_ON_CLOSE removed that launch: on macOS the X button now hides the main
// window instead of quitting, so a user who never explicitly hits Cmd+Q or
// "Quit" may never relaunch at all — and a start-up-only check would then never
// re-run for them, no matter how long an armed release has been waiting.
//
// So the check now also re-runs on a slow interval, and on demand via
// 'updater:check' (the renderer's "Check again" button). Finding an update is
// not the same as interrupting one: a check only sets `pendingUpdate` and emits
// 'updater:available'; `autoDownload` stays false and `UpdateAvailableBanner`
// only renders while `clocked-out`, so nothing reaches a working user — the
// original "no polling" note conflated discovering an update with delivering
// one.
const AUTO_UPDATE_SUPPORTED = process.platform === 'darwin';
const INSTALL_FLUSH_TIMEOUT_MS = 10000;
// Slow on purpose — the release cadence is weeks, and all this buys is that a
// hidden, never-relaunched app still discovers a release within the interval
// instead of never. Skipped entirely once an update is already known pending
// (see `runUpdateCheck`), so this never turns into a poll loop against GitHub.
const UPDATE_RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

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

  // Coalesced so the interval, the start-up call and a renderer-initiated
  // 'updater:check' can never have two checks racing each other — and skipped
  // once an update is already known, so a fleet stuck behind a compulsory
  // prompt doesn't also hammer GitHub every 4 hours asking again.
  let checkInFlight = null;
  function runUpdateCheck() {
    if (updateInstallStarted || pendingUpdate) return Promise.resolve();
    if (checkInFlight) return checkInFlight;
    checkInFlight = autoUpdater.checkForUpdates()
      .catch((err) => {
        console.error('Update check failed:', err);
        sendToRenderer('updater:status', { status: 'error', message: err && err.message });
      })
      .finally(() => { checkInFlight = null; });
    return checkInFlight;
  }

  // The renderer's "Check again" button — previously typed but unimplemented,
  // so it silently fell back to re-reading a `getPending()` that could never
  // change. Real now: it re-asks GitHub, and the renderer polls `getPending()`
  // afterwards to pick up the answer.
  ipcMain.handle('updater:check', () => runUpdateCheck());

  runUpdateCheck();
  setInterval(runUpdateCheck, UPDATE_RECHECK_INTERVAL_MS);
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
  // microphone, etc.).
  //
  // That used to end "screen capture goes through desktopCapturer, not
  // getUserMedia, so it is unaffected", which stopped being true the day
  // recording landed: a *still* capture is still `desktopCapturer` in main and
  // needs no permission here, but a **recording** calls `getDisplayMedia` in
  // the recorder window and is gated by this handler. See
  // `recorderMediaAllowed`.
  //
  // `clipboard-sanitized-write` is the ONE exception: navigator.clipboard
  // .writeText() routes through this handler, so a blanket deny silently breaks
  // every "copy link" button in the app. Sanitized write is write-only and
  // cannot read what the user already has on their clipboard — unlike
  // `clipboard-read`, which stays denied (pasting an image goes through the
  // explicit `clipboard:readImage` IPC instead).
  const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

  /**
   * The recording exception — and **this gate runs BEFORE
   * `setDisplayMediaRequestHandler`, not instead of it.**
   *
   * That ordering is the whole reason this exists, and missing it is a
   * genuinely silent failure: `getDisplayMedia` asks for a permission *here*
   * first, and only if it is granted does Chromium go on to ask the
   * display-media handler which source to hand over. A deny at this layer
   * rejects the call with `NotAllowedError` while the handler below —
   * including every one of its `console.error` branches — never runs at all.
   *
   * ## `mediaTypes` is the discriminator, and `media` is the permission
   *
   * Both of the recorder's calls arrive here as **`'media'`**. There is a
   * `display-capture` permission in the API and it is accepted below, but it
   * is not what this build asks for — verified from a real failure log, which
   * read `permission 'media' denied` on a screen capture. Gating screen
   * capture on `display-capture` alone therefore blocks every recording.
   *
   * So the window and the session are the boundary, and `mediaTypes` refines
   * the one decision worth refining:
   *
   * | Call | `mediaTypes` | Rule |
   * |---|---|---|
   * | `getDisplayMedia`, video only | `['video']` | allow |
   * | `getDisplayMedia` + system audio | `['video','audio']` | allow |
   * | anything audio-only | `['audio']` | **refuse** |
   *
   * **Audio-only is refused outright, because this build has no microphone.**
   * The recorder never calls `getUserMedia`, so an audio-only request from it
   * would mean something is asking for a device the feature does not use —
   * refuse it and let the next pass open it deliberately. A request carrying
   * video is a display capture: the recorder page never asks for a camera, and
   * the source is still chosen by main below, so granting it here grants no
   * particular screen.
   *
   * Everything outside the live recorder window is refused, which is what
   * keeps the app window — remote content from the deployment — from ever
   * reaching a microphone or a desktop stream.
   */
  const recorderMediaAllowed = (requester, details) => {
    const recording = snipRecording;
    const recorder = recording && recording.window;
    if (!recorder || recorder.isDestroyed() || requester !== recorder.webContents) return false;

    const types = details && details.mediaTypes;
    // An absent `mediaTypes` is the synchronous check path, which does not
    // carry one. The window and session scoping above already hold.
    if (!types || types.length === 0) return true;
    // No microphone in this build — see the table above.
    if (types.every(type => type === 'audio')) return false;
    return types.every(type => type === 'audio' || type === 'video');
  };

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if ((permission === 'media' || permission === 'display-capture') &&
        recorderMediaAllowed(webContents, details)) {
      callback(true);
      return;
    }
    // Logged rather than denied in silence. These two are the permissions a
    // recording depends on, so a refusal here is the difference between a
    // working feature and one that fails with no explanation anywhere.
    if (permission === 'display-capture' || permission === 'media') {
      // The mediaTypes are in the log because they are the discriminator, and
      // the first version of this omitted them — which turned a one-line
      // diagnosis ("it asked for video and we only allowed audio") into
      // several rounds of guessing. Never log the permission without them.
      const types = details && details.mediaTypes;
      console.error(
        `[snip] permission '${permission}' denied —`,
        `mediaTypes=[${(types || []).join(',')}]`,
        !snipRecording
          ? 'no recording in flight'
          : snipRecording.window && webContents === snipRecording.window.webContents
            ? 'from the recorder, but audio-only requests are refused (no microphone in this build)'
            : 'request did not come from the live recorder window',
      );
    }
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  // Chromium also asks synchronously (permissions.query / the write path in some
  // versions), which bypasses the request handler entirely.
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    if ((permission === 'media' || permission === 'display-capture') &&
        recorderMediaAllowed(webContents, details)) {
      return true;
    }
    return ALLOWED_PERMISSIONS.has(permission);
  });

  /**
   * `getDisplayMedia` — and the point of it is that the **renderer never names
   * a source**.
   *
   * The recorder page calls `getDisplayMedia({ video: true })` with no id and
   * no picker; main resolves which display to hand over from the session it
   * started, so a page that somehow ran this call could not choose a screen it
   * was not already sent there to record. Any other window asking is refused
   * outright — which is what keeps the app window, loaded from the
   * deployment, from ever holding a desktop stream.
   */
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const recorder = snipRecording && snipRecording.window;
      // Identity, not just the URL. `webContents.fromFrame` resolves the
      // requesting frame back to the window it belongs to, so this is an
      // object comparison against the recorder we opened rather than a string
      // comparison against a URL a page could in principle reach on its own.
      // The URL is still checked as the fallback for the case that lookup
      // returns nothing.
      let asking = null;
      try {
        asking = request.frame ? webContents.fromFrame(request.frame) : null;
      } catch {
        // A detached frame throws rather than returning null. Falling through
        // to the URL check is right, and letting this throw would be much
        // worse than refusing: the handler would never call `callback`, and
        // `getDisplayMedia` would hang forever with the bar stuck on Starting.
        asking = null;
      }
      const isRecorder = asking
        ? !recorder?.isDestroyed() && asking === recorder.webContents
        : request.frame?.url === SNIP_RECORD_PAGE_URL;
      if (!recorder || recorder.isDestroyed() || !isRecorder) {
        // An empty grant is how this API says no — and the page cannot tell
        // that refusal apart from the OS denying screen capture, because both
        // surface as the same `NotAllowedError`. Recording WHY here is what
        // stops a Windows user being sent to a permission screen that does not
        // exist. See the `denied` handling in `snip:rec-failed`.
        console.error(
          '[snip] display-media request refused:',
          !recorder ? 'no live recording' : recorder.isDestroyed() ? 'recorder destroyed' : 'not the recorder window',
        );
        if (snipRecording) snipRecording.denied = 'stream-refused';
        callback({});
        return;
      }

      const target = snipRecording.display;
      desktopCapturer
        .getSources({ types: ['screen'], fetchWindowIcons: false })
        .then((sources) => {
          if (sources.length === 0) {
            console.error('[snip] desktopCapturer returned no screen sources');
            if (snipRecording) snipRecording.denied = 'no-sources';
            callback({});
            return;
          }
          const index = electronScreen.getAllDisplays().findIndex(d => d.id === target.id);
          const source =
            sources.find(s => s.display_id && String(s.display_id) === String(target.id)) ||
            sources[index] ||
            sources[0];
          callback({
            video: source,
            // Windows only — see `SNIP_SYSTEM_AUDIO_SUPPORTED`. `'loopback'`
            // rather than `'loopbackWithMute'`: muting the desktop while
            // recording it would silence the thing the user is demonstrating
            // for the person sitting in front of it.
            ...(snipRecording.audio.system ? { audio: 'loopback' } : {}),
          });
        })
        .catch((err) => {
          console.error('[snip] could not resolve a display source:', err.message);
          if (snipRecording) snipRecording.denied = 'no-sources';
          callback({});
        });
    },
    // The OS picker would ask the user to choose a screen they have already
    // chosen by dragging a rectangle on one.
    { useSystemPicker: false },
  );

  // Spellcheck language. macOS uses the OS spellchecker and rejects this call,
  // so it is best-effort.
  try {
    session.defaultSession.setSpellCheckerLanguages(['en-US']);
  } catch {
    // macOS — the system spellchecker picks the language itself.
  }

  // Rebuilt before any window exists, so the first `snip:pending-changed` the
  // renderer asks for already has the previous session's failures in it.
  loadSnipQueue();

  registerDownloadHandler();
  registerPowerListeners();
  registerAutoUpdater();
  registerDisplayListeners();
  createWindow();
  // Dock-icon click / Cmd+Tab. On macOS the main window is usually only hidden,
  // not gone, so reveal it rather than testing for zero windows — a live
  // satellite (OF Manager) would otherwise make this a no-op and leave the user
  // with no way back to the app.
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    revealMainWindow();
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

// Quit when the last window closes — except on macOS, where the X button only
// hides the main window and the app is expected to stay alive in the dock until
// the user quits it explicitly. The time-tracking flush happens in the window
// `close` handler (createWindow), which is the single choke-point for both the
// Windows X button and Cmd/Ctrl-Q.
app.on('window-all-closed', () => {
  if (HIDE_ON_CLOSE && !isQuitting) return;
  app.quit();
});
