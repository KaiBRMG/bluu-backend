# 9:16 cards + HEIC support — change report

**Status:** build compiles, TypeScript passes, lint clean.

---

## 1. Card aspect ratio → 9:16

Changed in both places that define it, so they can't drift:

```
SubmissionCard.tsx   aspect-[4/3]  →  aspect-[9/16]
page.tsx (skeleton)  aspect-[4/3]  →  aspect-[9/16]
```

9:16 is phone-portrait, which matches how these photos are actually shot — so most images now fill the frame rather than being cropped. Anything *wider* than 9:16 loses its sides, and the uncropped original is still one click away in the detail viewer.

The fixed-size machinery from the last change is unaffected: the frame holds because everything inside it is `absolute inset-0` (out of flow, so it can't contribute height), not because of the particular ratio. Cards stay a fixed size while you page through photos regardless of what ratio you pick.

Cards are noticeably taller now — at the 220px minimum column width the photo area goes from 165px to ~391px. That's the correct trade for a review queue where the photos *are* the decision, but it does mean fewer cards per screen. Say the word if you'd like the grid's minimum column width raised or lowered to compensate.

---

## 2. HEIC support

### The finding

I tested this rather than assuming, and the result changes where the fix belongs:

```
sharp 0.34.5 / libvips 8.17.3
heif  input.buffer = true          ← looks supported…
av1-coded HEIF   → encode ok, decode ok
hevc-coded HEIF  → FAILED: heifsave: Unsupported compression
```

**iPhones shoot HEIC in an HEVC-coded container, and this `sharp` build has no HEVC codec.** It's patent-encumbered and excluded from the prebuilt libvips — there is no way to add it on Vercel. So a real iPhone HEIC is undecodable server-side, full stop. The capability flag saying `heif: true` is misleading; it's AV1-only.

That means the conversion *has* to happen in the browser.

### The fix

**Client-side transcode** in `_lib/prepareImage.ts` using `heic-to` (a WebAssembly build of libheif):

- **Dynamically imported**, so only applicants who actually pick a HEIC download the wasm — it stays out of the form's initial bundle, which matters on the mobile connections this form is built for.
- `isHeic()` **sniffs the real bytes** before converting, so a Safari-supplied JPEG that merely kept a `.heic` filename isn't put through the converter.
- Converts to JPEG at q0.9, then the existing downscale runs as normal. The server only ever sees a JPEG.
- Every failure path falls back to handing the original file over and letting the server decide — the transcode can't break an upload that would otherwise have worked.

**Worth knowing:** most iPhone applicants never hit this path anyway. iOS transcodes HEIC → JPEG automatically when a photo is picked through a file input. What this fixes is the AirDropped `.heic` on a Mac, the Android user forwarding an iPhone photo, and "Keep Originals" setups.

### Two server-side safety nets

If the browser conversion doesn't happen (old browser, wasm blocked), the applicant now gets something actionable instead of *"That file isn't a readable image"*:

> We could not read that iPhone photo. On your phone, open Settings → Camera → Formats and choose "Most Compatible", then take or re-save the photo — or send a screenshot of it.

It fires on **two distinct paths**, which is easy to miss: parsing a HEIC container's box structure needs no codec, so `metadata()` can succeed and the *pixel decode* still fail. The first path alone would have let the second escape as a raw 500. The format is confirmed by sniffing the ISO-BMFF brand in the buffer, not by trusting the filename — which arrives blank or wrong often enough to be useless.

`UPLOAD_ACCEPT` now also lists the `.heic` / `.heif` **extensions** alongside the MIME types, since some platforms report an empty type for HEIC and the picker would otherwise grey the files out.

---

## New dependency

```
src/package.json  + "heic-to": "^1.5.2"
```

Flagging it because I added it without asking: there is no other way to accept a real iPhone HEIC given the server can't decode HEVC. It's dynamically imported, so it costs nothing until a HEIC is actually picked.

---

## Files changed

```
…/components/SubmissionCard.tsx                          9:16 frame
…/page.tsx                                               skeleton matched to 9:16
src/app/model-submissions/_lib/prepareImage.ts           HEIC → JPEG transcode
src/lib/services/modelSubmissionService.ts               HEIF brand sniff, guarded decode, clear messages
src/lib/modelSubmissions.ts                              accept .heic/.heif extensions
src/package.json                                         + heic-to
documentation/model-submissions.md                       documented both changes
```

---

## What I could not verify

I have no browser here, so the HEIC path is verified only as far as the server side goes — **that** part I tested directly, and the HEVC result above is a real measurement, not an assumption. The browser transcode itself is unexercised.

Please try one real iPhone HEIC end-to-end. If it fails, the message under the photo grid will now name the reason, and the dev console will show whether `heic-to` loaded.
