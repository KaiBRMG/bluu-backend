# Snipping Tool

> Region screen capture — **a still or a recording with sound** — from a global shortcut or a menu-bar/tray item, uploaded to Cloud Storage and shared with a public link. The only feature in the app whose primary entry point is **outside the app**.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `electron/main.js` (§ Snipping Tool) | Global shortcut, tray item, transparent selection surfaces, the post-selection capture + crop |
| `electron/snip.html` | The selection surface — fully transparent; drag, readout, Escape, and the **Image/Video mode bar** |
| `electron/snip-preload.js` | The surface's bridge. Commit/cancel, a microphone **status read** and a settings hand-off, and deliberately **no image or media channel** |
| `electron/snip-record.html` | The **recorder**: the control bar the user sees while recording, and the page holding the `MediaRecorder` |
| `electron/snip-record-preload.js` | The recorder's bridge. Chunks out, never bytes back |
| `electron/preload.js` (`snip`, `clipboard.writeText`) | The main window's bridge |
| `src/components/snips/SnipController.tsx` | Arms the shell, uploads a capture, copies the link. Mounted on `(main)/layout.tsx` |
| `src/lib/snips.ts` | Shared constants: retention, accelerators, share-token validation, `SNIPPING_TOOL_PAGE_ID` |
| `src/lib/snipUpload.ts` | The three-leg upload (sign → PUT → finalise), for both kinds. A recording's middle leg is a **resumable session driven by main** |
| `src/app/(main)/applications/snipping-tool/_components/PendingUploads.tsx` | Recordings that have not uploaded — the visible half of the durable queue |
| `src/lib/services/snipService.ts` | Everything server-side: tokens, slots, projections, retention, the sweep |
| `src/app/(main)/applications/snipping-tool/` | The library page + settings popover + shortcut recorder |
| `src/app/(main)/applications/snipping-tool/_components/SnipDetailsDialog.tsx` | Title + description, written after the fact |
| `src/app/(main)/applications/snipping-tool/_components/SnipMicrophoneField.tsx` | The microphone's **permission** state and the way to fix it |
| `src/app/(main)/applications/snipping-tool/_components/SnipImportDialog.tsx` | **Import** — an image from disk, given a share link |
| `src/lib/snipSounds.ts` | The shutter and the recording cue. Played by the renderer; main has no audio |
| `src/app/s/_components/SnipVideo.tsx` | The public **player** — own controls, because the file states no duration |
| `src/app/s/[shareId]/` | The **public** page |
| `src/app/s/not-found.tsx` | What a recipient sees when a link has expired, been deleted or never existed |
| `src/app/api/snips/*` | Owner-facing routes (page permission + `ownerUid`) |
| `src/app/api/public/snip/[shareId]/image` | Unauthenticated 302 to a signed Storage URL — the still (image, or a recording's poster) |
| `src/app/api/public/snip/[shareId]/video` | The same, for a recording's WebM |
| `src/app/api/cron/snip-cleanup` | Daily retention sweep (`src/vercel.json`) |

## Firestore

- `snips/{shareId}` — **the document id IS the public share token.** Admin-SDK only (`firestore.rules` §24b). `kind` (`image` | `video`, **absent reads as `image`**), `durationMs` and `posterPath` were added with recording; `source` (`capture` | `import`, **absent reads as `capture`**), `title` and `description` came with Import and the details dialog. All six are unqueried and carry `"indexes": []` overrides (rule 9).
- `users/{uid}.snipSettings` — `{ trayIconEnabled, shortcutEnabled, shortcut, retention, systemAudioEnabled, autoCopyEnabled, micEnabled, micDeviceId }`. `systemAudioEnabled` and `micEnabled` are the **two** fields in that map where absent means OFF (`=== true`, not `!== false`): every other setting is a convenience, while those two record the desktop's own output and the room the user is sitting in. `autoCopyEnabled` follows the normal `!== false` rule — absent is on, which is the behaviour the tool shipped with. `micDeviceId` is a **preference, not a promise**: a Chromium device id is per-origin and per-machine, so one that matches nothing falls back to the system default — see the Audio section.

## Storage

- `snips/{shareId}.png` — a still, written by a v4 signed URL from the renderer, read by a v4 signed URL through the image route. An **imported** still keeps its own type and extension (`.jpg`, `.webp`, `.gif`) from the `SNIP_IMPORT_TYPES` allowlist; every read and delete resolves `storagePath` off the document, so nothing downstream had to learn about it.
- `snips/{shareId}.webm` — a recording, written by a v4 signed URL **from the main process** (see below), read through the video route.
- `snips/{shareId}-poster.png` — a recording's poster frame. Derived from the id rather than given one of its own, so it shares the row's lifetime exactly and cannot be orphaned by a path that no longer matches.

Storage rules are never consulted on any leg; **these routes are the authorisation.**

**The object path carries no uid, deliberately.** It used to be `snips/{uid}/{shareId}.png`, and that leaked: a signed URL is a place a path becomes *visible* — an address bar, a referrer, a pasted link — so the owner's Firebase uid travelled with every image. `shareId` is already 160 bits of globally unique token, so the per-user folder bought nothing but that exposure. Ownership is enforced on the Firestore document (`ownerUid`), which is the only place it was ever checked.

Snips created before this change still carry the old path. Nothing needs migrating: **every read and delete resolves `storagePath` from the document** rather than rebuilding it from a uid, so both layouts work. The one place that did rebuild it was the account-deletion cascade's `bucket.deleteFiles({ prefix: 'snips/{uid}/' })`, which now calls `deleteAllSnipsForUser` instead — per-document, and correct for both layouts.

### The bucket needs a CORS policy, and without one nothing uploads

**This is a one-time infrastructure prerequisite, not a code setting**, and it is the first thing to check when an upload fails.

A signed `PUT` is a cross-origin request to `storage.googleapis.com`. `PUT` is never a "simple" CORS request, so the browser sends a **preflight `OPTIONS`** first — every single time, no matter what headers are on it. A bucket with no CORS policy has nothing to answer that preflight with, so the browser rejects the request before it leaves: `fetch` throws a bare `TypeError: Failed to fetch`, with no status and no body.

The policy lives in [`storage-cors.json`](../storage-cors.json) at the repo root — infrastructure, not application code, which is why it sits beside `firestore.rules` rather than under `src/`.

Apply it with [`src/scripts/set-storage-cors.js`](../src/scripts/set-storage-cors.js):

```bash
cd src && node scripts/set-storage-cors.js --info    # show current policy, write nothing
cd src && node scripts/set-storage-cors.js           # apply storage-cors.json
```

**Use the script, not `gcloud`.** Nothing in this team's toolchain installs the Cloud SDK — `gcloud` and `gsutil` are both absent on a normal dev machine here — so the CLI runbook is one nobody can follow. The script makes the same API call (`setCorsConfiguration`) with the Admin SDK service account the repo already carries, and reads the policy back afterwards rather than trusting the write: a policy that did not land looks exactly like one that did.

The equivalent CLI, for anyone who does have the SDK:

```bash
gcloud storage buckets update gs://bluu-backend.firebasestorage.app \
  --cors-file=storage-cors.json
```

**Applied to `gs://bluu-backend.firebasestorage.app` on 2026-09-19.** Before that the bucket had **no CORS policy at all**, so every signed-URL upload from a browser had always failed — snips were simply the first feature to exercise the path.

Three origins are allowed: `bluu-backend.vercel.app` (what the Electron shell is pinned to), `app.bluurock.com` (the public domain) and `localhost:3000` (dev). **Adding a domain to the app means adding it here too**, or uploads work everywhere except the new one.

`uploadSnip` translates that specific `TypeError` into a message naming CORS rather than passing "Failed to fetch" through, because it is a bucket misconfiguration that no retry will fix and the generic wording sends people looking at their network.

**The OnlyFans media upload ([`/api/onlyfans/media/upload-url`](../src/app/api/onlyfans/media/upload-url/route.ts)) depends on the same policy** — it is the same bucket, the same signed-`PUT` shape and the same preflight. It has no CORS documentation of its own, so if snips were the first thing to exercise this path, that upload was broken in exactly the same way and this fixes both.

**A recording's upload does not touch CORS at all**, and that is worth knowing when one fails. It is PUT by the **main process** over Node's `https`, which has no origin and sends no preflight — so a recording that will not upload is never the bucket policy, however much it looks like the same failure. Stills still go from the renderer and still depend on the policy above.

---

## The shape of it

```
 shortcut / tray / "New Snip"
            │
            ▼
   main: one TRANSPARENT surface per display  (snip.html)
            │  desktop stays live; cursor → crosshair
            │  user drags a rectangle
            ▼
   page clears its marks, waits 2 frames, commits
            │
            ▼
   main: hide surfaces → settle 120ms → desktopCapturer
            │                    ← the screen is photographed HERE
            ▼
   main: NativeImage.crop         ← only the selected pixels leave main
            │  snip:captured  {dataBase64, width, height}
            ▼
   renderer (SnipController)
            │  POST /api/snips/upload-url   → reserve id + sign slot
            │  PUT  <signed url>            → THE BYTES, direct to GCS
            │  POST /api/snips              → finalise
            ▼
   clipboard (via main) + toast + OS notification
```

And the recording path, which diverges at the commit and never rejoins until
the upload:

```
   page clears its marks, commits {rect, mode:'video', audio}
            │
            ▼
   main: hide surfaces → settle 120ms → DESTROY them
            │                    ← the user has their desktop back HERE
            ▼
   main: open snip-record.html   ← small, always-on-top, CONTENT-PROTECTED
            │                      placed outside the recorded rectangle
            │  snip:rec-start {rect, display, audio, limits}
            ▼
   recorder: getDisplayMedia()   ← main picks the source; the page names none
            │  + getUserMedia({audio}) if the mic was toggled on
            │  full display → <video> → canvas.drawImage(CROP) → captureStream(0)
            │  + audio mixed through one AudioContext when there are two sources
            │  MediaRecorder(vp9/opus) ─ ondataavailable every 2s
            ▼
   main: append each chunk to a TEMP FILE on disk
            │  (renderer memory never holds more than one chunk)
            ▼
   user presses Stop  →  snip:rec-done {durationMs, width, height}
            │  main flushes + closes the file, then hands the renderer a TOKEN
            ▼
   renderer (SnipController)
            │  OS notification: "Video recording uploading"   ← fires FIRST
            │  POST /api/snips/upload-url {kind:'video'} → id + 2 signed slots
            │  snip.uploadRecording(token, urls)
            │        └─ MAIN streams the temp file to GCS, then the poster
            │  POST /api/snips {id, width, height, durationMs} → finalise
            ▼
   clipboard (via main) + toast + OS notification (replaces the first)
```

### Nothing is drawn over the user's screen

The surface is a **fully transparent** window per display. The desktop stays live and visible, the cursor becomes a crosshair, and the only ink that ever appears is the rectangle being dragged plus its size readout. There is no scrim, no dimming, and no photograph of the desktop underneath.

A window still has to exist, and that is not a loophole — **no OS gives an application a global cursor change or global mouse capture without one.** What was removed is everything the window *displayed*. An earlier build froze the screen first and let the user select over a dimmed still; it was replaced because it looked like the app had hung.

### The cost: the capture is taken AFTER the selection

This is the one real trade, and it is worth stating plainly. With nothing frozen, the screen has to be photographed once the rectangle is gone — otherwise every capture is framed in its own blue border. So the order is: page clears its marks → waits two animation frames → commits → main hides the surfaces → waits `SNIP_SETTLE_MS` (120ms) → `desktopCapturer` → crop.

Two belts, because one is not enough: the page's frame wait covers *its* compositor, and the main-side settle covers the window actually leaving the screen (`win.hide()` returns immediately; `desktopCapturer` reads what the compositor has, not what Electron has been told).

The residue is a ~100ms window in which live content could change under the rectangle — a playing video captures a slightly later frame than the one aimed at. That is inherent to any non-freezing snipper, and it is the price of the surface being invisible.

**A capture failure here is silent from the user's side** — they drew a box and nothing happened — which is why main emits `snip:failed` and `SnipController` toasts it. Do not remove that channel.

`snip:failed` carries a **`reason`**, because the causes need different advice and a single "try again" is wrong for the most common one:

| `reason` | What happened | What the user is told |
|---|---|---|
| `permission` | macOS Screen Recording is not granted. `desktopCapturer` does **not** throw for this — it returns sources whose thumbnails are empty — so main checks `getMediaAccessStatus('screen')` up front. **Emitted on macOS only** | Name the permission, with an **Open Settings** action (`permissions.requestScreenAccess`). Retrying cannot fix it |
| `stream-refused` | `getDisplayMedia` was refused — by the `display-capture` permission gate, by our own display-media handler, or by an OS that produced no screen source. **This is what a non-macOS screen failure becomes**, because there is no permission behind it | "The screen could not be captured — this one is on us, not your settings." Explicitly **not** a permission message, and **no Open Settings button** |
| `no-activation` | `getDisplayMedia` was called without transient user activation (`InvalidStateError`) | Same message. Entirely our own plumbing — see the two gates below |
| `no-sources` | `desktopCapturer` returned nothing at all | "That screen could not be read" |
| `empty` | The thumbnail came back blank with permission granted — realistically a monitor unplugged or a resolution change inside the settle window | Same, plus "if you changed displays mid-capture, try again" |
| `crop` | The crop or the PNG encode threw | Generic retry |
| `unknown` | Anything else | Generic retry |

**Every branch logs.** The first version of this returned a bare `null` when `captureDisplay` could not produce an image, which is not an exception — so it skipped the `catch`, produced a user-visible toast, and left **nothing in the log to explain it**. A failure the user can see and nobody can diagnose is the worst of both; keep the `console.error` on the no-payload path.

### Why main crops and the renderer never sees the full screen

The surface reports a rectangle. Main takes the capture and crops it, then sends **only that region** down. A surface that received the whole capture and cropped it in the page would be a full-screen screen-reader running at a `file://` origin — which is why `snip-preload.js` has **no image channel at all**. Nothing can send that window a picture, so nothing can leak one through it.

### Why the renderer uploads and main does not

Main has no Firebase session. More importantly, the bytes must go **straight to Cloud Storage over a signed URL** rather than through a Vercel function (rule 9i) — a region capture is routinely 1–5 MB and base64 in a JSON body adds a third on top. Signing the slot needs an ID token, which lives in the renderer.

---

## Screen recording

The still path is finished the moment `desktopCapturer` returns. A recording is a **session**, and every decision below falls out of four constraints that pull against each other.

### The selection surfaces are destroyed, not hidden

They are full-screen and always-on-top. Leaving them up for the duration would mean the user cannot click the thing they are recording — which is the entire point of recording a region rather than photographing one. So the commit hides them, settles for the same `SNIP_SETTLE_MS`, destroys them, and opens a small control bar in their place.

The user reads that as *the bar changing*: the Image/Video toggle they were just using is replaced, at the same place on screen, by a timer and pause/stop/discard. It is in fact a different window with a different preload.

### The bar must not appear in the recording it controls

Two independent measures, because neither is sufficient alone:

1. **`win.setContentProtection(true)`.** On Windows 10 2004+ this excludes the window from screen capture entirely; on macOS it sets `NSWindowSharingNone`. On an older Windows it renders the window as a **black rectangle** in the capture rather than omitting it — which is why there is a second measure.
2. **`snipBarBounds` keeps it outside the recorded rectangle** whenever the geometry allows: under the selection if it fits, above it if not. It is centred on the *selection*, not on the display, because on an ultrawide the middle of the screen can be a foot from where the user is looking. When the selection leaves room for neither, the bar goes **inside** the rectangle — see below.

The bar is also `-webkit-app-region: drag` in its entirety, so a user whose selection genuinely fills the screen can move it off whatever it is covering. And it is shown with **`showInactive`**, not `show` — an always-on-top window that grabs focus as it appears eats the first keystroke of the take.

### When there is no room outside: the compact bar, bottom-left, inside the shot

**Everything is measured against `display.workArea`, never `display.bounds`.** That was a real bug: a full-screen recording fell through to "pinned to the bottom of the display", which on Windows is *behind the taskbar*. The bar is `alwaysOnTop` at `'screen-saver'` level — so is the taskbar, and the taskbar wins. The result was a recording the user could not stop, which is the worst failure this window has, because it keeps running. `displayWorkArea()` converts the work area into display-relative coordinates and every branch clamps to it.

Once the taskbar is excluded there is genuinely nowhere outside the rectangle to put a 380px bar on a full-screen selection, so the bar moves **inside** it, to the **bottom-left corner**, in a compact layout.

Inside is acceptable only because both reasons for staying outside survive it:

- **It still cannot appear in the capture.** `setContentProtection` is what actually excludes it, and that does not care where the window sits. Placement was always the belt, not the braces.
- **The courtesy reason is answered by the layout, not the position.** A 380px slab in the middle of a demo is in the way; a cornered, icon-only bar is roughly a sixth of the area, and the whole thing is still a drag handle so the user can move it.

**Bottom-left, not bottom-right.** The right-hand corner is where Windows notification toasts and the macOS notification stack appear — both always-on-top, both perfectly capable of covering the Stop button.

#### What compact drops, and where each thing went

| Dropped | Where the information went |
|---|---|
| The state label (`Recording` / `Paused`) | The state light, and the pause button, which reads Resume when paused |
| Button text (`Pause`, `Stop`) | The glyphs. Every button keeps its `aria-label`, so the keyboard and screen-reader paths are identical in both modes |
| The note row | **The duration**, which turns orange via `data-warn`. The note is the only element that can grow the bar *vertically*, which is exactly what must not happen inside the shot — so the one-minute cap warning moves onto the number that is already there |

What stays is the state light, the duration, and Pause / Stop / Discard as icons. The light stays because it is the one pixel that answers "is it still recording?" from across a desk, and it costs 9px.

**Button order is identical in both modes** (pause, stop, discard). Re-ordering between layouts would mean the muscle memory a user builds on one recording is wrong on the next.

#### The compact decision is made once, and must stay that way

`snipBarFitsOutside()` measures against **`SNIP_BAR_HEIGHT`**, not the bar's live height, and main latches the answer onto the session as `barCompact` before the window is created. This is load-bearing. The page measures its own layout and asks to be re-placed whenever a note changes its height; if the compact predicate moved with that height, a bar that only just fits would flip to compact, shrink, discover it now fits, expand, and oscillate for the length of the take.

Main owns the decision because **only main knows the work area** — the page has no idea where the taskbar is. It travels to the page in the `snip:rec-start` payload as `compact`, which is an existing main→renderer channel, so this needed no new preload surface.

### The stream never reaches remote content

This is the same rule that keeps the selection surface image-free, applied to video, and it is the reason the recorder is its own window rather than a module in `SnipController`.

The main window loads the **deployment** — remote content. Handing it a full-screen desktop stream would make any script running there a screen recorder. So the stream lives in a local `file://` page with `snip-record-preload.js` and nothing else: no session, no Firebase, no `electronAPI`, no navigation.

Three main-process guards hold that:

| Guard | What it does |
|---|---|
| `setDisplayMediaRequestHandler` | Resolves the requesting frame back to a window with `webContents.fromFrame` and **refuses anything that is not the live recorder**. It also picks the source itself, so the page never names a display and cannot choose a screen it was not sent there to record. |
| `setPermissionRequestHandler` / `…CheckHandler` | `recorderMediaAllowed`: the live recorder window and an in-flight session, or nothing. The desktop stream arrives as `'media'`, so `mediaTypes` refines it — **audio-only is allowed only when `snipRecording.audio.mic` is set**, so a window can open the microphone for the one take it was opened to make and no other. `surfaceMayListDevices` adds a *check-only* grant so the selection surface can read device labels. See the two gates below. |
| `snip-record-preload.js` | Chunks go **out**. There is no channel that sends this page anything. |

### The bytes: renderer → main → disk → GCS

Rule 9i's "never route bulk bytes through a function" is the obvious half. The less obvious half is that they must not sit in a **heap** either.

`ondataavailable` fires every two seconds; each chunk is handed to main as an ArrayBuffer and appended to a file **in the durable queue** (see below — not a temp file, which the OS may delete). On stop, main flushes and closes the file and gives the renderer a **token** — never a path. The renderer fetches a signed slot and calls `snip.uploadRecording`, and **main** streams the file to Cloud Storage. Four things fall out of that, and each is a reason for it:

- Renderer memory never holds more than one chunk of a ten-minute recording.
- The bytes never cross a Vercel function.
- A `file://` page never makes a cross-origin PUT (which would arrive as `Origin: null`).
- The renderer has no path, so it cannot be talked into naming one.

**This is the one place in the app where main uploads**, and the signed URL is still the capability — minted by an authenticated route against the caller's own page permission and quota. Main is not deciding anything beyond "send these bytes there", and `putFile` refuses a non-`https` URL so it cannot be turned into a general exfiltration primitive.

`ondataavailable` blobs are sent through a **promise chain**, not straight from the event: `Blob.arrayBuffer()` is async, so two chunks in quick succession can resolve out of order, and a WebM whose clusters arrive transposed is a file no player will open.

### Cropping is a canvas loop, and why

`getDisplayMedia` hands over a whole display; there is no crop constraint for a desktop stream. So the recorder draws the source rectangle of a `<video>` onto a canvas sized to the output and records `canvas.captureStream(0)`, calling `requestFrame()` per draw — manual frame capture, so the cadence is the loop's and not the display's refresh rate.

The scale from CSS pixels to stream pixels is derived from the stream's **actual** resolution against the display's CSS size, exactly as the still path derives it from the thumbnail's real size. Never from `scaleFactor` — a mixed-DPI setup is the case that breaks every other assumption.

### "Minimise size, keep quality" — the four levers actually used

| Lever | Setting | Why |
|---|---|---|
| Codec | VP9/Opus, falling back to VP8/Opus | ~30–40% smaller than VP8 at the same perceptual quality on screen content, whose sharp edges and flat fills are what its intra prediction is good at |
| Pixel ceiling | ~2.5MP (`MAX_OUTPUT_AREA`) | A full-screen Retina selection is 5MP+; encoding it natively doubles the bitrate for detail nobody sees down a share link. A **ceiling, never a default** — downscaling small sharp text is the one thing that genuinely hurts a screen recording |
| Bitrate | `pixels × 30 × 0.05`, clamped 0.5–5 Mbps | 0.05 bits per pixel per frame is generous for screen content (film wants 0.1+) and keeps 1080p30 near 3 Mbps rather than the 8 a naive default produces |
| Audio | Opus, 128k with system audio in the mix, 96k for voice alone | Above 96k Opus stops meaningfully improving on speech |

**Frame rate is deliberately not a lever.** Screen recordings are static with occasional fast scrolls — a modern codec spends almost nothing on a still frame, so dropping to 15fps buys little and makes every scroll look broken.

The container is fixed at `video/webm` by `SNIP_VIDEO_CONTENT_TYPE`, because the signed slot pins it into the signature and Storage rejects a PUT that disagrees. **Adding an MP4 candidate means moving that constant and the slot with it**, not just the recorder's list.

### The poster frame

A recording gets a second object, `{id}-poster.png`, uploaded in the same breath from a slot signed alongside the first. The library grid renders that, never a `<video>`: 24 media elements in a scrolling grid is 24 pipelines and 24 range-request storms for cells the user is only scanning.

It is taken at the **tenth drawn frame**, not the first — the selection surface has only just left the screen and frame zero is the one most likely to catch a ghost of our own UI.

A poster is **best-effort throughout**. If its PUT fails, `finalizeSnip` deletes `posterPath` from the row, `imageUrl` comes back `null`, and the card renders a quiet placeholder. Refusing to save a recording over its thumbnail would be the wrong trade in every case.

### Audio: system audio, a microphone, and one mixer between them

Two sources, and they are available on opposite platforms — which is the fact that shapes every control here.

| | macOS | Windows |
|---|---|---|
| **System audio** | no system-level loopback without a virtual audio driver | `audio: 'loopback'` from the display-media handler |
| **Microphone** | yes | yes |

So `SNIP_SYSTEM_AUDIO_SUPPORTED` is Windows-only and `SNIP_MIC_SUPPORTED` is both. A macOS user's recordings went from silent to narrated; a Windows user can now have both sources at once.

#### The mixer exists only when there are two sources

`MediaRecorder` encodes **one** audio track. Hand it two and it takes one and silently drops the other — which presents as "the microphone did not work". So when system audio and a microphone are both live they are summed through a single `AudioContext` into one `MediaStreamDestination`.

**The single-source paths deliberately do not go through the graph.** A lone track passed straight to the recorder keeps its native form, avoids a resample, and leaves the common case with nothing that can fail; an `AudioContext` that refuses to start would otherwise take down a recording that never needed one.

`audioBitsPerSecond` still branches on system audio, not on the microphone: 128k whenever the desktop's own output is in the mix, 96k for narration alone, which is where Opus stops improving on speech.

#### Echo cancellation is not optional on Windows

`getUserMedia` asks for `echoCancellation`, `noiseSuppression` and `autoGainControl`. The first earns its place specifically when system audio is on: the speakers are playing the very thing being recorded and the microphone hears it, so without cancellation the file carries an echo of the desktop audio half a beat late.

#### The device is a preference, never a promise

`micDeviceId` is a Chromium device id — **per-origin and per-machine**. The same account on a second laptop holds one that matches nothing. Two places handle that, and both are needed:

- the picker drops an unmatched id back to "System default" when it renders (`resolveSnipMicDevice`);
- the recorder asks for `deviceId: { exact: … }` and, on the `OverconstrainedError` that a since-unplugged device produces, **retries with the default and says so in the bar**. `exact` rather than a soft preference is deliberate: a soft constraint silently falls back, so a user recording from a specific interface would get the laptop lid microphone with no indication of it.

#### The microphone is released explicitly

Its tracks are not part of `displayStream`, so `stopTracks` stops them by hand and closes the `AudioContext`. A track left open keeps the OS recording indicator lit — an orange dot in the macOS menu bar — long after the take finished, which reads as the app still listening.

### Detecting, prompting and guiding: where each one happens, and why not elsewhere

This is the part that is easy to get wrong, and the shape is forced by two facts that have nothing to do with each other.

**Fact one: macOS stops prompting once it has been told no.** `systemPreferences.askForMediaAccess` resolves with the *existing* status and shows **no alert** after access has been refused. A UI with a single "Allow microphone" button therefore does nothing at all for exactly the users who need it — no dialog, no error, no explanation. That is why `SnipMicPermission` carries all five OS values rather than a boolean, and why the status read (`permissions:microphoneStatus`) is a separate call from the request.

**Fact two: the selection surface cannot survive taking focus.** It is full-screen and always-on-top, and on a single-display setup `armSnipOverlays` cancels the snip on blur. Anything that raises a window — a TCC prompt, the Settings app — destroys the surface it was called from.

Those two together decide the whole layout:

| | Detect | Prompt | Guide |
|---|---|---|---|
| **Selection surface** (`snip.html`) | yes — status on open, re-read whenever the chip is touched | **never** | note per status; an Open Settings button that **cancels the snip** as it hands off |
| **`startSnipRecording`** (main) | yes | **yes** — macOS, `not-determined` only | passes `micNote` to the bar when access was refused |
| **Settings card** (`SnipMicrophoneField`) | yes — and **re-reads on window focus** | yes | Allow / Open settings, chosen from the status |

Three consequences worth stating flatly:

- **`snip-preload.js` has no `requestMic`, and that omission is load-bearing.** The prompt happens in `startSnipRecording`, *after* the surfaces are destroyed — which is also the only point at which it can be raised without the dialog landing inside the recording.
- **The surface's Open Settings button cancels the snip on purpose.** The Settings window would otherwise be underneath a full-screen overlay and unreachable. On one display the blur would tear it down anyway; doing it explicitly makes the behaviour identical on two, where it would not be. The note says so *before* the click, because the surface is gone immediately after it.
- **A refused microphone never costs the recording.** `startSnipRecording` drops the microphone, records anyway and sends a note the bar shows for the length of the take. Refusing to capture the screen because a microphone was unavailable would be the same bad trade the system-audio path already declines to make.

**"Open Settings" is offered on both platforms here**, which is the exact inverse of the screen-capture rule below — Windows has no per-app Screen Recording permission, but it very much has a microphone one (`ms-settings:privacy-microphone`, one global switch for all win32 apps). Do not copy the macOS-only guard from that path onto this one.

### The surface may read device labels, and nothing else

The picker has to list real device names before the drag — a dropdown reading "Microphone 1 / Microphone 2" is one nobody can use — and Chromium withholds `enumerateDevices` labels from a context whose microphone permission is not granted.

`surfaceMayListDevices` is the narrowest way to give it those names: it is wired into `setPermissionCheckHandler` **only**, so `getUserMedia` from the surface is still refused by the request handler. Four properties contain what is left, and they are why this is acceptable on a window that watches the whole screen:

- it is a **local `file://` page we ship**, not remote content;
- its CSP is `default-src 'none'` with **no `connect-src`** — nothing it could capture has anywhere to go;
- `snip-preload.js` has no media channel and no file channel, so nothing reaches main either;
- navigation away from `snip.html` is blocked.

It is scoped in time and intent as well: only while a surface is on screen, and only when the user has the microphone toggle on.

**That intent scoping reads main's own `snipConfig.micEnabled`, which makes the write ordering load-bearing.** `snip:audio-prefs` is therefore an `invoke`/`handle` pair, not a `send`, and the surface **awaits `persist()` before it enumerates**. Getting this backwards shipped a real bug: toggling the microphone off and back on reported *"No microphone was found"* on a machine with a working one, because the enumeration ran against a main process that still believed the toggle was off. Chromium's behaviour is what made it hard to see — a context without microphone permission is handed a **full set of `audioinput` entries whose `deviceId` and `label` are both empty strings**, not an empty list, so filtering on `deviceId` silently produced "no devices". It only reproduced on a re-enable, because a surface opened with the microphone already on had `snipConfig.micEnabled` set from `snip:configure` at launch.

Two defences now, and the second is what keeps a regression diagnosable:

- **Order:** `await persist()` → `refreshMic()`. Do not reorder them; the comment at that call site says so.
- **Evidence:** `refreshDevices` counts `audioinput` entries **before** filtering on `deviceId`. Entries present with every id blank means the permission was refused, not that the hardware is absent — that sets `micDevicesBlocked`, logs it, and says *"The microphone list could not be read. Recording will still use your default microphone."* rather than sending the user to check a cable for a fault that is ours. Enumeration is also skipped entirely while the toggle is off, so the gate working as designed never logs as a failure.

**`recorderMediaAllowed` now allows audio-only, but only for a session that asked for narration** (`snipRecording.audio.mic`). Simply dropping the old blanket refusal would have been too wide — it would give the recorder window a standing microphone capability for every take, including silent ones. A window may open the microphone only for the one recording it was opened to make.

### macOS needs two things, and neither ships without the other

- `com.apple.security.device.audio-input` in **both** `entitlements.mac.plist` and `entitlements.mac.inherit.plist` (the helper processes are where `getUserMedia` actually runs).
- `NSMicrophoneUsageDescription` in `mac.extendInfo` — a block that did not exist before this change.

**A missing usage string is not a refusal: TCC terminates the process** the moment the microphone is requested. Treat the two as one change.

### Two gates stand in front of `getDisplayMedia`, and both failed silently

Neither of these is obvious from reading `setDisplayMediaRequestHandler`, and
each one produced a recording that failed with **nothing in the log at all**.
They are written down because the next person to touch this will otherwise
spend the same afternoon on them.

**1. Screen capture is a *permission* first, and it arrives as `'media'`.**
`getDisplayMedia` asks `setPermissionRequestHandler` *before* Chromium ever
consults the display-media handler. This app denies every permission but an
allowlisted few, so the call was rejected with `NotAllowedError` while every
`console.error` branch in the handler below sat unreached.

**The permission string is `'media'`, not `'display-capture'`.** That is worth
stating flatly because guessing `display-capture` costs a whole debugging round:
the API has that permission and `recorderMediaAllowed` accepts it, but this
build does not ask for it — verified from a real failure log reading
`permission 'media' denied` on a screen capture. Gating screen capture on
`display-capture` alone blocks every recording.

So both of the recorder's calls arrive as `'media'`, and **`mediaTypes` is the
discriminator**:

| Call | `mediaTypes` | Rule |
|---|---|---|
| `getDisplayMedia`, video only | `['video']` | allow |
| `getDisplayMedia` + system audio | `['video','audio']` | allow |
| the microphone, narration requested | `['audio']` | allow |
| anything audio-only, narration NOT requested | `['audio']` | **refuse** |

Audio-only is allowed only for a session that committed to narration
(`snipRecording.audio.mic`, set by main from the committed selection and cleared
outright when the OS has denied access). Dropping the refusal entirely would
give the recorder a standing microphone capability on every take. A request carrying video is a
display capture: the
recorder page never asks for a camera, and the source is still chosen by main,
so granting the permission grants no particular screen. Everything outside the
live recorder window is refused either way.

A refusal of `media` or `display-capture` now logs **with its `mediaTypes`**.
The first version omitted them, which turned a one-line diagnosis ("it asked
for video and we only allowed audio") into several rounds of guessing — never
log the permission without them.

**2. `getDisplayMedia` requires transient user activation.** The recorder window
is opened by main and shown with `showInactive`, so nothing has ever been
clicked in it. The user *did* gesture — they dragged a rectangle — but that
happened in a window that has since been destroyed, and activation does not
travel between windows. Calling it straight out of the `snip:rec-start` message
therefore throws `InvalidStateError`. Main instead invokes
`window.__snipBeginCapture()` through
`webContents.executeJavaScript(code, /* userGesture */ true)`, which synthesises
the activation. The page keeps a 400ms fallback behind a latch, so a shell where
that never lands still starts rather than sitting at "Starting" forever.

### "Open Settings" only exists on macOS, and that is load-bearing

**Windows has no per-app Screen Recording permission.** There is no setting to
turn on, no page to open, and nothing to grant. `permissions:requestScreenAccess`
reflects that: on macOS it opens System Settings at Screen Recording, and off
macOS it runs a 1x1 `getSources()` call and returns `success: true` having shown
the user absolutely nothing.

So an **"Open Settings" button on Windows is a button that does nothing**, and a
user who presses it concludes the app is broken — which is worse than not
offering it. Two things keep that from happening, and both are needed:

1. **Main rewrites the reason.** A `screen-permission` from the recorder on a
   non-macOS platform becomes `stream-refused` in `snip:rec-failed`, because on
   Windows that rejection cannot mean what the name says.
2. **`SnipController` guards the action on `isMac()`.** The second belt, for any
   path that reaches the permission toast another way.

The reason main has to correct this at all is that **the page cannot tell the
two cases apart**: an empty grant from our own handler (`callback({})`) rejects
`getDisplayMedia` with exactly the same `NotAllowedError` as a genuine OS
denial. Main knows which it was, so main decides — the handler stamps
`snipRecording.denied` (`stream-refused` / `no-sources`) at the point it
refuses, and the relay prefers that over whatever the renderer guessed. Every
refusal branch also logs, for the same reason the still path's does: a failure
the user can see and nobody can diagnose is the worst of both.

### Permissions are checked BEFORE the recording, not during it

**A permission prompt that appears once recording has started is a prompt that ends up in the recording**, and a user who only discovers a refusal afterwards has lost the take. With narration cut there is one permission left, and it is checked up front:

**Screen Recording** is checked for a recording exactly as it is for a still — `getMediaAccessStatus('screen')`, before the recorder window is even opened — because `getDisplayMedia` does not throw when macOS has not granted it, it hands back empty frames. Windows has no equivalent permission at all, which is what the "Open Settings" section above is about.

### The recorded region is outlined, and the outline is click-through

The selection surfaces are **destroyed** when recording starts, so without something taking their place the user is recording blind — nothing on screen says which part of the display is live. `snip-frame.html` is that something: one window per recording, holding a border and nothing else. No script, no preload, no IPC.

Two properties make it safe to leave on screen for ten minutes, and both are load-bearing:

**It cannot be clicked.** `setIgnoreMouseEvents(true)` with no forwarding, because nothing in it is interactive. Every click, drag and scroll inside the recorded region goes straight through to whatever the user is demonstrating — a frame that ate clicks would make the region it marks unusable, which is the opposite of the point. It is `focusable: false` too, so it never takes the keyboard from the app the user went back to.

**It is outside the crop, by construction.** Main sizes the window to the rectangle grown by `SNIP_FRAME_PX` (3px) on every side, and the page draws its ring in exactly that margin. The border is not in the recording because it is not over it; `setContentProtection` is the second belt, not the first. **Change the ring's thickness in the HTML and `SNIP_FRAME_PX` has to move with it**, or the border starts appearing in captures.

It is **red where the selection rectangle is blue**, and that is a distinction rather than a second accent: blue meant "you are choosing a region", red means "this region is live". Same hue as the control bar's state light, so the two read as one signal. It goes grey while paused — the region is still reserved, but nothing is being captured. The frame has no script, so main mirrors that state onto it with `executeJavaScript` from `snip:rec-state`.

### The control bar is click-through except for the bar itself

A transparent window still swallows clicks on its transparent pixels. Left alone, the control bar's shadow margin and the transparent wedges outside its rounded corners would be invisible dead zones sitting on the user's desktop, eating clicks on the very thing being recorded.

So the window is created with `setIgnoreMouseEvents(true, { forward: true })` and becomes clickable **only while the cursor is actually over the bar**. `forward` is what makes that recoverable: mouse *move* events still reach the page while clicks pass through, so `mouseenter`/`mouseleave` on `#bar` can hand interactivity back and take it away again through `snip:rec-interactive`.

Two details that are easy to get wrong:

- **Forwarding stays on in both states.** Dropping it while interactive would mean the page never sees the pointer leave, and the bar would swallow clicks for the rest of the recording.
- **The listeners are on `#bar`, not `document`.** The document fills the window, so listening there would re-enable exactly the dead zones this exists to remove.

### Limits and how they end

`MAX_SNIP_RECORDING_MS` is **10 minutes**, counted down in the bar with a warning at one minute. At the cap the recorder **stops and keeps** what it has — discarding at the limit would throw away ten minutes of someone's work to enforce a number they never saw. The display's track ending (a monitor unplugged, the OS revoking the share) does the same thing for the same reason.

`MAX_SNIP_VIDEO_BYTES` is 400 MB, derived from that duration at the bitrate ceiling plus headroom — the two move together. The still ceiling (`MAX_SNIP_BYTES`, 25 MB) is unchanged and the two are checked separately: a screenshot claiming 40 MB is not a screenshot, while a ten-minute recording legitimately is.

The session ends in exactly one of three ways — uploaded, discarded, or failed — and **every one of them runs `clearSnipRecording`**, which is the only thing that removes the temp file. A recorder window that dies without any of them (`'closed'`) is treated as a failure, for the same reason.

### The upload is durable: a failed one is never a lost recording

**This is the difference between a screenshot and a recording, and the whole reason the upload path is shaped the way it is.** A failed screenshot costs a second — the thing being captured is still on screen. A failed ten-minute recording costs the take: the demo has finished, the bug no longer reproduces, the moment is gone. So a recording is never held anywhere it can evaporate, and the only thing that deletes one is a successful upload or the user asking.

#### The queue is a directory, not a Map

`userData/pending-recordings/` holds, per recording, the `.webm`, its `.png` poster, and a `.json` sidecar (`createdAt`, `durationMs`, dimensions, `attempts`, `lastError`, `state`). Three properties, each deliberate:

- **`userData`, not `os.tmpdir()`.** A temp directory is one the OS is entitled to empty, and on Windows it routinely does. A queued recording has to survive a reboot.
- **Written straight into the queue**, not moved there on completion — a crash mid-recording leaves a playable partial rather than nothing.
- **The in-memory Map is an index**, rebuilt from disk by `loadSnipQueue()` at startup. Disk is the source of truth. A `.webm` whose sidecar is missing or corrupt is still listed, with zeroed duration and dimensions: the metadata is a convenience, the recording is the thing, and deleting someone's work over an unreadable JSON file would be absurd.

`SNIP_QUEUE_TTL_MS` is **14 days** and there is a 4 GB size cap. Both are floors on "we will not fill your disk forever", not deadlines the user is expected to race — this replaced a 30-minute reaper that deleted exactly the work the queue now protects.

**The queue is not cleared when the window closes.** It used to be, which was precisely backwards: quitting the app is the single most likely moment for an upload to be cut short.

#### Video uploads are resumable sessions, not one PUT

A plain `PUT` of 300 MB is one indivisible request — interrupt it at 95% and every byte goes again. On a connection bad enough to drop it once, that is a loop that may never terminate. So `createSnipUploadSlot` signs video with `action: 'resumable'` and main drives the three-step protocol:

1. **POST the initiation URL** with `x-goog-resumable: start`. That header is part of the v4 signature (`extensionHeaders`), so a POST without it is a signature mismatch, not a missing option. The bucket replies `201` with a session URI in `Location`.
2. **PUT 8 MiB chunks** with `Content-Range: bytes a-b/total`. Chunk size must be a multiple of 256 KiB — GCS rejects anything else. A `308` means "stored, continue" and carries a `Range` header saying what the bucket *actually* holds, which is the offset we continue from rather than trusting our own arithmetic.
3. **On a transient failure, probe and continue.** `PUT` with `Content-Range: bytes */total` and an empty body asks the bucket where it got to. This is what turns a dropped connection into a few seconds lost rather than the whole file — and it also catches the case where the body arrived but the response did not, so the chunk is already stored.

`onProgress` reports bytes **confirmed by the bucket**, never bytes written to the socket: a chunk in flight when the connection died was not stored, and a progress bar counting it would run backwards.

The poster stays a simple signed `PUT` with retries. A resumable session for 80 KB is pure overhead.

#### What is retried, and what is not

`isRetryableUploadFailure` is narrow on purpose. Transport failures (`status 0`), `408`, `429` and every `5xx` are transient. **Every other `4xx` is not** — a bad signature, an expired session, a refused size are all things the server is telling us a retry cannot change, and hammering them burns a user's upload allowance to arrive at the same refusal. Five attempts with exponential backoff (1s → 30s, jittered).

Retries happen at three levels, and they are separate mechanisms:

| Level | Where | Covers |
|---|---|---|
| Within a chunk | `uploadRecordingResumable` | A blip: back off, probe the offset, carry on |
| Within a session | 5 attempts per chunk | A minute of bad network |
| Across sessions | `drainQueue` in `SnipController` | A crash, a quit, a reboot, being offline for a day |

`drainQueue` runs 4 seconds after mount (so it is not competing with a sign-in or a fresh capture), on the `online` event, and when the page asks via `bluu:snip-retry-uploads`. It is **one at a time, oldest first**, sharing `uploadingRef` with the live capture path — three hundred-megabyte uploads in parallel would starve each other and make every one of them likelier to time out.

**"Quiet" now means the clipboard as well as the toast**, which is what it always claimed and never did. `announce(snip, toastId, { interactive })` splits the two cases:

| | Clipboard | In-app toast | OS notification | `bluu:snip-created` |
|---|---|---|---|---|
| A capture the user just took, or a **user-pressed** Retry (`interactive`) | written | yes | yes | yes |
| The **automatic** drain (mount, `online`) | **untouched** | **none** | yes | yes |

The automatic pass used to fall through to a full announce — opening a loading toast and calling `copyText` — so every app launch and every wifi reconnect with a queued recording silently replaced whatever the user had on their clipboard, for an upload they did not ask for and are not waiting on. The OS notification stays on both paths, because the user does still need to learn the recording finally landed; it is the only feedback that reaches a window nobody is looking at.

**Each retry requests a fresh slot.** The reservation from a failed attempt is left to the daily cron's abandoned-reservation sweep, which is exactly what that sweep is for. The consequence worth knowing: resumability is *within* an attempt, not across app restarts — a recording interrupted by a crash restarts its upload, it does not continue it. Continuing would mean persisting the session URI and keeping the reservation alive past `PENDING_UPLOAD_TTL_MS`, which would weaken the sweep for a case the local file already covers.

#### The one thing that does delete a recording

A **refused reservation** — quota, size, a revoked page permission. That recording has nowhere it could ever go, and keeping it would grow a queue of files that can never upload. A failed *transfer* always keeps its file. `uploadSnipRecording` observes exactly that distinction: it discards on a `!slotRes.ok`, and never on a failed `uploadRecording`.

#### The page says so

[`PendingUploads`](../src/app/(main)/applications/snipping-tool/_components/PendingUploads.tsx) sits **above** the library grid and renders nothing when the queue is empty, which is almost always. It is a state to resolve, not a row to browse.

Each row shows duration, size, dimensions, when it was recorded, and **the real error** — the person reading it is deciding between retrying and saving a copy, and "something went wrong" does not help them choose. The timestamp is formatted in the **viewer's timezone**, from the `timezone` prop the page passes down; it used to fall back to `toISOString()` past a day, which is a UTC calendar date on a panel sitting directly above cards rendered in the viewer's zone.

**The header counts each state separately, and the panel is only orange when something actually failed.** This was a real defect: the headline tested "does *any* item say failed?" and then printed the count of *all* items beside the words "did not upload". One stale failed recording therefore relabelled every row in the panel — including a recording that was uploading successfully at that moment — so a working upload looked broken, and the obvious reading was that the *current* upload had failed. It now reads `1 recording did not upload · 1 uploading`, and each row states its own status (`Did not upload — <error>` / `Uploading — 42%` / `Waiting to upload`) so a row is legible without the header.

Two things follow from that and are worth keeping:

- **A failed entry persists on its own.** `loadSnipQueue()` rebuilds the map from disk at startup and `snipQueueSnapshot()` filters nothing, so a failure from a previous session is listed the moment the page mounts — it does not need another upload to bring it into view. If it only *appeared* alongside one, that was the miscount above, not the queue.
- **`state` is the discriminator, never `lastError`.** Nothing resets a `failed` entry to `pending`; the next attempt moves it straight to `uploading` and clears `lastError`. So `state === 'failed'` is reliable, and a row's `createdAt` is what tells a user whether they are looking at today's recording or last week's.

**Retry is one control, in the panel header, and it retries the whole queue** — `bluu:snip-retry-uploads`, which `SnipController` answers because it owns the one-at-a-time upload lock, so the panel asks rather than uploading itself. There is deliberately no per-row retry: the drain is sequential and oldest-first, so a per-row button could not honour "this one first" without breaking that ordering. *(This paragraph previously described three per-row actions including Retry; that was never what the component did.)*

Each row then carries two actions of its own: **Save a copy** (`snip:savePendingRecording` → native dialog → `copyFile`; deliberately does *not* clear the queue entry, because wanting a copy and abandoning the upload are different intentions), and **Delete** behind a confirm, since that file is the only copy. The confirm's action is `variant="destructive"` — the default resolves `--primary` to near-white in this app, which would give it the same weight as Cancel on the one dialog that destroys the last copy of something.

It is **orange, not red**. Nothing is lost — the file is on the machine and the action is a retry. Red would say destroyed.

### The upload announces itself

The still path uploads in a second or two and says nothing until it is done. A recording is tens of megabytes and can take a minute — during which the control bar has vanished, the app window is behind whatever the user went back to, and nothing on screen says anything is happening.

So `handleRecorded` fires an OS notification, **"Video recording uploading"**, before the first byte moves, and the completion notification **reuses the same id** so it replaces that one in the notification centre rather than leaving "uploading" sitting beside "done". A failure gets one too, for exactly the same reason the start does: a toast on a window nobody is looking at is a failure the user never learns about.

Like the still path's, these deliberately ignore `notificationPreferences.desktopEnabled` — see the gotcha below.

### The kind is decided at reservation and never re-read from the finalise call

`POST /api/snips/upload-url` takes `kind` and, from it, pins the content type into the signature, chooses the object's extension, picks the byte ceiling, and decides whether a poster slot is signed. `finalizeSnip` then reads the kind back **off the reservation**, never off its own request body — otherwise a finalise call could relabel a PNG as a recording, or the reverse, over an object it did not write.

### Narration has its own version floor — and it is the ONLY thing in its release that needs one

`SNIP_MIC_MIN_APP_VERSION` (`0.15.0`) is a **third** floor, for the same reason the second is not a bump of the first: raising `SNIP_VIDEO_MIN_APP_VERSION` would take screen recording away from a user on 0.14.x in order to withhold an audio source they never had.

**What is gated, and what deliberately is not.** Five things shipped in 0.15.0 and only one of them can be gated honestly:

| Feature | Needs a build? | Why |
|---|---|---|
| **Microphone narration** | **yes — floored** | The toggle and picker are drawn by `snip.html` from flags main supplies, the permission status comes over IPC, and macOS needs an entitlement plus an Info.plist string that only a signed build carries |
| Auto-copy to clipboard | no | Renderer-side setting, read by `SnipController` |
| Title + description | no | Firestore field, API route, React dialog |
| Import | no | Browser → signed URL → finalise; no IPC on the path at all |
| The public player | no | `/s/[shareId]` has no Electron anywhere near it |
| The two sound effects | no — **and left ungated on purpose** | No UI to gate, and they degrade to something rather than nothing: the shutter falls back to `snip:captured` (the same capture, a PNG encode later) and the recording cue is simply absent. A version notice about a sound would be a notice about a thing the user cannot miss |

Gating the other four would withhold working features to enforce a version that has nothing to do with them — which is the same mistake as folding the video floor into the page floor.

**Enforced in two places, like the others.** The library page renders one line when `canRecord && !canNarrate` — mutually exclusive with the video line, so the header never carries two version notices — and [`SnipMicrophoneField`](../src/app/(main)/applications/snipping-tool/_components/SnipMicrophoneField.tsx) checks the floor itself, because it is mounted in the settings popover rather than by the page. Its `permissions.microphoneStatus` feature detection is the second belt.

### Video mode has its own version floor

`SNIP_VIDEO_MIN_APP_VERSION` (`0.14.0`) is a **second** floor, not a bump of `SNIPPING_TOOL_MIN_APP_VERSION`. Raising the page floor would lock a user on 0.13.x out of the library they already have — their snips, their links, their settings — to withhold a mode they never had. Instead the page floor stays where it is, an older shell simply never draws the Image/Video toggle (the `video` flag into `snip.html` comes from main, which either has the recorder or does not), and the library page says one line about it.

---

### Compatibility runs in BOTH directions, and each needs its own gate

Recording is entirely main-process work, so **it cannot arrive by a Vercel deploy** — 0.14.0 is a required build (rule 14, the two-push dance). What makes this subsystem awkward is that the two halves update independently, so there are two skew cases and they need opposite defences.

| Skew | Gate | What it prevents |
|---|---|---|
| **New web code, old shell** (0.13.x) — the normal state between the Vercel deploy and the build landing | `SNIP_VIDEO_MIN_APP_VERSION` + every new bridge call being optional | A library page offering a mode whose IPC does not exist |
| **New shell, old renderer** — a page bundle weeks older than the app around it (rule 9c) | `supportsRecording` in `snip:configure` | A user records for two minutes, presses Stop, and **nothing happens** — no upload, no error, and a temp file nobody collects |

The second one is the easier to miss, because the instinct is to treat the shell as the newer half. It is capability negotiation rather than a version check: main cannot read the renderer's version, so the renderer declares `supportsRecording: typeof api.onRecorded === 'function'` and **main draws the Video toggle only when that is true**. An old bundle therefore gets the 0.13.0 experience exactly — Image only — inside a shell that is perfectly capable of recording.

**What a 0.13.x shell does with the new web code**, path by path:

- `snip.configure` receives `systemAudioEnabled` and `supportsRecording` and ignores both — the old handler reads named fields, not the whole object.
- Its `snip.html` is the old one, so there is no mode bar and `snip:region` carries a bare rect. The new main handler still accepts that shape (`commit.rect ? commit.rect : commit`), which is why the two sides cannot drift apart.
- `uploadSnip` posts no `kind`, so `resolveSnipKind(undefined)` → `'image'` and the slot is signed as a PNG with the 25 MB ceiling.
- It posts no `durationMs` either; `finalizeSnip` computes `duration` only for `kind === 'video'`, so the `NaN` never reaches a document.
- `onRecorded`, `uploadRecording`, `discardRecording` and `onAudioPrefs` are absent. Every call site is optional-chained or behind an early return — **and `?.()` on a missing method yields `undefined`, so the two `discardRecording` calls wrap it in `Promise.resolve(...)` before `.catch`**, which would otherwise be a `TypeError` rather than a no-op.

**Old rows need no migration.** `kind` is absent on every snip taken before this, and `resolveSnipKind` defaults it to `'image'` on read rather than anything backfilling it — there are live share links pointing at those rows.

**A finished recording is reaped if nobody collects it.** `SNIP_FINISHED_TTL_MS` (30 minutes) deletes the temp file of a recording that was never uploaded or discarded. Nothing should ever reach it; it exists because every way that does — a renderer that crashes mid-upload, a navigation that tears the listener down, an old bundle with no handler — otherwise leaves hundreds of megabytes in the user's temp directory forever. It is generous on purpose: it races a real upload, and reaping a file mid-PUT would turn a slow success into a failure. Claiming a token (`releaseFinishedRecording`) cancels the timer, so a slow upload cannot be shot in the back by its own reaper.

---

## Auto-copy: the clipboard is a setting now

The link going on the clipboard the moment an upload lands is the tool's whole deliverable for most captures — the snip is taken *in order* to be pasted a second later — so it stays **on by default** (`autoCopyEnabled`, absent reads as on, the normal `!== false` rule).

It is a setting for the user who keeps something else on their clipboard while they work and does not want a capture quietly replacing it. Turning it off changes nothing about the upload: the snip is stored, the link exists, and the card's link button still copies it.

Three things to keep straight, because they are three different questions:

| | Writes the clipboard? |
|---|---|
| A capture the user just took, auto-copy **on** | yes |
| A capture the user just took, auto-copy **off** | no — the toast says where the link is instead, and does not read like a failure |
| The **background drain** (mount, `online`) | **never**, regardless of the setting |

The drain's rule predates this and is unchanged: an upload the user did not ask for must not take their clipboard either way. The setting only narrows the interactive case further.

**`SnipController` reads it through a ref, not a closure.** `announce` is a dependency of both upload handlers and of the drain, and those are dependencies of the effect that subscribes to main's channels — where `removeCapturedListeners` is a `removeAllListeners`. A setting the user can flip must not sit in that chain, or toggling it tears the capture listener out and re-registers it.

**The OS notification says `Upload Complete` and nothing else.** It used to branch its *title* on whether the clipboard write landed, which made the system toast a second, competing account of what had happened — and with auto-copy off that account was simply wrong. The one thing always true at that point is that the upload finished; the body line carries the rest.

---

## Title and description

A capture completes without asking the user anything — that is the point of the tool — so there is no moment at which a name could be requested. Both fields are therefore written **after the fact**, from the library card, through `PATCH /api/snips/{snipId}` → `updateSnipDetails`.

**Both are shown on the public page, and the dialog says so.** That is the reason for writing one: a shared link carrying "Checkout crash on step 3" above it is a link the recipient can act on without a covering message. It does also mean this is the one route by which a user can put arbitrary text on an unauthenticated page — it is their own text on their own snip, it is normalised and length-capped **server-side** (`normaliseSnipTitle` / `normaliseSnipDescription`, not the dialog's copy of them), and both render as text nodes.

- A titled snip's title becomes the public page's **visible `<h1>`**. An untitled one keeps the `sr-only` heading exactly as before — a generated "Shared recording" drawn above every capture would be chrome that says nothing.
- An emptied field is **deleted, not set to null**, the same convention `expiresAt` follows.
- The route forwards only the keys the caller actually sent, so a request naming a title cannot silently clear a description it never mentioned.
- The page applies the **server's** returned row, never its own draft: a title of three spaces has to come back absent rather than sit in the grid as a saved value.
- `SnipCard` uses the title as the row's name in every `aria-label`, falling back to the timestamp — otherwise a screen reader's action list is three buttons called "Copy the link to Untitled".

## Import

An image the user already has, given everything a capture gets: a 160-bit share token, a public page, their retention window, the quota, a card. That is the point of the feature — the *link*, not the file — and it is why an import goes through the **same** reservation rather than a second kind of row. Nothing downstream needed to learn about it.

Two things travel in leg one that a capture never sends: `source: 'import'` (which the card's badge reads back) and `contentType`.

- **The content type is an allowlist lookup, never a passthrough.** `SNIP_IMPORT_TYPES` is PNG / JPEG / WebP / GIF. The v4 signature pins whatever it is told and the public image route 302s a browser straight at the object, so a free-text value here would be a way to have us sign a slot for `text/html` on our own bucket. **Deliberately no SVG** for the same reason: an SVG is a script-bearing document served from a `storage.googleapis.com` origin.
- **Dimensions are read in the browser** (`readImageSize`, `createImageBitmap` with an `<img>` fallback), because nothing downstream can — the server never sees the bytes, and probing the object would mean pulling it back through a function. A file that will not decode is **refused** rather than finalised with zeros: `width`/`height` are what reserve the picture's shape on the public page.
- **The filename becomes the title**, passed to `finalizeSnip` and normalised there. The file already has a name and it is the only thing about the snip the user has written.
- **Stills only.** A recording carries a durable on-disk queue, a poster frame and a resumable session, none of which mean anything for a file already on disk — and a video import would have to answer "how long is it?" with no recorder's wall clock to ask.
- The badge is the **attribute chip** recipe (greyscale, `rounded-md`, DESIGN.md §5) — an attribute the row carries, not a state it is in. It answers the one question a mixed grid raises and nothing more, which is also why `source` is **not** in the public projection: how a file reached the library is the owner's business.

## The two sounds

`image_capture.wav` at the shutter, `recording_start.wav` as a recording begins. Both live in `src/public/` and both are played by the **renderer** ([`snipSounds.ts`](../src/lib/snipSounds.ts)) — main has no audio output, and the alternatives are a spawned process per shutter.

**The timing is the whole feature, and it is why each has its own main→renderer event rather than reusing one that already existed.**

| Event | Emitted | Why there and not later |
|---|---|---|
| `snip:shutter` | the instant `desktopCapturer` returns, **before** the crop and the PNG encode | A large capture spends 100ms+ in `toPNG()` plus base64. A shutter after that reads as lag rather than as confirmation — and `snip:captured`, the obvious hook, is on the far side of it |
| `snip:rec-started` | **before the recorder window is even opened** | On Windows a recording can be taking the desktop's own output by loopback. A cue played once `MediaRecorder` is running is the first thing on the recording's soundtrack. Window creation plus `getDisplayMedia` is several hundred ms of head start |

**The shutter degrades, and the latch is how.** A shell older than 0.14.2 has no `snip:shutter` channel (rule 9c cuts both ways), so `SnipController` falls back to playing on `snip:captured` — late, but present. `shutterHeardRef` stops the two firing together on a shell that does have it, and `onFailed` clears the latch so a capture that shuttered and then failed to crop does not silence the next one.

Failure is silent by design: autoplay policy, a muted device, a missing asset. None is worth a toast over a capture that is working.

---

## The share token

A snip's token is its **document id**, unlike the prompt library, where `prompt-shares/{token} → promptId` is a second index doc. The difference is deliberate:

- A prompt exists before it is shared and is addressed by its own id in internal URLs, so its token has to be a separate, later-minted secret.
- A snip is *born* shared. Nothing addresses it by any other id and no internal surface prints one, so a separate index would be one more document and one more read per public view, for nothing.

**The consequence: a snip id is a secret.** Never log one, never put one in an error message, and never return one from a route that has not established the caller is the owner.

**That includes the UI.** Both copy paths (`SnipController.announce` and the library page's `copyLink`) used to put the full `shareUrl` in the success toast's description. This is a *screenshot tool*: a token rendered on screen for several seconds is a token that ends up inside somebody's next capture or screen share. Both now show the **expiry** instead — which is the fact the user needs at the moment they are about to hand the link over, and is not a secret. The toast title says `Link copied — anyone with it can view`, because nothing else on the owner's surface ever told them the link is unauthenticated.

32 characters over a 32-symbol alphabet ≈ 160 bits. `randomBytes % 32` is unbiased **only because the alphabet is exactly 32 long** — 256 divides evenly by it. Changing the alphabet's length reintroduces modulo bias and `mintSnipId` has to become a rejection loop.

## The version floor: 0.13.0

Capture is **entirely main-process work** — the global shortcut, the tray item, the transparent selection surfaces, `desktopCapturer` and the crop all live in `electron/main.js`. None of it can arrive by a Vercel deploy, and a renderer inside an older shell is the normal case here, not an edge case (rule 9c). Without a floor, such a user gets a page that looks completely functional and whose every button does nothing.

`SNIPPING_TOOL_MIN_APP_VERSION` in [`src/lib/snips.ts`](../src/lib/snips.ts) is the single declaration. It is enforced in **two** places, and both are needed:

| Where | What it does | Why it is not enough alone |
|---|---|---|
| `MIN_VERSION_PAGES` in [`Sidebar.tsx`](../src/components/Sidebar.tsx) | Refuses the click, toasts "needs version 0.13.0 or newer" | The rail is not the only way to reach a route — deep links, the completion notification's `actionUrl`, and typing the URL all bypass it |
| The page itself | Renders an "update required" state instead of the library | Nothing stops a user reaching the route; this is the actual gate |

This mirrors GoLogin's `minVersion` in `SATELLITE_PAGES`, but the mechanism differs and the difference matters: GoLogin opens a **satellite window**, so `main.js` also refuses the path outright via `SATELLITE_PREFIXES`. The Snipping Tool is an ordinary in-window route, so there is no main-process refusal to lean on — the renderer is the only thing that can say no.

**`useAppVersion` is three-state (`checking` / `resolved`) and the page must wait for `resolved`.** `meetsMinVersion` treats an unknown version as failing the floor, which is the right default for a decision and the wrong thing to paint: gating on the boolean alone flashes "update required" at every user during the tick before the IPC answers. A shell so old it cannot answer resolves to `null`, which fails the floor — which is the correct outcome, arrived at deliberately rather than by a race.

**It is a floor, set once, and then left alone.** `meetsMinVersion` is `>=`, so `0.13.0`, `0.14.0`, `1.0.0` and a `0.13.0-beta.1` all pass — routine releases never touch this constant, and nothing needs to be kept "in sync" with `electron/package.json`. Verified against the real function:

| Installed build | Result |
|---|---|
| `0.12.0`, `0.12.9` | blocked |
| `0.13.0`, `0.13.1`, `0.14.0`, `1.0.0` | access |
| `0.13.0-beta.1` | access (the pre-release suffix is stripped by `parseVersion`) |
| `null`, `''`, unparseable | blocked |

The **one** thing that would break it: the constant must name the version that *actually* ships the main-process code, not the version it was planned for. If this release slipped and the snip code landed in `0.14.0` instead, a floor left at `0.13.0` would wave through `0.13.0` users to a page that cannot capture. Set it to the build it really shipped in; after that it is finished.

The version arithmetic itself (`parseVersion` / `meetsMinVersion`) lives in [`src/lib/appVersion.ts`](../src/lib/appVersion.ts). It was private to `Sidebar.tsx` until this feature needed it from a page as well; two copies of version comparison is the kind of thing that drifts into disagreeing about what `0.13.0` means.

## Authorisation, in three layers

1. **The page permission `apps-snipping-tool`** (tier 2) gates every owner-facing route *and* the native surfaces: `SnipController` pushes `enabled` to Electron from `permittedPageIds`, so revoking the page takes the tray item and the shortcut away rather than just hiding the list. Main deliberately **never caches that config to disk** — a cached one would re-arm a revoked user's shortcut at next launch.
2. **`ownerUid`, per row**, everywhere a specific snip is addressed. The id is unguessable; "unguessable" is not an authorisation check.
3. **The token alone** on the public page and the image route, exactly like `/p/[shareId]`. Both re-check liveness independently — the image endpoint is reachable without the page, so it cannot lean on the page having checked — and both return **one 404 for every refusal** (unknown, deleted, pending, expired), so a stranger cannot probe which tokens exist.

`enabled` in the IPC config is **not** a security boundary and does not need to be: every route behind a capture re-checks server-side, so a spoofed `enabled: true` buys a tray icon and a local crop that nothing will store.

## The library pages; it does not list

`GET /api/snips` returns **one page** — `{ snips, nextCursor, total }` — not the user's whole library. The cap is 500 snips per user, and each row's preview is a `302` through a Vercel function, so an unpaged grid is not one big response but one response *plus* up to five hundred origin requests (rule 9i). `SNIP_PAGE_SIZE` is 24; `total` rides the first page only, so the count line can say "24 of 118" without billing an aggregation read on every scroll.

The cursor is `{createdAt ms}.{document id}`, and **both halves matter**. The id gives an exact, tie-proof `startAfter` while that row still exists; the timestamp is the fallback for the case the id cannot survive — the user deletes the last row of a page and then scrolls, which with an id-only cursor would silently restart the list from the top. A malformed cursor returns an empty page rather than page one, for the same reason.

Ordering and filters are unchanged from the unpaged query, so the cursor rides the **existing** composite index (`ownerUid`, `status`, `createdAt desc`) — paging added no index and nothing to deploy.

On the page, the sentinel and the "Load more" button are **the same element**: scrolling loads the next page 600px early through an `IntersectionObserver`, and a user who tabs (or a browser without the observer) gets a real control rather than a dead marker. A next-page fetch stands down while one is in flight; a *reload* preempts instead, guarded by a sequence stamp so the abandoned response cannot land on top of the newer one.

## The public page shows a name and nothing else

**Three things on it are worded for a recipient who has never seen the product**, and each replaced something that was wrong for that reader:

- The access pill reads **`Anyone with this link · read only`**. It used to say only "read only", which describes the recipient's *capability* while implying a restriction on *who* that does not exist — the token in the URL is the whole access control. A person deciding whether to forward the link needs the true answer, and this is the only place the product ever gives it.
- The page carries a **visually hidden `<h1>`** (`Shared recording from <name>`). It previously had no heading at any level, so a screen reader landing on a forwarded link got no document outline (WCAG 2.4.6, 1.3.1). It is `sr-only` because the capture itself is the page's visible title — a drawn heading would compete with the thing the recipient came to look at.
- The tab title is **`Shared capture · Bluu Rock`**, not "Shared Screenshot". The same shell serves recordings, and the title is what the recipient reads in their tab and what a chat client shows on paste.

### A dead link has its own page

[`src/app/s/not-found.tsx`](../src/app/s/not-found.tsx) replaced the framework default, which was an unstyled 404 on a domain the reader very likely does not recognise — their reasonable conclusion being that the sender mistyped the URL. It carries the lockup, says the link is no longer available, and names the one action the reader has: **ask whoever sent it for a new one**.

It says the **same thing for every refusal** — unknown token, deleted, expired, never finalised — because `getPublicSnip` returns null for all four and distinguishing them would let a stranger probe which tokens once existed. Naming the outcome rather than a cause is also the only honest option: "it expired" would be a lie for a mistyped link.

**Two known limits, both from the same cause.** `notFound()` is reached inside the page's `<Suspense>` boundary, after the shell has been flushed, so:

1. the HTTP status is **200, not 404** — verified against a local dev server; and
2. the not-found body arrives as a **streamed client patch**, so the initial HTML carries the shell and the skeleton, with the heading only in the RSC payload.

Neither affects a human with a browser, and the route is `noindex` so nothing reaches search. What they do affect is machines: link checkers, uptime monitors and unfurlers read a dead link as healthy. Fixing it means moving the Firestore read out of the boundary, which is the split Cache Components *requires* for an uncached read — so it trades a documented constraint for a status code and should be a deliberate decision, not a drive-by.

`getPublicSnip` is the whole of what an anonymous visitor can see: the capture, the timestamp, the dimensions, a recording's duration, and the owner's `displayName`. **No uid, no email, no avatar, no storage path, no retention, no byte size.** A forwarded link must not become a staff directory entry. Keep it that way when extending the projection.

The duration is the one field recording added, and it earns its place: it is what lets a recipient decide whether to press play. Note what it still is not — how large the file is remains the owner's business.

### The timestamp is the viewer's local time, resolved in their browser

The page is a server component and a public link can be opened by anyone, anywhere, with no account — so there is no stored zone to read. [`SnipTimestamp`](../src/app/s/_components/SnipTimestamp.tsx) takes it from `Intl.DateTimeFormat().resolvedOptions().timeZone` instead, and renders `2026-09-20 16:32 GMT+2`. The zone name is not decoration: a bare wall-clock time on a link that crosses timezones is worse than no time at all, because the recipient cannot tell whose afternoon it was.

**This is a different source from the owner's library, deliberately.** `SnipCard` formats in the viewer's *account* timezone (`useViewerTimezone`) because there the viewer is a signed-in employee whose zone is a known fact about them (rule 9g). On the public page there is no account, so the browser is the authority. Same presentation, two sources — don't collapse them.

It uses **`useSyncExternalStore`**, whose server snapshot is UTC and whose client snapshot is the local zone. That is the hook's exact purpose: a value that legitimately differs between server and client, without a hydration mismatch. Reading the zone in a `useEffect` + `setState` trips `react-hooks/set-state-in-effect`, and `suppressHydrationWarning` is worse — it hides the mismatch instead of avoiding it, and would silence real ones in the same subtree.

**Neither the public page nor the owner's library links to the image URL**, and that is a rule, not an oversight. `imageUrl` is a 302 to a signed Storage URL, so *navigating* to it (rather than loading it as an `<img src>`) lands the browser on `storage.googleapis.com/...` with the signed credential sitting in the address bar and the session history. Two things leak there: the object path, and a bearer URL that stays valid for its full hour — outliving the snip being deleted, which is precisely what the indirection below exists to prevent.

So: the owner's card opens `shareUrl` (the public page — which also shows them what a recipient sees), and the public page's image is **not wrapped in a link at all**. If a "view full size" affordance is ever wanted back, it needs to be a client-side zoom, not an anchor to the image route.

**The same rule covers the recording.** The player's controls play, scrub and fullscreen in place, and none of them navigate. Do not add a download button: it would be an anchor to the video route, which is the leak this paragraph exists to prevent. A recipient who needs the file can still save it from the element's own menu, which follows the redirect without ever showing the target.

### The player is ours, and the reason is the file, not taste

It was the browser's, deliberately, and the note that said so is worth understanding before anyone puts it back.

**A `MediaRecorder` WebM states no duration.** The recorder writes the EBML header before it knows how long the take will run and never returns to patch `Segment > Info > Duration`, so the element is handed what looks exactly like an open-ended stream — and renders what it renders for one: no end time, a scrub bar with nowhere to scrub to, and no way to jump back ten seconds. That is the symptom people report as "it plays like a live stream", and the browser is not wrong about what it was given.

Two things fix it and both are in [`SnipVideo`](../src/app/s/_components/SnipVideo.tsx):

1. **The duration is already ours.** `durationMs` is the recorder's own wall clock, stored on the row and projected to the public page, so the timeline is correct on first paint — before a metadata request has even landed, and for a file whose container will never say.
2. **The browser is made to resolve it too.** `resolveDuration` seeks to `1e101` once, which walks the element to the last cluster; it then fires `durationchange` with the real length and becomes **seekable**. A duration we merely *displayed* would give the bar an end without making it reachable, which is the half that matters. It costs one extra range request on open, paid once. The seek target is absurd on purpose: any finite guess could fall short on a long take and would resolve the duration to the guess.

Once the controls are ours, **playback speed is a control** (`SNIP_PLAYBACK_RATES`, 0.5×–2×) rather than an item buried in a context menu not every browser offers — which is the other thing a recipient of a ten-minute screen recording wants.

**The accessibility the UA sheet gave away for free is re-paid explicitly**, because that was the real cost of leaving it. Every control is a real `Button` with a label; the scrubber and the volume are shadcn `Slider`s; and the surface takes the usual player keys (space/k, ←/→, m, f), which it has to, because a `<video>` without `controls` is not focusable and the UA's own key handling left with the chrome.

**`thumbProps` on `Slider` exists for this.** Radix puts `role="slider"` on the **Thumb**, so an `aria-label` spread onto the Root — which is what the shadcn wrapper's `...props` does — never reaches the element a screen reader announces. A video scrubber sitting on top of the picture has nowhere to put an external `<label>`, and `aria-valuetext` matters for the same reason: without it the bar reads "0.4 of 132", a number of nothing.

**Scrubbing commits, it does not track.** `onValueChange` moves the bar, `onValueCommit` moves the media. Seeking per pointer-move would be a range request — and therefore a redirect invocation — per pixel dragged.

The still is served through `/api/public/snip/{id}/image` and a recording through `/api/public/snip/{id}/video`. Both **302 to a freshly signed URL** rather than streaming the object. That indirection is what makes the URL a recipient holds permanent to the outside (a Slack unfurl, a browser cache, an OG preview) and revocable from the inside — deleting the snip kills it immediately, where a handed-out signed URL would keep working until its own expiry. Both the redirect and the 404 are `no-store`; a cached redirect would outlive its target *and* survive the delete.

**The video route pays a known price for that**, stated here so nobody reaches for the obvious fix without deciding it is acceptable. A `<video>` does not fetch once: the browser issues **range requests** as the viewer plays and seeks, and it re-resolves the original URL rather than reusing the target of an uncacheable redirect — so each one is another invocation. The bodies still never cross Vercel (what repeats is a header-only 302, expensive in invocations and negligible in Fast Origin Transfer, which is the metric rule 9i is actually about), and caching the redirect would break the one guarantee the indirection exists for. If the invocation count ever becomes the problem, the fix is a longer signed read TTL plus an `s-maxage` strictly shorter than it, accepting a bounded window in which a deleted recording still plays.

---

## Retention

`SnipSettings.retention` ∈ `1m | 3m | 6m | 1y | never`, default **`6m`**. Each snip stores its own `expiresAt`, stamped from the owner's setting at capture time.

**The card states a duration, not a date.** `snipExpiryLabel` renders "Deletes in 2 months", "Deletes tomorrow", or "Expired" — because "Deletes 2027-03-20" made the reader do the arithmetic, when what they want before handing out a link is how long it will keep working. It also removes a timezone problem: an expiry is the moment the sweep passes it, a server-side fact, so a calendar day meant picking a zone to be wrong in. A duration is true in every zone at once. The exact date is still on the element's `title` and `dateTime`.

Two details there are deliberate. `numeric: 'auto'` is used for days and below (so 1 day reads "tomorrow") but **`'always'` above** — auto renders a month as "next month" and a year as "next year", which are vague exactly where precision matters: "deletes next year", read on 20 December, could mean eleven days. And a row past its expiry reads **"Expired"**, not "deletes soon": the library lists every `ready` row and expiry is enforced on read rather than by the listing query, so an unswept row does appear here and its link is already dead.

**Changing the setting re-stamps every existing snip** (`restampRetention`, `bulkWriter` per rule 9), recomputed from **each row's own `createdAt`** — not from now. So 6m → 1m deletes the four-month-old snips on the next sweep, which is what the words say. The alternative (new snips only) would make the setting silently apply to a future the user cannot see.

### The one trap: `never` must leave `expiresAt` ABSENT, not null

Firestore orders `null` **before every other value**, so a stored `null` matches the sweep's `expiresAt <= now` and puts exactly the snips the user asked to keep forever first in line for deletion. An **absent** field is excluded from an inequality filter. `finalizeSnip` omits the field and `restampRetention` uses `FieldValue.delete()`; do not "tidy" either into a null.

### Expiry is enforced on READ, not by the cron

`getPublicSnip` and `getSnipImageRedirect` both refuse a row past its `expiresAt` the moment it is past it. The daily sweep reclaims the bytes, which is a separate concern with a day of slack in it. **Do not move the read-path check out on the grounds that a cron exists** — it is what makes "deleted after 6 months" true to the hour.

The sweep also collects **abandoned reservations**: a slot whose PUT landed but whose finalise never arrived (the window closed, the machine slept). Those are unreachable bytes and this is the only thing that reclaims them.

**Every delete path removes both objects** — the media and, for a recording, its poster. `snipObjectPaths` is the single place that list is derived, resolved from the document rather than rebuilt from the id, so a row written under either storage layout is handled by all of `deleteSnip`, `deleteAllSnipsForUser` and the sweep. A poster whose delete fails never blocks the row: an orphaned thumbnail is unreachable bytes, where an orphaned row is a live link to a recording the user asked to delete.

---

## The keyboard shortcut

Default `CommandOrControl+Shift+S` — an Electron **accelerator**, not a browser key string.

`isValidSnipShortcut` runs on the client *and* on the API route, and it is not belt-and-braces. `globalShortcut.register`:
- **throws** on a malformed accelerator rather than returning false, and
- happily accepts a **bare unmodified key** — registering `S` globally would swallow every `s` the user types in every other application on the machine, with no way to fix it from inside an app they can no longer type into.

So: at least one modifier, exactly one non-modifier key.

`register` also returns **false** when another application already owns the combination. `snip:configure` returns that as `shortcutRegistered`, and `SnipController` toasts it — silently doing nothing would leave the user pressing a key that belongs to someone else and concluding the tool is broken.

`ShortcutRecorder` reads `event.code`, not `event.key`: `key` is the character the layout produces, so on AZERTY `Shift+A` arrives as `Q`. `code` is the physical key, which is what an accelerator binds to. ⌘ and Ctrl are folded into `CommandOrControl` so a binding chosen on one platform works on the other.

## The tray item

| | macOS | Windows |
|---|---|---|
| Surface | Menu bar item | Notification-area icon |
| Asset | `snipTemplate.png` (+`@2x`), black-on-alpha, re-tinted by the OS | `snip-win.png`, white — Windows draws the icon as-is |
| Left click | New snip | New snip |
| Right click | `popUpContextMenu` (manual) | `setContextMenu` |

**The tray glyph is `ImageUpscale` — the same mark as the page icon**, so the tool looks like one thing everywhere it appears.

The assets are **generated from lucide's own path data**, copied verbatim out of `lucide-react/dist/esm/icons/image-upscale.mjs`, so the menu-bar mark and the in-app icon are literally the same drawing rather than a hand-traced lookalike. They are rasterised by distance field with 8×8 supersampling, not by plotting rectangles: this icon is mostly arcs plus a diagonal, and at 16px an aliased diagonal is the difference between a mark and a smudge.

It is a **dense** mark at 16px — a dashed frame, an inner picture, and an arrow, all competing in a 16px box. That is a known trade, accepted deliberately for consistency with the page icon. If it ever needs redrawing, judge the result at 16px on a real menu bar, not zoomed in a vector editor, and regenerate rather than editing the PNGs by hand.

**The platform split on the menu is not cosmetic.** On macOS `setContextMenu` makes a *left* click open the menu and suppresses the `click` event entirely, so one-click capture would be impossible; the menu is popped up by hand instead.

This is a **second** `Tray`, independent of the session-timer tray (`timerWidgetTray`). They have different lifecycles — the timer's exists only while clocked in, this one while the user holds the page.

## Why the rectangle looks the way it does

It has to stay legible over content nobody controls — a white document, a dark terminal, a photograph. So it is a 1px Action Blue border with a **1px dark outline just outside it**: whichever of the two a given background swallows, the other survives. The fill is `rgba(59,130,246,0.10)` — enough to read the shape at a glance, not enough to obscure the thing being captured, which is what the user is aiming at.

There is deliberately **no hint pill or instruction chrome.** The brief was a cursor and a box; a floating "Drag to select · Esc to cancel" label is neither, and the page's own description already states the shortcut.

That still holds, and the **mode bar is not a counter-example.** Nothing on it instructs — it does not say to drag, or that Escape cancels. What it carries is a *choice that cannot be made anywhere else*: still or recording, and what audio a recording takes. The choice has to be made before the drag, because the drag is the last thing that happens, and there is no other surface on screen to make it on. It is drawn by **one** surface (the display under the cursor), and `clearMarks` hides it along with the rectangle, so it is never in a capture.

## Multi-display

One transparent surface per display, each covering that display's bounds.

- `desktopCapturer` takes **one** `thumbnailSize` for every source, so it is the bounding box of the largest display in device pixels; each capture is fitted inside it preserving aspect ratio. The **actual** returned size is read back rather than assumed — that is what makes a Retina laptop beside a 1080p monitor crop correctly. Never scale by `scaleFactor` instead.
- Sources pair to displays by `source.display_id`, falling back to index order.
- **There is no `blur` → cancel in `snip.html`, and adding one would be a bug.** Exactly one window can be key, so a page-level blur handler would cancel the whole snip the moment the second surface opened, and again every time the cursor crossed screens. Main owns that rule (`armSnipOverlays`) because main is the only side that knows how many surfaces exist, and it applies it **only** when there is one. On a multi-display setup, Escape and right-click are the escape hatches; every surface accepts both.

---

## Gotchas

- **A recording never reaches the app window as bytes, and never reaches the OS as a file the renderer can name.** Chunks go renderer → main → temp file; the renderer is handed a **token**, and main does the upload. If you find yourself wanting the blob in `SnipController`, re-read the "bytes" section above first — every one of the four reasons is still true.
- **Only one recording at a time, and no still capture during one.** `startSnip` refuses while `snipRecording` is live (the shortcut is global, so a stray keypress reaches it), and `SnipController` discards a recording that lands while another upload is in flight rather than losing track of the temp file.
- **Losing the page permission mid-recording stops the recording.** `snip:configure` with `enabled: false` calls `clearSnipRecording`: letting it run would upload through routes that will now refuse it, and leave the user watching a control bar for a file with nowhere to go.
- **`clearSnipRecording` guards the stream's `end()` rather than try/catching it.** A second `end()` emits an **asynchronous** `error` that a try/catch cannot see, and an unhandled stream error takes the main process down. `snip:rec-done` ends the stream itself — it has to wait for the flush before the file is read — and then calls the teardown.
- **The completion notification deliberately ignores `notificationPreferences.desktopEnabled`.** That toggle governs the *notification feed* — shift reminders, DMs, things the system pushes at you (`useNotifications`). A snip confirmation is direct feedback on an action the user just took, and while the window is hidden it is the **only** feedback that exists; gating it would mean a user with alerts off captures into silence and has no way to know the link is on their clipboard. It is `playSound: false` for the same reason it is shown: it confirms, it does not interrupt.
- **The clipboard write goes through MAIN**, via [`copyText`](../src/lib/copyText.ts). `navigator.clipboard.writeText` needs the document focused, and the whole point of a snip is that it completes while the user is in another application with the Bluu window hidden — there the web API rejects and the one thing the user wanted never lands. `clipboard:writeText` runs in main and has no such requirement. The web API is the **fallback**, for an installed shell that predates this feature (rule 9c) and for a plain browser; both are reachable only by clicking a page, so the document is focused there by construction. `copyText` returns whether the text actually landed, and both call sites report that honestly rather than claiming a copy they did not make.
- **Surfaces come down before the upload starts.** By the time the PNG is uploading, the user already has their screen and their cursor back; everything after the crop is the renderer's problem.
- **`SnipController` is mounted on the layout, outside `LazyProviders`.** It must arm regardless of clock state — a snip is not a shift activity — and a capture has to work with no page open.
- **`SnipSettingsPopover` reconciles its draft on a CONTENT fingerprint, not on the `settings` object.** The page derives `settings` with a `useMemo` keyed on `userData?.snipSettings` — a nested object off the snapshot, so its identity changes every time anything rewrites `users/{uid}`, and presence does that every ten minutes. An effect keyed on the object alone re-set the draft on a timer and could stomp an in-flight optimistic edit with the pre-save value. It compares the five field values instead (the `usePermissions` pattern). The page avoiding this trap and the popover reintroducing it one level down is the exact shape rule 9i keeps taking.
- **`savingKey`, not `saving`.** The popover disables only the control being written. A single boolean froze all four on any save, so changing retention locked the shortcut recorder and both switches for a round trip that had nothing to do with them.
- **Its effects key on primitives, never on `userData`.** `users/{uid}` is rewritten by presence every ten minutes; an effect keyed on the snapshot would re-register the global shortcut with the OS on a timer (rule 9i).
- **`api.removeCapturedListeners` is a `removeAllListeners`.** `handleCapture` is deliberately dependency-free so the subscription is made once; a churning one would tear out its own handler.
- **Cache Components.** `/s/[shareId]` reads uncached data inside a `<Suspense>` boundary and must stay that way. Do not add `export const dynamic` (rejected outright under the flag) and do not mark the page or `getPublicSnip` cacheable — a deleted snip has to stop resolving immediately.
- **`/s` is allowlisted in `src/middleware.ts`.** Without it a recipient in a normal browser is rewritten to `/desktop-only`, which would make sharing pointless.
- **The bucket's CORS policy is a deployment prerequisite** — see the Storage section above. `Failed to fetch` on `storage.googleapis.com` is always this, never the code.
- **The page is gated on app version 0.13.0** in two places — see the version-floor section above. It is a **floor, set once**: `0.14.0` and everything after it passes, so routine releases never touch it. **Video mode has its own second floor at `0.14.0`** and is gated separately, so a 0.13.x user keeps their library.
- **This needs an Electron build** (rule 14, the two-push dance): `electron/main.js`, `preload.js` and two new files changed. A renderer on an older shell degrades cleanly — `window.electronAPI.snip` is absent, every call site feature-detects, and the page says to update.
- **Recording needed a second build (0.14.0)**, and it adds three files to `electron/package.json`'s `files[]` — `snip-record.html`, `snip-record-preload.js` and `snip-frame.html`. A file left out of that list is absent from the packaged app and the feature fails only in production, which is the worst place to find out.
- **The sounds needed a third build (0.14.2)**, and it is the smallest possible one: two `sendTo(mainWindow, …)` lines in `main.js` and two listeners in `preload.js`. No new files, so `files[]` is untouched. Everything else in this pass — auto-copy, title/description, Import, the public player — is web only and ships on a plain Vercel deploy; a user on an older shell gets all of it, and only loses the shutter's *precision* (it falls back to `snip:captured`) and the recording cue entirely. There is deliberately **no new version floor**: nothing here is unusable on 0.14.0, and a floor would withhold four working features to enforce a sound.
- **`SnipSettingsPopover`'s fingerprint has to grow with the settings map.** It content-compares five — now six — field values rather than the object, because the object's identity changes every time presence rewrites `users/{uid}`. A field added to `SnipSettings` and left out of that string is a field whose external change never reconciles the draft.
- **The public page's `<video>` no longer uses native `controls`.** That was a documented decision and it was reversed for a documented reason — a `MediaRecorder` WebM states no duration, so the browser renders it as a live stream. See "The player is ours" above before changing it back.
- **Narration ships in 0.15.0, on both platforms**, and it is the first release that needs a new macOS capability: `com.apple.security.device.audio-input` in both entitlements plists and `NSMicrophoneUsageDescription` in a new `mac.extendInfo` block. **Neither may ship without the other** — a missing usage string does not produce a refusal, it terminates the app.
- **Never raise a permission prompt from the selection surface.** It is full-screen and always-on-top, and on a single display `armSnipOverlays` cancels the snip on blur — so a TCC dialog there destroys the surface that asked for it and resolves into a window that no longer exists. `snip-preload.js` deliberately exposes no `requestMic`.
- **The "Open Settings" asymmetry runs the other way for the microphone.** Screen Recording has no Windows permission, so that button is macOS-only. The microphone is grantable on both (`ms-settings:privacy-microphone`), so gating it on macOS would hide the only route a Windows user has.
- **The microphone status is never cached.** Every surface, every toggle and every focus of the settings card re-reads it. A status read once at launch is how a user who has just granted access is still told they have not.
