// electron/snip-preload.js
//
// The bridge for the selection surface (electron/snip.html) — and deliberately
// the narrowest surface in the app: three channels, no app APIs, no session.
//
// The surface is an always-on-top, fully transparent window covering the user's
// entire screen while it watches their mouse. Giving it the main `preload.js`
// would hand that window the whole `electronAPI` surface — GoLogin launches,
// satellite spawning, the clipboard — for a page whose only job is to report a
// rectangle. It gets its own preload for the same reason `widget-preload.js`
// exists.
//
// Note what is NOT here: nothing sends the page an image, and nothing gives it
// a media stream. The surface never receives a capture, never holds one, and
// has no way to ask for one — main photographs the screen itself, after this
// window's marks are cleared, and a recording runs in a *different* window
// (electron/snip-record.html) that opens only once this one is gone. See the
// snip section of electron/main.js.
//
// There is also **no microphone channel**. Narration is not in this pass at
// all; when it returns it needs a permission probe here, an Info.plist usage
// string and a macOS entitlement, none of which ship today.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snipAPI', {
  /**
   * `{ rect, mode, audio }` — the rectangle in CSS pixels of this display, plus
   * what the user asked for in the bar. Main scales the rectangle into the
   * capture's device pixels before cropping, and the mode decides whether the
   * next step is a photograph or a recorder window.
   */
  commit: (payload) => ipcRenderer.send('snip:region', payload),
  cancel: () => ipcRenderer.send('snip:cancel'),

  /** Remember the System audio toggle for next time. Main relays it to the app
   *  window, which is the only side holding a Firebase session. */
  saveAudioPrefs: (prefs) => ipcRenderer.send('snip:audio-prefs', prefs),
});
