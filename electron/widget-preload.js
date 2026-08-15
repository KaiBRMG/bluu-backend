// electron/widget-preload.js
//
// Preload for the Windows timer HUD (widget.html) ONLY.
//
// Deliberately NOT the app's `preload.js`: the HUD needs exactly two things —
// to be told what to display, and to let the user drag it out of the way — and
// handing a always-on-top always-running window the whole electronAPI surface
// (OAuth, screen capture, file writes, satellite spawning) would widen the
// attack surface for no benefit.
//
// The drag channels carry NO coordinates. The page only says "a grab started /
// ended / the cursor is over me"; main reads the OS cursor itself and owns the
// clamp. Nothing here can therefore ask for an arbitrary window position.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timerWidget', {
  onTick: (callback) => {
    ipcRenderer.on('timer-widget:tick', (_event, data) => callback(data));
  },
  /** Solid while the cursor is on the pill; click-through again when it leaves. */
  setInteractive: (interactive) => ipcRenderer.send('timer-widget:set-interactive', !!interactive),
  dragStart: () => ipcRenderer.send('timer-widget:drag-start'),
  dragEnd: () => ipcRenderer.send('timer-widget:drag-end'),
  resetPosition: () => ipcRenderer.send('timer-widget:reset-position'),
});
