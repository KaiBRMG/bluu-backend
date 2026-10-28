# Training

> The public `/training` surface for **candidates on a trial** (people who may become staff), and the `admin-portal/training` page where admins run sittings. Candidates are not app users: they have no Google account in the `users` allowlist and no Firebase Auth account at all. Read [Identity](#identity-a-third-system-deliberately) before touching sign-in.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/training/modules.ts` | **Code-defined modules and parts** (titles, durations, briefs, the four edit levels) and the limits client and server share |
| `src/lib/training/types.ts` | Wire types (what the browser sees — never hashes or storage paths) |
| `src/lib/training/recording.ts` | **Screen recording** limits (segment length, batch, staleness, capture settings), segment naming, and `recordingGaps` — shared by browser, API and player |
| `src/lib/services/trainingAuthService.ts` | Signing, email hashing, the cookie, rate limits, one-time codes, candidate names |
| `src/lib/services/trainingService.ts` | Sessions, participants, the attempt and its clock, signed uploads, admin reads, source images |
| `src/lib/middleware/withCandidate.ts` | Guard for the candidate API (the analogue of `withAuth`) |
| `src/app/api/training/**` | Candidate API (cookie): `request-code`, `verify-code`, `logout`, `me`, `name`, `modules/[moduleId]`, `sessions/[sessionId]/parts/[partId]` + `start` `upload-url` `finalize` `finish` `screen-check` `recording` |
| `src/app/api/admin/training/**` | Admin API (`training` page permission): sessions, participants, one candidate's work, **their recording** (`participants/[emailHash]/recording`), source images |
| `src/app/training/**` | The candidate UI: gate, home, `media-gen`, `_components/` (`Countdown`, `TaskRoom`, `ModuleView`, `ScreenCheck`, `ScreenLock`, `ShareButton`, …), `_lib/theme.ts`, `_lib/screenCapture.ts` (share + `ScreenRecorder`), `_lib/useScreenShare.ts` |
| `src/app/(main)/admin-portal/training/**` | The admin list and session pages |
| `src/components/admin/training/**`, `src/hooks/useTrainingAdmin.ts` | Admin dialogs, the source-image uploader, the Candidates tab (`CandidatesPanel`, `CandidateSheet`), `SubmissionSlots`, `RecordingPlayer`, `zonedTime.ts`, the data hooks |
| `src/lib/email/templates.ts` → `trainingCodeEmail` | The sign-in code email (copy lives only here) |
| `src/lib/definitions.ts` | Page `training` in the Admin Portal teamspace (icon `GraduationCap`) |
| `src/middleware.ts` | `/training` is browser-allowlisted |
| `firestore.rules`, `firestore.indexes.json`, `tests/firestore-rules/…` | §21a: every collection `if false`; index exemptions |

## Identity: a third system, deliberately

The project already keeps employees (Google, the `users` allowlist) and creators (Telegram) on separate identity systems that never share a uid. Candidates are neither, and a third Firebase Auth population would put strangers in the table the allowlist protects. So:

1. An admin adds an **email address** to a session.
2. The candidate enters it at `/training`; **if and only if it is on a live session** a 6-digit code is emailed (Resend, `hello@bluurock.com`).
3. The code (10 min, 5 guesses, 45 s resend cooldown) is exchanged for an **HMAC-signed httpOnly cookie** (`__Host-training` in production, 7 days, `SameSite=Lax`) that names the address's **hash**.

The cookie is an **identity, not an authorisation**. Every request re-derives access from Firestore (participant exists, not revoked, session not closed), so an admin removing someone, or a session ending, bites on the very next call.

- **No enumeration.** `request-code` answers the same `{ ok: true }` whether or not the address is approved; the lookup and send run in `after()` so the two cases also take the same time. `verify-code` has one failure message. The code step's copy ("If … has been approved, we have sent …") reads identically either way.
- **A resend repeats the code; it does not rotate it.** The code is derived (HMAC) from a nonce on the doc, so nothing recoverable is stored and a hostile request just re-delivers the candidate's own code instead of invalidating the one in their inbox. A new code is minted only when none is live (expired, spent by five wrong guesses, or used). Known limit: anyone can still burn a live code with five wrong guesses; the candidate requests another.
- **Why a code and not email alone.** The task is one timed attempt. With email alone, anyone who knew a candidate's address could start their clock and burn their only attempt. The code proves they hold the inbox.
- **Keys.** `TRAINING_SECRET` if set, otherwise derived from `FIREBASE_SERVICE_ACCOUNT` under `training/v1`. Setting it later invalidates every open cookie and code. Emails are stored as typed (for display) with an HMAC of `normalizeEmail()` as the key — `J.Doe+x@gmail.com` and `jdoe@gmail.com` are one candidate.

## Firestore (all Admin-SDK-only, `read, write: if false`)

| Collection | Contents |
|---|---|
| `training-sessions/{id}` | `label`, `moduleId`, `closesAtMs` (access ends), `participantCount`, `parts.{partId} = { opensAtMs, sources[] }` |
| `training-participants/{sessionId}_{emailHash}` | `email`, `addedAtMs`, `revokedAtMs`, `screenChecks.{partId} = { atMs, path, pendingId, count }`, `attempts.{partId} = { startedAtMs, deadlineMs, finishedAtMs, recording, segmentSeq, recordingDeletedAtMs?, uploadAttempts, pending{}, slots{} }` |
| `training-candidates/{emailHash}` | The person: `name` (set once) |
| `training-codes/{emailHash}` | `codeHash` (HMAC), `expiresAtMs`, `attempts`, `sentAtMs` |
| `training-rate/{scope}_{hash}` | Fixed-window abuse counters |

`expiresAt` is written on codes and rate docs for a TTL policy (**not configured**; nothing depends on it — expired codes are rejected in code). Indexes: none composite. `attempts`, `email`, `screenChecks` and `parts` are exempted from indexing (rule 9). Participant reads are two single-field queries (`sessionId ==` for the admin roster, `emailHash ==` for a candidate), plus batched `getAll`s for names and sessions — never N+1.

## Storage

```
training/sources/{sessionId}/{partId}/{imageId}.{jpg|png|webp}   ← original, as uploaded
training/sources/{sessionId}/{partId}/{imageId}_thumb.webp       ← 480px preview, made in the admin's browser
training/submissions/{sessionId}/{emailHash}/{partId}/{slotId}-{uploadId}.{ext}
training/recordings/{sessionId}/{emailHash}/{partId}/seg-{NNNNNN}.{webm|mp4}  ← screen recording, ~10 s each
training/recordings/{sessionId}/{emailHash}/{partId}/check-{id}.jpg           ← the screen-check still
```

Nothing is public. Reads are v4 signed URLs anchored to a 30-minute window (so repeated reads return byte-identical URLs and the browser cache holds; same trick as the application review queue), valid at least 90 minutes; the originals are signed as `attachment` so a click saves rather than opens.

## The clock is the server's

- **Start** is a transaction: refuses before `opensAtMs`, after `closesAtMs`, while another part is running, or while the part has fewer source images than the task picks (2 for ID Swap). It writes `deadlineMs = now + durationMs` **once**. A second Start (a double tap, a second tab) returns the attempt already running. A refresh or closing the page does not move it.
- Every response carries `nowMs`; the browser holds `skew = serverNow − deviceNow` (`useServerClock`) and renders `deadline − (now + skew)`. A wrong device clock cannot add or remove time.
- A part's state is **derived on read** from the attempt and the clock (`derivePartState`): `scheduled` → `not-ready`/`open` → `in-progress` → `submitted` | `timed-out`, or `missed` if the session closed first. There is no cron: nothing flips a flag at the deadline.
- **"The page is closed" means locked.** A script cannot close a tab it did not open. At zero the task room disables every input and, once no upload is still travelling, hands over to the part's overview ("Time's up. N of 4 edits uploaded and saved."). The server enforces the same boundary regardless of what the page does.

### Uploads

`upload-url` → direct `PUT` to Storage → `finalize` (rule 9i: bytes never cross a function).

- The URL's lifetime is **capped at `deadline + 30 s`** (`UPLOAD_GRACE_MS`), so one minted in the last minute cannot be used long after. The path is server-chosen and the content type is pinned into the signature. `MAX_UPLOAD_ATTEMPTS` (40) bounds swap-and-retry per attempt.
- `finalize` trusts nothing: the object must exist at the server-chosen path, be ≤ 25 MB, carry the declared type, **start with that type's magic bytes** (a 16-byte range read, not a download), and have a `timeCreated` ≤ `deadline + grace`. A rejected object is deleted. The call itself is honoured up to 5 minutes after, for a retry on a flaky line.
- **The picked images are derived, never stored as a field.** A slot records its source; `finalize` rejects a third distinct source or a third edit from one source. Replacing a slot deletes the old object.
- **Size is checked after the fact.** A V4 signed URL cannot pin a maximum size without `x-goog-content-length-range`, which would also need adding to the CORS policy. An oversized object is deleted at `finalize`; it can briefly exist in the bucket.

### Source images

The source images are the admin's to attach (Session page → Parts), **as many as they like** (at most 500 per part, only because the list lives in the session document). A part needs at least as many as the task picks (`pickCount`, 2 for ID Swap) before a candidate can start it; the candidate then chooses their own from however many there are. They are signed for a candidate **only while the attempt is in progress** — never on the briefing — Images can be **added at any time**; they are removed, and the part's open time changed, only until someone has **started** the part (a running attempt depends on both) — not merely until it opens, which would strand an admin who opened a part before attaching images.

## Screen recording

Every attempt started since recording shipped is **screen-recorded**, and an admin can watch it live (about one segment, ~10–20 s, behind) and replay it afterwards. `/training` runs in the candidate's own browser, not the Electron shell, so the capture is the browser's `getDisplayMedia` — which needs a click every time and cannot be started silently.

**The share.** Whole screen only: the track's `displaySurface` must be `monitor` (where the browser does not report it, the capture must have the screen's aspect ratio), and a frame must not be blank — a Mac whose browser lacks Screen Recording permission can hand back a black stream. Capture is capped at 1920×1200, ~5 fps, ~0.8 Mbps (`recording.ts`): segments share the candidate's line with their edit uploads, and bitrate is how fast Storage grows. `surfaceSwitching: 'exclude'` removes Chrome's "share this tab instead", which would switch surface mid-test with no event to catch. **Not detectable:** a second monitor — a candidate can share one screen and work on another. The admin sees the recording; that is the check. Phones and tablets have no `getDisplayMedia`, so the test is desktop-only, and the screen check says so.

