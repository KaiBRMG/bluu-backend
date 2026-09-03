// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Check if running in Electron
  isElectron: true,

  // OAuth flow
  auth: {
    startGoogleOAuth: () => ipcRenderer.invoke('auth:start-google-oauth'),
    onOAuthCallback: (callback) => {
      ipcRenderer.on('oauth-callback', (_event, code) => callback(code));
    },
    onOAuthError: (callback) => {
      ipcRenderer.on('oauth-error', (_event, error) => callback(error));
    },
    removeOAuthListeners: () => {
      ipcRenderer.removeAllListeners('oauth-callback');
      ipcRenderer.removeAllListeners('oauth-error');
    }
  },

  // Window control. Every call is scoped in main to the window that made it
  // (BrowserWindow.fromWebContents), so a satellite resizes itself — never the
  // main window. See documentation/electron.md.
  window: {
    setResizable: (resizable) => ipcRenderer.send('window:set-resizable', resizable),
    setSize: (width, height) => ipcRenderer.send('window:set-size', width, height),
    getSize: () => ipcRenderer.invoke('window:get-size'),
    // Outer size + maximize state, so the renderer never persists maximized bounds.
    getState: () => ipcRenderer.invoke('window:get-state'),
    // Display work area in DIPs — authoritative, unlike zoom-skewed window.screen.*
    getWorkArea: () => ipcRenderer.invoke('window:get-work-area'),
    maximize: () => ipcRenderer.send('window:maximize'),
    minimize: () => ipcRenderer.send('window:minimize'),
    focus: () => ipcRenderer.send('window:focus'),
    // Satellites only — the main window must close through the clock-out flush.
    close: () => ipcRenderer.send('window:close'),
    setAlwaysOnTop: (flag) => ipcRenderer.send('window:set-always-on-top', flag),
    isFocused: () => ipcRenderer.invoke('window:is-focused'),
    setZoom: (factor) => ipcRenderer.send('window:set-zoom', factor),
    getZoom: () => ipcRenderer.invoke('window:get-zoom'),
    // Windows taskbar badge. The renderer draws the image (canvas → data URL), so
    // the badge can be restyled without shipping a native build. No-op elsewhere.
    setOverlayIcon: (dataUrl, description) =>
      ipcRenderer.send('window:set-overlay-icon', { dataUrl, description }),
    // Windows/Linux "look at me" taskbar flash.
    flashFrame: (flag) => ipcRenderer.send('window:flash-frame', flag),
    // Fires ONLY for user-initiated resize/maximize — never for our own auto-size.
    onUserResized: (callback) => {
      ipcRenderer.on('window:user-resized', (_event, state) => callback(state));
    },
    removeUserResizedListener: () => {
      ipcRenderer.removeAllListeners('window:user-resized');
    },
    // Focus/blur of THIS window — lets a chat window decide whether an incoming
    // message deserves a notification, or whether to mark the thread read.
    onFocusChange: (callback) => {
      ipcRenderer.on('window:focus-changed', (_event, data) => callback(data));
    },
    removeFocusChangeListener: () => {
      ipcRenderer.removeAllListeners('window:focus-changed');
    },

    // ─── Satellite windows ───────────────────────────────────────────
    // `path` must be under an allowlisted prefix (currently /of-manager);
    // main validates it and re-checks the page permission server-side before
    // the window is created. One window per `key`; a repeat call focuses it.
    openSatellite: (idToken, options = {}) =>
      ipcRenderer.invoke('window:open-satellite', { idToken, ...options }),
    closeSatellite: (key) => ipcRenderer.invoke('window:close-satellite', key),
    listSatellites: () => ipcRenderer.invoke('window:list-satellites'),
  },

  // OF Manager — spawns the OnlyFans window. The ID token is passed so the main
  // process can verify the page permission server-side before the window is
  // created (see 'onlyfans:open-window' in main.js). `options.path` opens a
  // sub-route (a popped-out chat, a vault view) in its own window.
  onlyfans: {
    openWindow: (idToken, options = {}) =>
      ipcRenderer.invoke('onlyfans:open-window', { idToken, ...options }),
  },

  // Time tracking
  timeTracking: {
    getIdleTime: () => ipcRenderer.invoke('timeTracking:getIdleTime'),
    captureScreenshot: () => ipcRenderer.invoke('timeTracking:captureScreenshot'),
    setPowerSaveBlocker: (enable) => ipcRenderer.invoke('timeTracking:setPowerSaveBlocker', enable),
    getActivitySince: (sinceMs) => ipcRenderer.invoke('timeTracking:getActivitySince', sinceMs),
  },

  // Always-visible session timer (macOS tray title / Windows docked HUD).
  // Push an ANCHOR, never a per-second value: main re-derives the display each
  // second from the same base + instant the renderer's own tick uses, so the two
  // clocks cannot drift and this costs one message per transition. Build the
  // payload with buildTimerWidgetPayload (src/lib/timerWidget.ts), never by hand.
  timerWidget: {
    update: (payload) => ipcRenderer.send('timer-widget:update', payload),
  },

  // Notifications. `target` picks the destination window: omitted → the calling
  // window, 'main' → the main window, or a satellite key.
  notifications: {
    show: (options) => ipcRenderer.invoke('notifications:show', options),
    close: (id) => ipcRenderer.invoke('notifications:close', id),
    onNavigate: (callback) => {
      ipcRenderer.on('notification:navigate', (_event, url) => callback(url));
    },
    removeNavigateListener: () => {
      ipcRenderer.removeAllListeners('notification:navigate');
    },
    onPlaySound: (callback) => {
      ipcRenderer.on('notifications:play-sound', () => callback());
    },
    removePlaySoundListener: () => {
      ipcRenderer.removeAllListeners('notifications:play-sound');
    },
    // Clicked (with an id but no actionUrl), macOS inline reply, action button.
    onActivated: (callback) => {
      ipcRenderer.on('notification:activated', (_event, data) => callback(data));
    },
    onReply: (callback) => {
      ipcRenderer.on('notification:reply', (_event, data) => callback(data));
    },
    onAction: (callback) => {
      ipcRenderer.on('notification:action', (_event, data) => callback(data));
    },
    removeInteractionListeners: () => {
      ipcRenderer.removeAllListeners('notification:activated');
      ipcRenderer.removeAllListeners('notification:reply');
      ipcRenderer.removeAllListeners('notification:action');
    },
  },

  // Clipboard. Image only, and only on an explicit call — `clipboard-read` stays
  // denied at the Chromium layer, so this is the single narrow read path (pasting
  // a screenshot into a composer).
  clipboard: {
    readImage: () => ipcRenderer.invoke('clipboard:readImage'),
  },

  // Saving files. The renderer never names a path: main shows a native save
  // dialog and only reveals/opens paths it wrote during this session.
  files: {
    save: (options) => ipcRenderer.invoke('dialog:saveFile', options),
    // Streams a remote URL to disk with a save dialog — use this instead of
    // `save` for large media, so the bytes never sit in renderer memory.
    download: (options) => ipcRenderer.invoke('download:start', options),
    showInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
    open: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),
    onDownloadProgress: (callback) => {
      ipcRenderer.on('download:progress', (_event, data) => callback(data));
    },
    onDownloadDone: (callback) => {
      ipcRenderer.on('download:done', (_event, data) => callback(data));
    },
    removeDownloadListeners: () => {
      ipcRenderer.removeAllListeners('download:progress');
      ipcRenderer.removeAllListeners('download:done');
    },
  },

  // App lifecycle
  onAppClosing: (callback) => {
    ipcRenderer.on('app-closing', () => callback());
  },
  removeAppClosingListeners: () => {
    ipcRenderer.removeAllListeners('app-closing');
  },

  // Bug reporting — main process forwards errors here so renderer can POST to /api/bugs
  bugs: {
    onReport: (callback) => {
      ipcRenderer.on('bug:report', (_event, payload) => callback(payload));
    },
    removeReportListener: () => {
      ipcRenderer.removeAllListeners('bug:report');
    },
  },

  // Platform / version info + lifecycle
  app: {
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getVersions: () => ipcRenderer.invoke('app:getVersions'),
    signalReady: () => ipcRenderer.send('app:ready'),
    // Renderer calls this once it has finished flushing time-tracking data on
    // app close, so the main process can complete the quit.
    closingFlushed: () => ipcRenderer.send('app:closing-flushed'),
    // Retry loading the hosted app from the offline screen. Scoped to the window
    // that calls it, and reloads that window's own route.
    retryLoad: () => ipcRenderer.send('app:retry-load'),
    // Unread badge. macOS/Linux dock number; use window.setOverlayIcon on Windows.
    setBadgeCount: (count) => ipcRenderer.invoke('app:setBadgeCount', count),
    bounceDock: (type) => ipcRenderer.invoke('app:bounceDock', type),
    cancelBounce: (id) => ipcRenderer.send('app:cancelBounce', id),
    // Non-OAuth bluu:// deep links. The shell does not interpret them — the
    // renderer owns routing, so new deep-link routes need no native build.
    // Read the pending one on mount (it may arrive before React mounts).
    getPendingDeepLink: () => ipcRenderer.invoke('app:getPendingDeepLink'),
    onDeepLink: (callback) => {
      ipcRenderer.on('deeplink:route', (_event, data) => callback(data));
    },
    removeDeepLinkListener: () => {
      ipcRenderer.removeAllListeners('deeplink:route');
    },
  },

  // Native power / session events (suspend | resume | lock | unlock)
  power: {
    onEvent: (callback) => {
      ipcRenderer.on('power:event', (_event, data) => callback(data));
    },
    removeEventListener: () => {
      ipcRenderer.removeAllListeners('power:event');
    },
  },

  // OS permission prompts
  permissions: {
    requestScreenAccess: () => ipcRenderer.invoke('permissions:requestScreenAccess'),
    requestNotification: () => ipcRenderer.invoke('permissions:requestNotification'),
    // TEMPORARY: one-time stale-TCC repair for existing users (see CLAUDE.md).
    resetScreenCapture: () => ipcRenderer.invoke('permissions:resetScreenCapture'),
  },

  // Auto-updater (macOS only; the main process no-ops elsewhere)
  updater: {
    // Result of the start-up check. Returns null when no update is available.
    // The renderer mounts after the check resolves, so it polls this rather
    // than relying on catching 'updater:available'.
    getPending: () => ipcRenderer.invoke('updater:getPending'),
    // Re-run the GitHub check on demand ('Check again'). Resolves once the
    // check finishes; the caller re-reads getPending() for the answer.
    check: () => ipcRenderer.invoke('updater:check'),
    onAvailable: (callback) => {
      ipcRenderer.on('updater:available', (_event, data) => callback(data));
    },
    // Starts the download — only ever called from an explicit user action.
    download: () => {
      ipcRenderer.send('updater:download');
    },
    onStatus: (callback) => {
      ipcRenderer.on('updater:status', (_event, data) => callback(data));
    },
    onProgress: (callback) => {
      ipcRenderer.on('updater:progress', (_event, data) => callback(data));
    },
    onBeforeInstall: (callback) => {
      ipcRenderer.once('updater:before-install', () => callback());
    },
    readyToInstall: () => {
      ipcRenderer.send('updater:ready-to-install');
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('updater:available');
      ipcRenderer.removeAllListeners('updater:status');
      ipcRenderer.removeAllListeners('updater:progress');
      ipcRenderer.removeAllListeners('updater:before-install');
    },
  },
});
