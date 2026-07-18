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

  // Window control
  window: {
    setResizable: (resizable) => ipcRenderer.send('window:set-resizable', resizable),
    setSize: (width, height) => ipcRenderer.send('window:set-size', width, height),
    getSize: () => ipcRenderer.invoke('window:get-size'),
  },

  // Time tracking
  timeTracking: {
    getIdleTime: () => ipcRenderer.invoke('timeTracking:getIdleTime'),
    captureScreenshot: () => ipcRenderer.invoke('timeTracking:captureScreenshot'),
    setPowerSaveBlocker: (enable) => ipcRenderer.invoke('timeTracking:setPowerSaveBlocker', enable),
    getActivitySince: (sinceMs) => ipcRenderer.invoke('timeTracking:getActivitySince', sinceMs),
  },

  // Notifications
  notifications: {
    show: (options) => ipcRenderer.invoke('notifications:show', options),
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
    // Retry loading the hosted app from the offline screen.
    retryLoad: () => ipcRenderer.send('app:retry-load'),
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