**Before Start — the screen check (`ScreenCheck`).** Share → a live preview → the browser grabs a JPEG still → `screen-check` `{action:'sign'}` → direct PUT → `{action:'confirm', checkId}`, which proves the object is a real JPEG created in the last few minutes and records `screenChecks.{partId}.atMs`. The candidate must also tick that the preview shows their whole screen, including other apps' windows — a Mac without permission can share the wallpaper alone, which no automated test can tell apart. **Start refuses** without a check from the last `SCREEN_CHECK_TTL_MS` (10 min); the browser redoes an aged check itself before calling Start. A page loaded before this shipped never runs a check, so Start's refusal tells it to refresh.

**During — segments.** `ScreenRecorder` records standalone ~10 s files: each is a **new** `MediaRecorder` (chunks after a recorder's first have no header), rotated on the recorder's own `timeslice` event rather than a timer — the candidate is in their editing app, and a background tab's timers are throttled to once a minute. `recording` signs `SEGMENT_BATCH` (6) PUT URLs per call, so one call covers a minute (rule 9i). Sequence numbers come from `attempts.{partId}.segmentSeq`, so a segment can never overwrite another; **a reopen continues the counter** instead of resetting it. Every URL dies at `min(deadline, session end) + grace`, like the edit uploads'. Segments upload one at a time, retried with backoff; up to ~10 minutes queue while a line is down, oldest dropped first. **Nothing is written to Firestore per segment** — the folder is the record.

**The lock.** If the share stops ("Stop sharing" in the browser bar) or the page is refreshed mid-attempt (a share never survives a reload, and only a click can start another), `ScreenLock` covers the task room (`inert` beneath it) until they share again. **The clock does not pause** — pausing would make stopping the share a way to buy time. The server enforces it on its own: `upload-url` refuses an edit upload while the newest segment in Storage is older than `RECORDING_STALE_MS` (90 s, generous for a slow line). A failed Storage listing fails **open** — a storage hiccup must not lock an honest candidate out.

**Only attempts that carry `recording: true` are gated.** Start sets it (and `segmentSeq: 0`); a reopen sets it too. Attempts already running when this shipped, or started from an old bundle, never had it and are never refused.

**Admin — `RecordingPlayer`.** In the session page's submission dialog, and behind a **Watch live / Screen recording** button per part in the Candidates panel (one player at a time). `GET …/participants/{emailHash}/recording?part=` lists the folder (`getFiles`) and signs each segment with the window-anchored `signRead`; `&after=<seq>` (Storage `startOffset` — the names are zero-padded, so lexical is chronological) returns only newer ones, and the live view polls with it every 10 s while the window is visible and for a minute after the part ends (the last segment lands in the grace). Two `<video>` elements take turns so the hand-over between files does not flash. **Gaps are derived on read** (`recordingGaps`) from segment times and drawn red on a coverage strip with "No recording for 2m 10s from about 14:03". Segment times are Storage's `timeCreated` (upload end), so positions are labelled "about".

**Retention is manual.** **Delete recording** (confirmed) removes the folder and the check still and stamps `recordingDeletedAtMs`; refused while the part is running or inside the upload grace. Uploaded work is untouched. Nothing deletes recordings automatically.

**Known limits.** The upload gate proves a file arrived recently, **not that it is real video of the screen** — a scripted candidate could keep it open with junk segments; only the admin watching the playback catches that. A reopen hides any gap at the end of the first run (`recordingGaps` cannot tell where that run ended). A segment PUT cannot pin a maximum size (same reason as edits: `x-goog-content-length-range` would need the CORS policy), so a hostile candidate could upload oversized segments until their deadline; `MAX_SEGMENTS_PER_ATTEMPT` bounds the count. The `video/webm`/`video/mp4` content type is pinned in the signature, so the PUT must send exactly that header (not `MediaRecorder`'s `;codecs=` variant).

## Modules

`src/lib/training/modules.ts` is the whole definition: change a part's wording or length by deploying. A session records only its module and each part's open time; an attempt copies its own deadline at Start, so a deploy never changes a running clock.

Adding a module means: an id in `TrainingModuleId`, an entry in `TRAINING_MODULES`, a route folder `src/app/training/<path>/page.tsx` rendering `ModuleView`, and — if its task is not an ID swap — a new `task.kind` with its own `TaskRoom` variant. `TaskRoom` is the ID-swap room today.

## The admin page

`Admin Portal → Training` (page permission `training`, tier 2: a candidate is not part of the employee auth graph, so these routes grant no account and change no claim). **Turn it on from Sharing, not from `/api/admin/init`.** A page with no `page-permissions` doc grants nobody (fail-closed). Ticking a group for Training on `/admin-portal/sharing` creates the doc and recomputes that group's `permittedPageIds` immediately, so the sidebar updates at once. `init`/`seed` creates the doc for the admin group but does **not** recompute anyone's `permittedPageIds` — admins then wait for the 03:00 UTC sync (or run `repair-permissions.js --fix`, see [permissions.md](permissions.md)).

- **Two tabs** (the console's `Tabs`, Sessions by default). **Sessions** is the list below. **Candidates** is every person across every session in one table — name or email, a status badge with what it is about under it, sessions, parts done (`N of M`), last activity — most pressing first (a live clock, then something to start, then what is coming, then what ended; removed last), with a search box. The status is the state of their most pressing part (`listCandidates`; the same `derivePartState` as everywhere, so a reopened candidate reads correctly). The whole row opens a side **panel** (the list stays behind it) with every session they have been on, newest first, each part's state and timeline, and their work laid out beside the images they started from (`SubmissionSlots`, shared with the single-part dialog). The tab is read when first opened (one scan of `training-participants`, capped at 2000 documents, plus one batched read each of sessions and names) and is never polled; the panel reads one candidate on open (`emailHash ==`).
- **List:** sessions with people, first open, access end and status (Upcoming / Running / Closed).
- **New session:** name, module, a pasted list of emails (validated and de-duplicated; invalid ones are named, never silently dropped), when each part opens, when access ends (follows the last open + 48 h until set).
- **Session page** (refreshes every 60 s, only while the window is visible, access has not ended, and someone is mid-attempt or a part opens within 5 minutes): schedule and access end (a part's open time is fixed once anyone has started it), the source images (3 uploads at a time), a participant × part table of state badges that opens each candidate's work (their edit beside the image it started from), **Stop session** (confirmed; ends the test now for everyone, including anyone mid-attempt — it just sets `closesAtMs = now`, so every guard already honours it, a running attempt ends where it stands, uploaded work is kept, uploads already travelling get the 30 s grace; set a later "Access ends" to reopen), a per-candidate **Reopen** on any ended part (timed out, submitted or missed), **Add people**, **Remove** (access stops on the next request; work is kept; **Restore** re-adds), and **Copy link**.
- Times are entered and shown in the **viewer's** timezone (rule 9g) via `zonedTime.ts`, not the browser's.
- It is **view only**: no scoring, notes or shortlist yet.

### Reopening one candidate

`reopenParticipant` gives one candidate a **fresh full clock on the same attempt** — their uploads are kept, `finishedAtMs` is cleared, `deadlineMs = now + durationMs`, the upload-attempt counter and pending uploads reset — or, for a part they never started, simply lets them Start it. It also sets `accessUntilMs = now + 24 h` on the **participant**, because the session may well have ended: `sessionFor(participant, session)` substitutes that for the session's `closesAtMs` everywhere access is judged (sign-in, `/me`, start, upload, finalize, state derivation). A **Stop pressed after the reopen** ends them again (`session.stoppedAtMs > participant.reopenedAtMs`); one pressed before it does not. Refused while the part is genuinely running, or while another of their parts is, and for a removed person (Restore first).

## Abuse model

| Layer | Where | Stops |
|---|---|---|
| Honeypot + 1.2 s minimum fill | `request-code` | Naive scripts (silent `200`) |
| Per-IP and per-address ceilings | `consumeRate` | Volume; the address limit counts requests, not approvals, so it leaks nothing |
| Code: 10 min, 5 guesses, one live code, resend cooldown | `issueCode`/`verifyCode` | Guessing a 6-digit space; the attempt is recorded before the compare, in the same transaction |
| Signed cookie, re-authorised per request | `withCandidate` | Stale access after revoke/close |
| Server clock, capped signed URLs, magic-byte + `timeCreated` checks | `trainingService` | Time-shifting, post-deadline uploads, non-images |
| Screen check before Start; edit uploads refused without a recent segment | `startAttempt`, `requestUpload` | Sitting the test unrecorded |
| `no-store` on every route | all | Caching a clock or a signed URL |
| `noindex`, `NoTranslate` | layout | Discovery; a translator killing a live timed task |

Per-IP limits are sized for a group in one office on one address (60 code requests an hour). **Rules for changing it:** never answer differently for an approved address; never sign a URL past `deadline + grace`; never put a source image in anything the briefing returns; never loosen the Firestore rules.

## Operational notes

- **Deploy the rules and indexes** after any change here: `firebase deploy --only firestore:rules,firestore:indexes`.
- **CORS:** the browser `PUT`s to Storage from `app.bluurock.com` (and the legacy host, redirected for pages). The existing `storage-cors.json` already allows `PUT` for those origins; a new domain must be added there (rule 9i).
- **Email:** needs `RESEND_API_KEY`. A send failure is logged (`[training/request-code]`) and the candidate sees nothing different — check the server log if someone says no code arrived.
- **Retention:** there is no deletion or archive for sessions, candidates or uploads yet. Candidate work and emails are kept until someone removes them from Firestore/Storage. Screen recordings are deleted only by an admin (**Delete recording**); at the capture settings a 20-minute part is roughly 50–120 MB.
- **Invitation:** adding someone does not email them. Copy the link from the session page and send it yourself.
