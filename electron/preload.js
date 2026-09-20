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
    // `path` must be under an allowlisted prefix (/of-manager, /gologin);
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

  // GoLogin — launches a profile's Orbita browser on THIS machine. The browser
  // is its own OS window, not an Electron one; these calls drive the session,
  // and /gologin/session/<id> is its console. The API token never crosses this
  // bridge: main fetches it per launch and keeps it in its own memory.
  gologin: {
    launch: (idToken, profileId, deviceId) =>
      ipcRenderer.invoke('gologin:launch', { idToken, profileId, deviceId }),
    stop: (profileId) => ipcRenderer.invoke('gologin:stop', profileId),
    getSession: (profileId) => ipcRenderer.invoke('gologin:get-session', profileId),
    listSessions: () => ipcRenderer.invoke('gologin:list-sessions'),
    onSessionChanged: (callback) =>
      ipcRenderer.on('gologin:session-changed', (_event, session) => callback(session)),
    removeSessionChangedListeners: () =>
      ipcRenderer.removeAllListeners('gologin:session-changed'),

    // Closing the window is guarded while any profile is open or still saving:
    // `gl.stop()` uploads the session's cookies and local state, and an open
    // Orbita outlives the window that was showing it. Main holds the window open
    // and asks the renderer what to do. See guardGoLoginWindowClose in main.js.
    busyProfiles: () => ipcRenderer.invoke('gologin:busy-profiles'),
    closeDecision: (decision) => ipcRenderer.invoke('gologin:close-decision', decision),
    onCloseBlocked: (callback) =>
      ipcRenderer.on('gologin:close-blocked', (_event, payload) => callback(payload)),
    removeCloseBlockedListeners: () =>
      ipcRenderer.removeAllListeners('gologin:close-blocked'),

    // Orbita, the Chromium build GoLogin profiles actually run in. It is a
    // hundreds-of-megabytes download that can also start *during* a launch,
    // because the version a profile needs comes from its own user agent — so the
    // window watches this to know when to block on a progress bar.
    orbitaStatus: () => ipcRenderer.invoke('gologin:orbita-status'),
    ensureOrbita: (version) => ipcRenderer.invoke('gologin:ensure-orbita', version),
    onOrbitaChanged: (callback) =>
      ipcRenderer.on('gologin:orbita-changed', (_event, state) => callback(state)),
    removeOrbitaChangedListeners: () =>
      ipcRenderer.removeAllListeners('gologin:orbita-changed'),
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
    // Written from MAIN, not `navigator.clipboard.writeText`, which needs the
    // document focused — a snip completes while the user is in another app with
    // this window hidden, so the web API would silently do nothing.
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  },

  // Snipping Tool — the region capture. `configure` arms the global shortcut and
  // the menu-bar/tray item (and disarms them: pushing `enabled: false` is how a
  // user who loses the page permission gets them taken away). `start` is the
  // in-app "New Snip" button; the shortcut and tray call into main directly.
  //
  // `onCaptured` delivers the cropped PNG as base64 — only the selected region
  // ever reaches this context, never the full screen. The renderer uploads it.
  // The selection surface itself is transparent and never receives an image at
  // all; see electron/snip-preload.js.
  snip: {
    configure: (config) => ipcRenderer.invoke('snip:configure', config),
    start: () => ipcRenderer.invoke('snip:start'),
    onCaptured: (callback) => {
      ipcRenderer.on('snip:captured', (_event, payload) => callback(payload));
    },
    // The capture is taken AFTER the user has already drawn their box, so a
    // failure there is silent from their side — they did the work and nothing
    // happened. This is what lets the renderer say so.
    onFailed: (callback) => {
      ipcRenderer.on('snip:failed', (_event, payload) => callback(payload));
    },
    removeCapturedListeners: () => {
      ipcRenderer.removeAllListeners('snip:captured');
      ipcRenderer.removeAllListeners('snip:failed');
    },
    // The tray's "My Snips" item — main asks the renderer to navigate rather
    // than loading a URL itself, so the App Router transition is a normal
    // client-side one and the watchdog (NavigationWatchdog) sees it.
    onNavigate: (callback) => {
      ipcRenderer.on('snip:navigate', (_event, href) => callback(href));
    },
    removeNavigateListeners: () => {
      ipcRenderer.removeAllListeners('snip:navigate');
    },

    // ── Recording ──────────────────────────────────────────────────
    //
    // Note what is absent, and deliberately: there is no `onRecordingChunk`,
    // no stream, and no file path. A recording is captured in its own local
    // window, streamed to a temp file by MAIN, and PUT to Cloud Storage BY
    // MAIN from that file. This context is told only that one is ready, and
    // hands back the signed URL to send it to.
    //
    // The app window loads remote content from the deployment, so every one of
    // those is a boundary rather than a convenience: a desktop stream here
    // would make any script on the page a screen recorder, and a path here
    // would be a path that page could be talked into naming.

    /** A finished recording is waiting. `token` is an opaque handle main
     *  resolves to a temp file — never a path. */
    onRecorded: (callback) => {
      ipcRenderer.on('snip:recorded', (_event, payload) => callback(payload));
    },
    removeRecordedListeners: () => {
      ipcRenderer.removeAllListeners('snip:recorded');
    },

    /** Hand main a signed slot and let it stream the file there. Resolves
     *  `{ success, error?, posterUploaded }`. */
    uploadRecording: (options) => ipcRenderer.invoke('snip:uploadRecording', options),

    /** Drop a finished recording without uploading it — the slot could not be
     *  signed, or the user's session is gone. */
    /** Drop a queued recording for good — the slot could not be signed, or the
     *  user chose to delete it. A failed *transfer* keeps its file; this is
     *  for the cases where there is nowhere for it to go. */
    discardRecording: (token) => ipcRenderer.invoke('snip:discardRecording', token),

    /**
     * Recordings still waiting to upload, including ones that have failed.
     *
     * The queue lives on disk in `userData`, so this survives a quit, a crash
     * and a reboot — a failed upload is a recording the user still has, and
     * the Snipping Tool page lists these with a Retry.
     */
    listPendingRecordings: () => ipcRenderer.invoke('snip:listPendingRecordings'),
    /** Fires whenever the queue changes, so the page never polls. */
    onPendingChanged: (callback) => {
      ipcRenderer.on('snip:pending-changed', (_event, list) => callback(list));
    },
    removePendingListeners: () => {
      ipcRenderer.removeAllListeners('snip:pending-changed');
      ipcRenderer.removeAllListeners('snip:upload-progress');
    },
    /** Bytes confirmed *by the bucket* during a resumable upload. */
    onUploadProgress: (callback) => {
      ipcRenderer.on('snip:upload-progress', (_event, p) => callback(p));
    },
    /** The escape hatch: write a queued recording somewhere the user picks.
     *  Main shows the native dialog; the renderer never names a path. */
    savePendingRecording: (token) => ipcRenderer.invoke('snip:savePendingRecording', token),

    /** The Video toggles were changed on the selection surface. The app window
     *  is the only side with a Firebase session, so it does the writing. */
    onAudioPrefs: (callback) => {
      ipcRenderer.on('snip:audio-prefs', (_event, prefs) => callback(prefs));
    },
    removeAudioPrefsListeners: () => {
      ipcRenderer.removeAllListeners('snip:audio-prefs');
    },
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
