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
    setResizable: (resizable) => ipcRenderer.send('window:set-resizable', resizable)
  }
});
