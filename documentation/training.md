# Training

> The public `/training` surface for **candidates on a trial** (people who may become staff), and the `admin-portal/training` page where admins run sittings. Candidates are not app users: they have no Google account in the `users` allowlist and no Firebase Auth account at all. Read [Identity](#identity-a-third-system-deliberately) before touching sign-in.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/training/modules.ts` | **Code-defined modules and parts** (titles, durations, briefs, the four edit levels) and the limits client and server share |
| `src/lib/training/types.ts` | Wire types (what the browser sees — never hashes or storage paths) |
| `src/lib/services/trainingAuthService.ts` | Signing, email hashing, the cookie, rate limits, one-time codes, candidate names |
| `src/lib/services/trainingService.ts` | Sessions, participants, the attempt and its clock, signed uploads, admin reads, source images |
| `src/lib/middleware/withCandidate.ts` | Guard for the candidate API (the analogue of `withAuth`) |
| `src/app/api/training/**` | Candidate API (cookie): `request-code`, `verify-code`, `logout`, `me`, `name`, `modules/[moduleId]`, `sessions/[sessionId]/parts/[partId]` + `start` `upload-url` `finalize` `finish` |
| `src/app/api/admin/training/**` | Admin API (`training` page permission): sessions, participants, one candidate's work, source images |
| `src/app/training/**` | The candidate UI: gate, home, `media-gen`, `_components/` (`Countdown`, `TaskRoom`, `ModuleView`, …), `_lib/theme.ts` |
| `src/app/(main)/admin-portal/training/**` | The admin list and session pages |
| `src/components/admin/training/**`, `src/hooks/useTrainingAdmin.ts` | Admin dialogs, the source-image uploader, `zonedTime.ts`, the data hook |
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
| `training-participants/{sessionId}_{emailHash}` | `email`, `addedAtMs`, `revokedAtMs`, `attempts.{partId} = { startedAtMs, deadlineMs, finishedAtMs, uploadAttempts, pending{}, slots{} }` |
| `training-candidates/{emailHash}` | The person: `name` (set once) |
| `training-codes/{emailHash}` | `codeHash` (HMAC), `expiresAtMs`, `attempts`, `sentAtMs` |
| `training-rate/{scope}_{hash}` | Fixed-window abuse counters |

`expiresAt` is written on codes and rate docs for a TTL policy (**not configured**; nothing depends on it — expired codes are rejected in code). Indexes: none composite. `attempts`, `email` and `parts` are exempted from indexing (rule 9). Participant reads are two single-field queries (`sessionId ==` for the admin roster, `emailHash ==` for a candidate), plus batched `getAll`s for names and sessions — never N+1.

## Storage

```
training/sources/{sessionId}/{partId}/{imageId}.{jpg|png|webp}   ← original, as uploaded
training/sources/{sessionId}/{partId}/{imageId}_thumb.webp       ← 480px preview, made in the admin's browser
training/submissions/{sessionId}/{emailHash}/{partId}/{slotId}-{uploadId}.{ext}
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

The source images are the admin's to attach (Session page → Parts), **as many as they like** (at most 500 per part, only because the list lives in the session document). A part needs at least as many as the task picks (`pickCount`, 2 for ID Swap) before a candidate can start it; the candidate then chooses their own from however many there are. They are signed for a candidate **only while the attempt is in progress** — never on the briefing — and cannot be removed once a part has opened.

## Modules

`src/lib/training/modules.ts` is the whole definition: change a part's wording or length by deploying. A session records only its module and each part's open time; an attempt copies its own deadline at Start, so a deploy never changes a running clock.

Adding a module means: an id in `TrainingModuleId`, an entry in `TRAINING_MODULES`, a route folder `src/app/training/<path>/page.tsx` rendering `ModuleView`, and — if its task is not an ID swap — a new `task.kind` with its own `TaskRoom` variant. `TaskRoom` is the ID-swap room today.

## The admin page

`Admin Portal → Training` (page permission `training`, tier 2: a candidate is not part of the employee auth graph, so these routes grant no account and change no claim). **Turn it on from Sharing, not from `/api/admin/init`.** A page with no `page-permissions` doc grants nobody (fail-closed). Ticking a group for Training on `/admin-portal/sharing` creates the doc and recomputes that group's `permittedPageIds` immediately, so the sidebar updates at once. `init`/`seed` creates the doc for the admin group but does **not** recompute anyone's `permittedPageIds` — admins then wait for the 03:00 UTC sync (or run `repair-permissions.js --fix`, see [permissions.md](permissions.md)).

- **List:** sessions with people, first open, access end and status (Upcoming / Running / Closed).
- **New session:** name, module, a pasted list of emails (validated and de-duplicated; invalid ones are named, never silently dropped), when each part opens, when access ends (follows the last open + 48 h until set).
- **Session page** (refreshes every 60 s, only while the window is visible, access has not ended, and someone is mid-attempt or a part opens within 5 minutes): schedule and access end (a part that has opened keeps its time), the source images (3 uploads at a time), a participant × part table of state badges that opens each candidate's work (their edit beside the image it started from), **Add people**, **Remove** (access stops on the next request; work is kept; **Restore** re-adds), and **Copy link**.
- Times are entered and shown in the **viewer's** timezone (rule 9g) via `zonedTime.ts`, not the browser's.
- It is **view only**: no scoring, notes or shortlist yet.

## Abuse model

| Layer | Where | Stops |
|---|---|---|
| Honeypot + 1.2 s minimum fill | `request-code` | Naive scripts (silent `200`) |
| Per-IP and per-address ceilings | `consumeRate` | Volume; the address limit counts requests, not approvals, so it leaks nothing |
| Code: 10 min, 5 guesses, one live code, resend cooldown | `issueCode`/`verifyCode` | Guessing a 6-digit space; the attempt is recorded before the compare, in the same transaction |
| Signed cookie, re-authorised per request | `withCandidate` | Stale access after revoke/close |
| Server clock, capped signed URLs, magic-byte + `timeCreated` checks | `trainingService` | Time-shifting, post-deadline uploads, non-images |
| `no-store` on every route | all | Caching a clock or a signed URL |
| `noindex`, `NoTranslate` | layout | Discovery; a translator killing a live timed task |

Per-IP limits are sized for a group in one office on one address (60 code requests an hour). **Rules for changing it:** never answer differently for an approved address; never sign a URL past `deadline + grace`; never put a source image in anything the briefing returns; never loosen the Firestore rules.

## Operational notes

- **Deploy the rules and indexes** after any change here: `firebase deploy --only firestore:rules,firestore:indexes`.
- **CORS:** the browser `PUT`s to Storage from `app.bluurock.com` (and the legacy host, redirected for pages). The existing `storage-cors.json` already allows `PUT` for those origins; a new domain must be added there (rule 9i).
- **Email:** needs `RESEND_API_KEY`. A send failure is logged (`[training/request-code]`) and the candidate sees nothing different — check the server log if someone says no code arrived.
- **Retention:** there is no deletion or archive for sessions, candidates or uploads yet. Candidate work and emails are kept until someone removes them from Firestore/Storage.
- **Invitation:** adding someone does not email them. Copy the link from the session page and send it yourself.
