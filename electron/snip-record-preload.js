// electron/snip-record-preload.js
//
// The bridge for the recording window (electron/snip-record.html): the control
// bar the user sees while a recording runs, and the page that actually holds
// the MediaRecorder.
//
// ## Why this window exists at all, and why it is one window and not two
//
// The recording cannot happen in the selection surface: that window is
// full-screen and always-on-top, so leaving it up would mean the user cannot
// click anything on their own desktop while recording — and the whole point of
// recording a region is that they then go and use it. The surfaces come down
// the moment the rectangle is committed and this window takes over.
//
// It cannot happen in the main app window either. That window loads REMOTE
// content from the deployment, and handing a remote origin a full-screen
// desktop stream would turn any script running there into a screen recorder.
// The stream stays in a local `file://` page with this preload and nothing
// else — no session, no Firebase, no `electronAPI`, no navigation.
//
// The control bar and the recorder are the SAME window on purpose. The bar has
// to be visible anyway (it is how the user stops), and a visible window is one
// whose `requestAnimationFrame` actually fires — a hidden recorder would be a
// crop loop the compositor is entitled to stop scheduling. Being visible is
// also why main marks it content-protected: see `setContentProtection` in
// main.js, which is what keeps this bar out of the recording it is making.
//
// ## The bytes never come back through here
//
// `chunk` pushes each `ondataavailable` blob to main, which appends it to a
// temp file on disk. The finished recording is then PUT to Cloud Storage **by
// main**, from that file, over a signed URL the app window fetched. Three
// things fall out of that and each is the reason for it: renderer memory never
// holds more than one chunk of a ten-minute recording; the bytes never cross a
// Vercel function (rule 9i); and a `file://` page never has to make a
// cross-origin PUT, which would arrive at the bucket as `Origin: null`.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorderAPI', {
  /**
   * What to record: `{ rect, display, audio, limits }`.
   *
   * Sent by main once the window has loaded rather than read from the query
   * string, because the rectangle and the display geometry are numbers this
   * page does arithmetic with and a query string is a place to lose precision.
   */
  onStart: (callback) => {
    ipcRenderer.on('snip:rec-start', (_event, payload) => callback(payload));
  },

  /** One `ondataavailable` blob, as an ArrayBuffer. Main appends it to the
   *  temp file and forgets it. */
  chunk: (buffer) => ipcRenderer.send('snip:rec-chunk', buffer),

  /** The first drawn frame, as a PNG ArrayBuffer. Uploaded alongside the
   *  recording so the library grid has something to show. */
  poster: (buffer) => ipcRenderer.send('snip:rec-poster', buffer),

  /** Recording finished and every chunk has been sent. */
  done: (summary) => ipcRenderer.send('snip:rec-done', summary),

  /** The user pressed the bin, or the recording never got off the ground. */
  discard: (reason) => ipcRenderer.send('snip:rec-discard', reason),

  /** Could not start: no stream, no permission, no encoder. Main relays it to
   *  the app window, which is the only place that can raise a toast. */
  failed: (payload) => ipcRenderer.send('snip:rec-failed', payload),

  /** Move this window out of the way of the rectangle being recorded, in that
   *  display's coordinates. Main clamps it to the display. */
  place: (box) => ipcRenderer.send('snip:rec-place', box),

  /**
   * Whether the cursor is over the bar itself.
   *
   * The window is click-through by default so the user can keep working on the
   * desktop underneath it; main makes it clickable only while this reports
   * true. Without it, the bar's shadow margin and the transparent wedges
   * outside its rounded corners would silently eat clicks on whatever is being
   * recorded.
   */
  interactive: (value) => ipcRenderer.send('snip:rec-interactive', !!value),

  /** Recording vs paused, so main can tint the region frame to match. That
   *  window has no script of its own by design. */
  state: (value) => ipcRenderer.send('snip:rec-state', value),
});
