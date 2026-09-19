// electron/snip-preload.js
//
// The bridge for the selection surface (electron/snip.html) — and deliberately
// the narrowest surface in the app: two channels, no app APIs, no session.
//
// The surface is an always-on-top, fully transparent window covering the user's
// entire screen while it watches their mouse. Giving it the main `preload.js`
// would hand that window the whole `electronAPI` surface — GoLogin launches,
// satellite spawning, the clipboard — for a page whose only job is to report a
// rectangle. It gets its own preload for the same reason `widget-preload.js`
// exists.
//
// Note what is NOT here: nothing sends the page an image. The surface never
// receives a capture, never holds one, and has no way to ask for one — main
// photographs the screen itself, after this window's marks are cleared. See the
// snip section of electron/main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snipAPI', {
  /** `{ x, y, width, height }` in CSS pixels of this display. Main scales it
   *  into the capture's device pixels before cropping. */
  commit: (rect) => ipcRenderer.send('snip:region', rect),
  cancel: () => ipcRenderer.send('snip:cancel'),
});
