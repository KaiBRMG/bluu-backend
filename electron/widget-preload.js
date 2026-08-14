// electron/widget-preload.js
//
// Preload for the Windows timer HUD (widget.html) ONLY.
//
// Deliberately NOT the app's `preload.js`: the HUD needs exactly one thing —
// to be told what to display — and handing a always-on-top always-running
// window the whole electronAPI surface (OAuth, screen capture, file writes,
// satellite spawning) would widen the attack surface for no benefit.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timerWidget', {
  onTick: (callback) => {
    ipcRenderer.on('timer-widget:tick', (_event, data) => callback(data));
  },
});
