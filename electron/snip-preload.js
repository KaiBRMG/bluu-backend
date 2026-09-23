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
// Narration DOES ship, and note carefully what that added and what it did not.
// There are three microphone channels below, and every one of them is about
// *permission* — a status read, a prompt, and a link to the OS settings page.
// There is still **no media channel of any kind**: this window never receives a
// stream, never opens one, and has no way to hand bytes back to main. The
// picker names devices through `navigator.mediaDevices.enumerateDevices()`,
// which main allows for this window as a permission *check* only, so labels are
// readable and `getUserMedia` is still refused here. The microphone is opened
// in the recorder window (electron/snip-record.html), never in this one.
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

  /** Remember the System audio and Microphone choices for next time. Main
   *  relays them to the app window, which is the only side holding a Firebase
   *  session. */
  /**
   * **`invoke`, not `send`, and that is a correctness requirement rather than
   * a style choice.**
   *
   * Main gates the surface's access to device *labels* on its own cached
   * `snipConfig.micEnabled` (`surfaceMayListDevices`), so main has to know the
   * microphone is on **before** the page enumerates devices. A fire-and-forget
   * `send` gave no way to wait for that, which is exactly how re-enabling the
   * microphone produced "No microphone was found": the enumeration ran against
   * a main process that still thought the toggle was off, Chromium withheld
   * the device ids, and an empty list looked like absent hardware.
   */
  saveAudioPrefs: (prefs) => ipcRenderer.invoke('snip:audio-prefs', prefs),

  // ── Microphone permission ──────────────────────────────────────────
  //
  // Permission only. None of these returns audio, and none of them can be used
  // to open a device — see the note at the top of this file.

  /** `{ supported, status, canPrompt }`, read fresh from the OS every call.
   *  A pure read: it shows nothing, focuses nothing, and cannot disturb the
   *  surface. */
  micStatus: () => ipcRenderer.invoke('permissions:microphoneStatus'),

  /**
   * Opens the OS microphone settings page.
   *
   * **There is deliberately no `requestMic` here, and that omission is
   * load-bearing.** This window is full-screen, always-on-top and — on a
   * single-display setup — cancels the snip on blur (`armSnipOverlays`). So
   * anything that takes focus destroys the surface it was called from: a macOS
   * TCC prompt raised here would cancel the snip mid-question and resolve its
   * promise into a window that no longer exists.
   *
   * The prompt therefore happens in `startSnipRecording`, **after** the
   * surfaces are destroyed and the user has their desktop back, which is also
   * the only place it can be raised without landing inside the recording. The
   * surface's job is to say what the status is; it never asks.
   *
   * This call is a deliberate hand-off and the page cancels the snip
   * alongside it, because the user cannot interact with the Settings window
   * underneath a full-screen overlay.
   */
  openMicSettings: () => ipcRenderer.invoke('permissions:openMicrophoneSettings'),
});
