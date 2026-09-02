# Model Submissions

> The public model application form (`/model-submissions`) and the internal review queue (`/applications/apps-model-submissions`). This is the **only unauthenticated write path in the project**, and it collects the most sensitive data we hold — read the [Abuse & security model](#abuse--security-model) before changing any of it.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/app/model-submissions/page.tsx` | The public 3–4 step form ("the stage" skin) |
| `src/app/model-submissions/_components/` | `Field`, `PrefixedInput`, `SocialField`, `PhotoUploader`, `ThankYou`, `NoTranslate` |
| `src/app/model-submissions/_lib/guessCountry.ts` | Pre-selects the WhatsApp dial code from the browser's own locale |
| `src/app/model-submissions/error.tsx` | Route error boundary — the branded crash screen, with `reset()` |
| `src/app/model-submissions/_lib/theme.ts` | **The public surface's design tokens — import, never inline** |
| `src/app/model-submissions/_lib/prepareImage.ts` | **Browser-side HEIC→JPEG transcode** + downscale before upload |
| `src/lib/modelSubmissions.ts` | Limits, status vocabulary, **the shared zod schema** (client + server) |
| `src/lib/services/modelSubmissionService.ts` | Sessions, HMAC signing, rate limits, `sharp` ingest, signed URLs, reads |
| `src/app/api/model-submissions/session/route.ts` | **PUBLIC** — issues a signed single-use session |
| `src/app/api/model-submissions/upload/route.ts` | **PUBLIC** — `POST` accepts one image against a session; `DELETE` releases a removed one |
| `src/app/api/model-submissions/submit/route.ts` | **PUBLIC** — finalises the application, notifies reviewers |
| `src/app/api/model-submissions/admin/route.ts` | Review queue (page permission) |
| `src/app/api/model-submissions/admin/[id]/route.ts` | Full record + approve/reject (page permission) |
| `src/hooks/useModelSubmissions.ts` | `useModelSubmissions` (queue) + `useSubmissionDetail` (one record) |
| `src/app/(main)/applications/apps-model-submissions/` | The review page + `SubmissionCard` / `SubmissionDetail` |
| `src/middleware.ts` | `/model-submissions` is browser-allowlisted (applicants have no desktop app) |
| `tests/firestore-rules/firestore-rules.test.ts` | §21 — asserts every path is client-denied |

## Firestore

| Collection | Contents | Client access |
|---|---|---|
| `model-submissions/{id}` | The application: answers, photo storage paths, status, review trail, `ipHash` | **Denied** (read *and* write) |
| `model-submission-sessions/{id}` | Signing state, `fileCount`, `consumed`, pending-photo manifest | **Denied** |
| `model-submission-rate/{ipHash}` | Rolling 24h abuse counters | **Denied** |

All three are Admin-SDK-only. There is deliberately **no** client-readable rule on `model-submissions`: a signed-in employee without the `apps-model-submissions` page permission must not be able to read applicants' details by going around the API, and an applicant must never read anyone's application including their own.

Both session and rate documents carry an `expiresAt` timestamp for a **Firestore TTL policy** (not yet configured — see [Operational notes](#operational-notes)). Nothing depends on the sweep; the code treats an expired session as invalid regardless.

No composite index is required: the queue reads `orderBy('createdAt', 'desc')` on a single field and filters by status client-side.

## Storage

```
model-submissions/{sessionId}/{kind}-{photoId}.webp        ← full size, long edge ≤ 2400px
model-submissions/{sessionId}/{kind}-{photoId}_thumb.webp  ← thumbnail, long edge ≤ 480px
```

`kind` is `selfie` | `body` | `earnings`. Nothing here is public: reviewers get **signed URLs valid for one hour**, minted per request and only after `checkPageAccess`.

The submission id **is** the session id, so a submission's photos are already grouped under their own folder before the document exists.

---

## The flow

```
  Applicant opens /model-submissions
        │  POST /session            → { sessionId, token }   (rate limited per IP)
        ▼
  Step 1 Your info ─ Step 2 About ─ [Step 3 OnlyFans] ─ Step 4 Photos
        │                            (only if hasOnlyFans)      │
        │                                                        │ each photo, on pick:
        │                                                        ▼ POST /upload → { id }
        │  POST /submit { sessionId, token, website, elapsedMs, fields }
        ▼
  model-submissions/{sessionId} written + notification to every reviewer
        ▼
  ThankYou screen
```

Photos upload **as they are picked**, not on submit. This is the mobile-first call: the applicant's images move while they read the next question, so pressing Submit is instant instead of a 40-second wait they might abandon.

**Continue and Submit are blocked while any upload is in flight** — the button disables and reads "Uploading photos…", and `handleNext` re-checks before advancing, so a race between render and tap can't slip through either.

### Removing a photo frees its slot

`fileCount` is a **live** count, not a tally of attempts. `DELETE /upload` deletes both stored objects and decrements it, and the client fires it when a tile is removed *and* when an upload lands after its tile was already gone. Without this, replacing a photo permanently consumed capacity and the applicant would eventually be told they had "reached the photo limit" while looking at a half-empty grid.

`MAX_UPLOAD_ATTEMPTS_PER_SESSION` (40) is the monotonic ceiling that keeps a releasable live cap from becoming an unlimited one.

### HEIC is converted in the browser, not on the server

iPhones shoot HEIC in an **HEVC-coded** container, and `sharp`'s prebuilt libvips ships **without the HEVC codec** — it is patent-encumbered, and there is no way to add it on Vercel. Verified directly: `sharp.format.heif.input` reports `true`, but an HEVC round-trip fails with `heifsave: Unsupported compression`, while AV1-coded HEIF works. So a real iPhone HEIC is undecodable server-side, full stop.

The conversion therefore happens client-side in [`_lib/prepareImage.ts`](../src/app/model-submissions/_lib/prepareImage.ts), via `heic-to` (a WebAssembly build of libheif). It is **dynamically imported**, so only applicants who actually pick a HEIC download the wasm and it stays out of the form's initial bundle. `isHeic` sniffs the real bytes before converting, so a JPEG that merely kept a `.heic` filename is left alone.

Most iPhone applicants never reach that path — iOS transcodes to JPEG automatically when a photo is picked through a file input. It is the AirDropped `.heic` on a Mac, the Android user forwarding an iPhone photo, and "Keep Originals" that need it.

**Two server-side safety nets**, both returning a message the applicant can act on ("Settings → Camera → Formats → Most Compatible") rather than "that isn't a readable image":
- `metadata()` throwing — the buffer's ISO-BMFF brand is sniffed to confirm it is HEIF before blaming the format;
- the **encode** throwing, which is a distinct path: parsing a HEIC container's box structure needs no codec, so `metadata()` can succeed and the pixel decode still fail.

`UPLOAD_ACCEPT` lists `.heic` / `.heif` extensions alongside the MIME types, because some platforms report an empty type for HEIC.

### Rate limits are sized for shared IPs

The per-IP ceilings are deliberately generous. Every page load opens a session; mobile carriers put thousands of users behind one CGNAT address; and **in local development `clientIp` has no forwarding header to read, so it returns `unknown` and every request on the machine shares a single bucket.** A tight limit here does not improve the abuse story — the session token, the per-session caps, and the `sharp` validation do that work — it just locks out real applicants and anyone testing the form.

Every rejection is logged (`console.warn` with the reason and, for quota trips, the IP hash), because the applicant only ever sees a short message and the server log is the only record of *why* a retry keeps failing.

### Step 3 is conditional

Section 3 only exists when the applicant answers **yes** to "do you already have an OnlyFans account linked to your identity?". The step list is derived from that answer, so the progress rail shows 3 or 4 segments accordingly, and the submit route **blanks** `trialLink` / `earningsPhotos` when `hasOnlyFans` is false rather than trusting whatever the client sent.

Section 3 is therefore only ever the trial link and the earnings screenshots (**up to two**). The social pages moved to section 2 in 2026-09, because every applicant has them — gating them behind "do you have an OnlyFans account?" meant we held no way to look up the majority of applicants.

### Contact: one of Telegram or WhatsApp is required

Each field is optional on its own; **`requireOneContact` in the shared schema demands one of the two**, on both the step slice and the whole-form schema. Email alone is not enough: every conversation with an applicant happens on a messenger, and an application nobody can follow up on is an application nobody actions. (An earlier note here said the opposite — it described the Instagram/Telegram pair, and Instagram is no longer a contact field at all.)

- **WhatsApp is stored as E.164** (`+27821234567`), composed by `composeWhatsApp(dialCode, number)` so the browser and the server build the identical string. A number typed with `+` or `00` keeps its own country code; otherwise the select's dial code is prepended and the national trunk `0` dropped. It deliberately does **not** infer a duplicated country code from digits alone — that eats a real digit off every US number starting with 1.
- **The country is guessed, never assumed.** [`guessCountry.ts`](../src/app/model-submissions/_lib/guessCountry.ts) reads `navigator.languages` and resolves a region through `Intl.Locale` (`en-ZA` → `ZA`; a bare `pt` maximises to `BR`). No geo-IP call, no library, no request. It only ever pre-fills a visible, editable control, and returns `''` — leaving the placeholder — rather than a confidently wrong country.
- Legacy `instagram` on the document is a **read-only** field now: records written before 2026-09 kept Instagram as a contact detail, and the review dialog still renders it for them. Nothing writes it.

### Social pages are per-platform, and stored as URLs

"List all your social media pages" is four controls — Instagram, Twitter, Reddit, and a free-text *Anything else* — not one textarea. A single box produced answers we then had to guess at: bare handles with no platform, half-typed URLs, three accounts on one line.

The applicant types **only the username** (the `@` / `u/` is field chrome, supplied by `PrefixedInput`), and the shared schema transforms it into the full profile URL that is stored — `https://www.instagram.com/…`, `https://x.com/…`, `https://www.reddit.com/user/…`. `normaliseHandle` accepts a pasted URL too, so someone who ignores the affix still lands on the same value.

- **`requireOneSocial` demands at least one** of the four, reported on the synthetic `socials` path so the message sits under the group rather than under whichever box happens to be first.
- **`socialLinks` is composed by the submit route**, never sent by the client: the four values, newline-joined. It is both the one-block value the reviewer copies and the field older records already kept their answer in, which is what lets the review dialog render both eras from the same place.

### Browser translation is disabled on this route — it used to crash the form

On 2026-08-28 an applicant in Safari with **Translate → Spanish** on lost a half-filled application. Sentry recorded them filling steps 1 and 2, opening the country `Select`, picking an option, and the React root dying on `NotFoundError: The object can not be found here.` The tell was the breadcrumb reading `[aria-label="Ciudad"]` — the source says `City`, and "Ciudad" appears nowhere in the repo, so the DOM had been rewritten under React.

Translators replace text nodes **in place** (Safari swaps the node, Chrome wraps it in a `<font>`). React keeps a reference to the node it created, and the next unmount of that subtree calls `parent.removeChild(node)` on a node that is no longer a child. Picking a `SelectItem` unmounts the dropdown, which is exactly that deletion. Every Radix overlay on this surface has the same shape.

[`NoTranslate`](../src/app/model-submissions/_components/NoTranslate.tsx) sets `translate="no"` + `.notranslate` **on `<html>`**, mounted from the route layout and restored on unmount.

- **It has to be `<html>`, not the form.** Radix portals its overlays to `document.body` — a *sibling* of the form, not a descendant — and `translate` is inherited down the tree. Marking the form alone leaves the exact subtree that crashed still translatable.
- **It is route-scoped, not global**, because translation is a real convenience elsewhere in the app. This is the surface where it is both most likely (an international, often non-English-speaking audience) and most costly (one unauthenticated shot at a form with no server-side draft).
- `<main>` also carries the static pair in both branches, covering the window before hydration runs the effect.

### A crash no longer costs the applicant their answers

Two halves, both added with the fix above:

1. **[`error.tsx`](../src/app/model-submissions/error.tsx)** — before it, a render crash escaped to `app/global-error.tsx`, which renders an unstyled `NextError`: a stranger part-way through sending us their legal name and photographs got a bare "An error occurred" on an unbranded page with no way forward. It now reports to Sentry (`area: model-submissions`) behind a stage-skinned screen with a **Continue your application** button.
2. **A module-scope draft in `page.tsx`** — `reset()` re-renders the segment *without a document reload*, so a plain module variable survives it. Form state, step index, photo slots and the session are seeded back from it on remount.

Two things about that draft are load-bearing:

- **It is in memory, never in storage.** This is the most sensitive data the project holds, and the rule that applicant details do not land on disk is the same one the review queue follows for opened records. Module scope recovers the case that actually hurt us (a render crash in a live tab) and nothing else — a reload or a closed tab starts clean, which for this data is the right trade, not a gap.
- **It carries the `session`, and the session effect returns early when one is recovered.** Photos upload against a session id, and `resolvePhotos` only honours ids that session was issued — so re-opening a session after a crash would silently orphan every photo already uploaded and burn a per-IP session slot doing it. `startedAt` is preserved for the same reason in miniature: a restarted clock could push a genuine applicant under `MIN_FILL_SECONDS` and get them silently treated as a bot.

### One schema, three places

`submissionSchema` in `src/lib/modelSubmissions.ts` is the single definition. It runs:

1. **Per step** in the browser (`stepSchemas`, slices of the same field definitions) so "Continue" only complains about what's on screen;
2. **Whole-form** in the browser on submit;
3. **Whole-form on the server**, which is the only one that counts.

Every field is defined once in the `F` object, so a step's error message is byte-identical to the server's. **Never add a field to the form without adding it to `F`** — a field the schema doesn't know about is a field the server silently drops.

The two cross-field rules (`requireOneContact`, `requireOneSocial`) are plain functions passed to `.superRefine` by **both** the step slice and the whole-form schema, for the same reason: a step must never pass something the server would reject. They raise their issue on a synthetic path (`contact`, `socials`) because they are about a *set* of inputs — `fieldErrors` keys on that path, and the page renders it as the group's message.

---

## Abuse & security model

The public endpoints are the only unauthenticated write path in the project. Defence is layered; each layer is cheap and independent.

| Layer | Where | What it stops |
|---|---|---|
| **Signed session token** | `verifySignature` (HMAC, timing-safe) | Naked POSTs at `/upload` or `/submit`. Rejected before any Firestore read. |
| **Single-use session** | `consumeSession` (transaction) | Replays, double-taps, retry storms creating duplicate applications. |
| **Session TTL** | `SESSION_TTL_MS` (2h) | Tokens harvested once and reused indefinitely. |
| **Per-IP rate limits** | `consumeRate` (transaction, rolling 24h) | Volume: 40 sessions, 5 submissions, 250 uploads per IP per day. Sized for shared IPs — see [Rate limits](#rate-limits-are-sized-for-shared-ips). |
| **Per-session live cap** | `reserveUploadSlot` (transaction) | Parallel uploads racing past `MAX_FILES_PER_SESSION` (14) — a **live** count, released on removal. |
| **Per-session attempt ceiling** | `MAX_UPLOAD_ATTEMPTS_PER_SESSION` (40) | Cycling upload/remove forever now that the live cap can be released. Monotonic; never goes down. |
| **Byte cap** | `MAX_UPLOAD_BYTES` (12MB), checked before *and* after `formData()` | Memory exhaustion. |
| **`sharp` decode** | `ingestImage` | Renamed archives, SVG payloads, polyglot files, decompression bombs (`limitInputPixels`). Format is **proven**, never taken from `Content-Type`. |
| **Re-encode** | `ingestImage` | **EXIF/GPS** an applicant would not knowingly send us. Nothing is stored as uploaded. |
| **Server-issued photo ids** | `resolvePhotos` | A submission pointing at storage paths the client invented. Only ids this server issued resolve. |
| **Honeypot** | `website` field, off-screen | Naive form-filling scripts. Answers `200` so the bot believes it worked and doesn't adapt. |
| **Fill-time floor** | `MIN_FILL_SECONDS` (8s) | Scripted submits. Same silent-`200` treatment. |
| **`noindex`** | `layout.tsx` metadata | Search-engine discovery of a link meant to be handed out. |
| **IP hashing** | `hashIp` (HMAC) | We keep an abuse fingerprint, never a raw IP. |

### Rules for changing this subsystem

1. **Never trust a client-supplied path, id, or MIME type.** Ids are resolved against server-written records; formats are proven by decoding.
2. **Never make a photo public.** Signed URLs only, minted after the page-permission check, one hour.
3. **Never loosen the Firestore rules.** All three collections are `read, write: if false`, and §21 of the rules test suite asserts it — including for admins.
4. **Every new public endpoint takes the session token and a rate-limit consume**, in that order (signature first: it costs no reads).
5. **The bot heuristics answer `200`, not `403`.** Telling a script it was detected teaches it what to change.
6. **HMAC key**: `MODEL_SUBMISSION_SECRET` if set, otherwise derived deterministically from `FIREBASE_SERVICE_ACCOUNT`. Setting the env var later **invalidates every open session** (applicants mid-form see "session expired" and must refresh) — do it at a quiet hour.
7. **Do not remove `<NoTranslate />`, and never persist the draft to storage.** Both are documented above with the incident that produced them — the first is what stops a translated DOM from killing the React root, the second is what keeps applicant PII off disk.

---

## The review page

Product register, console house style. Cards, not a table, because the decision is photographic.

- **Filter tabs** — New / Approved / Rejected / All, each with a count badge and its status dot. Defaults to **New**: the queue's purpose is the unreviewed pile.
- **The card is a fixed 9:16 frame** (phone-portrait, matching how these photos are almost always shot). `aspect-ratio` alone only sets a *preferred* size — it does not clamp content, so a tall in-flow image stretches the box and the card resizes as the reviewer pages through photos. Everything inside the frame is therefore `absolute inset-0` (out of flow, so it contributes no height) with `object-cover` doing the crop, and the images carry no intrinsic `width`/`height`. The decision row is pinned to `h-8` in both states so reviewed and unreviewed cards are the same height and grid rows stay level. Anything wider than 9:16 is cropped at the sides here; the uncropped image is one click away in the detail viewer. The same `absolute inset-0` rule applies to the public form's upload tiles.
- **The card pages photos in place.** Every selfie and body thumbnail travels with the summary, so the common decision ("do the photos work?") never needs the detail view. Approve / Reject sit on the card. Reviewed cards swap the buttons for the reviewer's name and an **Undo** that returns the record to `new` and clears the review trail.
- **Detail dialog** — full record beside a viewer with arrow-key paging and a thumbnail rail. This is the only place the earnings screenshots and contact details appear. Social pages render as one link per platform (stored URLs, so nothing is reconstructed), with a single copy control on the section heading that hands over `socialLinks` as a block; a record from before the per-platform fields falls back to rendering that block as text.
- **Image strategy** — thumbnails are 480px **WebP**, `loading="lazy"`, `decoding="async"`, with intrinsic `width`/`height` so the grid never shifts. Full-size renders load **only** for the photo being looked at. Opening a record costs one large image, not thirteen.
- **Copy controls** — every handle and link in the detail view carries a copy button. Handles copy the **resolved URL** (`https://t.me/…`), not the bare handle, so it pastes straight into a browser or a message; social links copy as one block. The icon confirms in place for ~1.6s as well as toasting, so the feedback is where the eye already is.
- **Status writes are optimistic** — the card flips immediately and rolls back with an error toast if the server refuses. A reviewer moving through a queue should never wait on a round trip.

### Image caching (why the grid used to flicker)

A V4 signature covers the **signing time** (`X-Goog-Date`) as well as the expiry, so signing on demand produces a *different URL string for the same file on every request*. The browser treats each one as a new resource, re-downloads every thumbnail, and the grid visibly repaints on each page load, each status change, and each navigation back.

Three changes remove it:

1. **Deterministic URLs.** `signOne` anchors both `accessibleAt` and `expires` to the start of a 30-minute window (`URL_WINDOW_MS`), so every request inside that window returns byte-identical URLs and the HTTP cache hits. The 4-hour TTL comfortably outlives the window, so a URL minted in its last second stays valid well into the next. An in-process memo keyed `window:path` skips re-signing and is pruned to the current window on each write.
2. **Client cache.** The queue is stored in `sessionStorage` (`bluu_model_submissions_v1`, 10-minute TTL — deliberately shorter than the signing window, so a cached row can never hold a drifted URL) and **seeded into `useState` during the initial state computation**, so the first paint already has rows. Revalidation happens in the background and a failed revalidation keeps what's on screen rather than blanking it. Opened records are cached **in memory only** for the tab: they carry contact details and should not land on disk.
3. **No `key` on image `src`.** Keying an `<img>` by its URL remounts the element on every step, blanking the frame before the next image paints *even when it is already cached*. Swapping `src` on a live element lets a cached image appear in the same frame.

Neighbouring photos are warmed after the current one is requested — immediately on the card (thumbnails), and on a 250ms delay in the detail viewer (full-size). Nothing is prefetched until the reviewer actually starts paging, so a card scrolling into view still pulls exactly one file.

**`clearModelSubmissionCache()`** drops both layers if a future change needs to invalidate the queue.

### Read cost

One `GET /admin` per page load (a single bounded query, ≤300 docs, plus one batched `getAll` for reviewer names — never N+1). Detail is one document read per opened record. Signed-URL minting is local CPU, not a network call.

---

## Design

The public form is a **third Bluu surface**, alongside the internal console (DESIGN.md §1–6) and the creator portal (§7). Its skin lives in `_lib/theme.ts`:

- **The stage** — near-black `#08090b` with a single azure stage-light wash from above (`STAGE_GROUND`). This is the surface's one decorative-colour exception, the analogue of the console's backdrop blur and the portal's page glow. **Do not add a second.**
- **Bluu azure is the one voice**, exactly as it is in the creator portal. Anything on azure takes `AZURE_INK` — white on `#00b8f5` measures 2.3:1 and fails AA outright.
- **16px field text is deliberate.** Anything smaller makes iOS Safari zoom on focus and the applicant loses their place.
- **The thank-you screen reuses the onboarding `onboard-seal` / `onboard-tick` / `onboard-rise` vocabulary**, plus a `stage-bloom` and one confetti burst. This is an authored divergence from DESIGN.md's "do not extend this vocabulary" rule: the two screens are the same beat (a once-ever completion) on two different surfaces, and reusing the primitives keeps one motion language instead of inventing a second. Both respect the global `prefers-reduced-motion` reset; the confetti is skipped outright.

---

## Operational notes

- **Firestore TTL policies are not configured.** `model-submission-sessions.expiresAt` and `model-submission-rate.expiresAt` are written and ready; add the policies in the Firebase console (Firestore → TTL) to sweep them. Without it, nothing breaks — expired sessions are rejected in code — the collections just grow.
- **Deploy the rules after any change here:**
  ```bash
  firebase deploy --only firestore:rules
  ```
- **Storage cleanup.** Photos from abandoned sessions (uploaded, never submitted) are orphaned under `model-submissions/{sessionId}/`. There is no sweeper yet; if this becomes material, a scheduled function deleting folders whose session doc is gone is the shape to build.
- **The public link** must be built from `PUBLIC_APP_ORIGIN` (`src/lib/publicOrigin.ts`), never `window.location.origin` — see [electron.md](electron.md#two-domains-one-deployment). The review page's subtext links "public form" that way, with `target="_blank"` so `setWindowOpenHandler` → `shell.openExternal` hands it to the system browser instead of navigating the app shell.
- **Legacy document fields.** `instagram`, `niche` and the singular `earningsPhoto` are still present on records written before 2026-09. `mapDoc` reads the first and coalesces the last into `earningsPhotos`; `niche` is no longer collected, read, or displayed anywhere. Nothing is backfilled — the old values simply stay where they are.
