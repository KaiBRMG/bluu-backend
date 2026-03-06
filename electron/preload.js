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
  },

  // Time tracking
  timeTracking: {
    getIdleTime: () => ipcRenderer.invoke('timeTracking:getIdleTime'),
    captureScreenshot: () => ipcRenderer.invoke('timeTracking:captureScreenshot'),
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

  // Auto-updater
  updater: {
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
      ipcRenderer.removeAllListeners('updater:status');
      ipcRenderer.removeAllListeners('updater:progress');
      ipcRenderer.removeAllListeners('updater:before-install');
    },
  },
});
