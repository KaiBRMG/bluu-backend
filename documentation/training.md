# Training

> The public `/training` surface for **candidates on a trial** (people who may become staff), and the `admin-portal/training` page where admins run them. Candidates are not app users: they have no Google account in the `users` allowlist and no Firebase Auth account at all. Read [Identity](#identity-a-third-system-deliberately) before touching sign-in.
>
> **The model (rebuilt 2026-10):** a **module** is a switch an admin turns on and off. A module holds **tests** that the admin opens **one at a time**. Each candidate starts their **own** clock on the open test. Test materials (identity datasets, source images) come from a **Google Drive shared drive**, and what candidates hand in is mirrored back to it. There are no sessions and no schedule: the earlier session/part model was dropped, with its data, before any real candidate had sat it.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/training/modules.ts` | **Code-defined modules, tests and slots** — the briefing copy (structured), durations, budgets, dataset rules, final-image slots, each test's Drive folders, the module explainer, and every limit client and server share |
| `src/lib/training/types.ts` | Wire types (what the browser sees — never hashes, storage paths or Drive ids) |
| `src/lib/training/model.ts` | The Firestore document shapes and the **state derivation** (`deriveTestState`, `clockEndMs`, `candidateContext`) |
| `src/lib/training/drive.ts` | Training's side of Google Drive: where materials live, the manifest, `checkDrive` / `planSync` / `syncFile`, and the Open gate (`materialsProblems`) |
| `src/lib/training/mirror.ts` | The Storage → Drive mirror: folders under a lease, `mirrorFile`, `mirrorRecord`, `sweepMirrors` |
| `src/lib/training/storage.ts` | Signing (window-anchored reads, expiring reads, writes), magic-byte sniffing, per-attempt Storage paths |
| `src/lib/training/recording.ts` | **Screen recording** limits (segment length, batch, staleness, capture settings), segment naming, `recordingGaps` — shared by browser, API and player |
| `src/lib/training/fileName.ts` | `cleanFileName` — a candidate's file name made safe for display and the Drive copy's name |
| `src/lib/google/drive.ts` | The **generic** Drive client (server-only, shared by every subsystem) — see [architecture-overview.md](architecture-overview.md#4-environment-variables) |
| `src/lib/services/trainingAuthService.ts` | Signing, email hashing, the cookie, rate limits, one-time codes, candidate names |
| `src/lib/services/trainingService.ts` | Module switch, test open/close, roster, the attempt and its clock, signed uploads, T4 identity picks, T7 windows, admin reads |
| `src/lib/services/trainingRecordingService.ts` | The screen check, recording segments, the admin recording read/delete |
| `src/lib/middleware/withCandidate.ts` | Guard for the candidate API (the analogue of `withAuth`) |
| `src/app/api/training/**` | Candidate API (cookie): `request-code`, `verify-code`, `logout`, `me`, `name`, `modules/[moduleId]`, `modules/[moduleId]/tests/[testId]` + `start` `upload-url` `finalize` `finish` `screen-check` `recording` `text` `identity` `answer` `sequence` `sequence/ready` `datasets` |
| `src/app/api/admin/training/**` | Admin API (`training` page permission): `modules`, `modules/[moduleId]` (GET detail, PATCH the switch), `…/tests/[testId]` `check` `prepare` `prepare/file` `open` `close`, `…/participants` (+ `[emailHash]` `reopen` `recording` `submission` `mirror`) |
| `src/app/api/cron/training-mirror` | The daily retry of the Drive mirror (Vercel Cron, `CRON_SECRET`) |
| `src/app/training/**` | The candidate UI: gate, home, `media-gen`, `_components/` (`ModuleView`, `EditRoom`, `SequenceRoom`, `Brief`, `DatasetModal`, `SlotUploader`, `WorkingFiles`, `TaskRecord`, `Countdown`, `ScreenCheck`, `ScreenLock`, …), `_lib/` (`theme`, `screenCapture`, `useScreenShare`, `useRoomGuards`, `useTabTitle`, `upload`) |
| `src/app/(main)/admin-portal/training/**` | The admin module list and the module page |
| `src/components/admin/training/**`, `src/hooks/useTrainingAdmin.ts` | `ModuleAdmin`, `TestsStrip` (Open/Close/Check Drive), `Roster`, `CandidateSheet`, `SubmissionSlots`, `RecordingPlayer`, `AddPeopleDialog`, `AdminStateBadge`, the data hooks |
| `src/lib/email/templates.ts` → `trainingCodeEmail` | The sign-in code email (copy lives only here) |
| `src/lib/definitions.ts` | Page `training` in the Admin Portal teamspace (icon `GraduationCap`) |
| `src/middleware.ts` | `/training` is browser-allowlisted |
| `firestore.rules`, `firestore.indexes.json`, `tests/firestore-rules/…` | §21a: every collection `if false`; index exemptions |

## Identity: a third system, deliberately

The project already keeps employees (Google, the `users` allowlist) and creators (Telegram) on separate identity systems that never share a uid. Candidates are neither, and a third Firebase Auth population would put strangers in the table the allowlist protects. So:

1. An admin adds an **email address** to a module.
2. The candidate enters it at `/training`; **if and only if it is on a module that is switched on** a 6-digit code is emailed (Resend, `hello@bluurock.com`).
3. The code (10 min, 5 guesses, 45 s resend cooldown) is exchanged for an **HMAC-signed httpOnly cookie** (`__Host-training` in production, 7 days, `SameSite=Lax`) that names the address's **hash**.

The cookie is an **identity, not an authorisation**. Every request re-derives access from Firestore (participant exists, not revoked, module on), so an admin removing someone, or switching the module off, bites on the very next call.

- **No enumeration.** `request-code` answers the same `{ ok: true }` whether or not the address is approved; the lookup and send run in `after()` so the two cases also take the same time. `verify-code` has one failure message. The code step's copy ("If … has been approved, we have sent …") reads identically either way.
- **A resend repeats the code; it does not rotate it.** The code is derived (HMAC) from a nonce on the doc, so nothing recoverable is stored and a hostile request just re-delivers the candidate's own code instead of invalidating the one in their inbox. A new code is minted only when none is live (expired, spent by five wrong guesses, or used). Known limit: anyone can still burn a live code with five wrong guesses; the candidate requests another.
- **Why a code and not email alone.** The task is one timed attempt. With email alone, anyone who knew a candidate's address could start their clock and burn their only attempt. The code proves they hold the inbox.
- **Keys.** `TRAINING_SECRET` if set, otherwise derived from `FIREBASE_SERVICE_ACCOUNT` under `training/v1`. Setting it later invalidates every open cookie and code. Emails are stored as typed (for display) with an HMAC of `normalizeEmail()` as the key — `J.Doe+x@gmail.com` and `jdoe@gmail.com` are one candidate.

## Modules, tests, and the two switches

Both switches are the admin's, and both are enforced on the **server**:

```
Module:   OFF ───switch on───► ON ───switch off───► OFF        (off = hard stop)

Test (admin):   closed ──Open──► preparing ──files copied──► open ──Close──► closed
                                  (Drive → Storage diff)         (no new Starts; running finish)

Attempt (candidate, while the test is open):
   locked → briefing → [screen check] → Start → in-progress → submitted | timed-out
                                                     ↑ Reopen (admin)
   A test that closed before the candidate pressed Start → missed
```

- **The module is on or off.** With it off nobody is sent a code (`isApproved` is false), and every running attempt **ends where it stands**: `clockEndMs` is `min(deadline, switchedOffAtMs)` when the switch-off came during that run. Uploaded work is kept, and uploads already travelling get the grace. Switching it off also closes the open test.
- **One test is open per module at a time.** Opening T2 needs T1 closed; the server refuses otherwise (`beginPrepare` and `openTest`), and the page says "Close T1 first". A candidate can only run one attempt at a time anyway.
- **Closing a test only stops new Starts.** A clock already running finishes.
- **Each test is sat once; Reopen is the escape hatch.** `reopenParticipant` gives a **fresh full clock on the same attempt** — uploads kept, `finishedAtMs` cleared, `deadlineMs = now + duration`, the upload counter and pending uploads reset, `segmentSeq` left alone so the new run's segments continue after the old. It needs the module on, refuses while a test of theirs is genuinely running, and refuses a removed person (Restore first). A candidate who never started a test cannot be reopened: open the test and they can Start it.
- **State is derived on read** (`deriveTestState`) from the module doc, the test's status, the attempt and the clock — there is no cron at a deadline. States: `locked` (never opened, or being prepared) · `open` · `in-progress` · `submitted` · `timed-out` · `missed` (the test closed before they started).
- **A test carrying `pending` entries in `modules.ts` cannot be opened** (`beginPrepare` refuses). It is the mechanism for known problems with draft copy that need a decision; no test carries any today.

### What a candidate sees

`/training/media-gen` shows the module explainer (always reachable), the run of tests T1–T7 with a state chip and one action each, and the briefing for the open test. The briefing carries **no images of any kind** — time, budget, deliverables, datasets by name, the rules, the screen check and Start. After Start the full brief, the source images, a **Datasets** modal, the final-image slots, working files and the task record appear. The page watches for a test opening with **one `no-store` request every 15 s**, only while nothing is running and the tab is visible; it reads two documents (`getModuleForCandidate`), not the all-modules query `/me` runs.

**Getting in and out of the room** (the details are DESIGN.md §11):

- **Home is skipped when a candidate has exactly one module** — they land on it. The module page's "Your training" link goes to `/training/home?list=1`, the only way to see the list.
- **Start says what is missing.** The button is `aria-disabled` (focusable) and a status line names the next step: share the screen → let the check finish → tick the confirmation. The gate says up front that the tests are timed and need a computer; the code step and the briefing each carry a "contact whoever invited you" line (a line that does not reveal whether an address was approved).
- **Nothing is lost silently.** `useRoomGuards` refuses a file dropped outside an open drop zone (`data-dropzone="on"`) and asks before the tab is closed or refreshed. A failed working file keeps its `File` for **Retry** and can be **Removed**. T7 only says "Saved" when the answer POST succeeded; it retries once at the window's end and again every 4 s while the window is open, and the hold line says so when it still failed.
- **The room waits on the task record.** `TaskRecord` reports whether its latest text has reached the server; at zero the hand-over waits for it (capped at `UPLOAD_GRACE_MS`, the server's window for the text), and Finish early waits up to 8 s for it. If it never landed, the result block says so.
- **The end is a block, not a line.** `ModuleView` shows what ended, how many finals are saved, whether the recording is still flushing, and what comes next, with focus on its heading. One page-level live region (above every branch, so it survives the room unmounting) announces it. The tab title carries the clock (`useTabTitle`) and an open test.

The full brief text is in the client bundle (`modules.ts` is shared), so a candidate who reads the JavaScript can read a later test's wording early. That is accepted: the **images** are what is gated, and they are never signed outside an in-progress attempt.

## Firestore (all Admin-SDK-only, `read, write: if false`)

| Collection | Contents |
|---|---|
| `training-modules/{moduleId}` | `isOn`, `switchedOnAtMs`, `switchedOffAtMs`, `openTestId`, `participantCount`, `tests.{testId} = { status: closed\|preparing\|open, openedAtMs, closedAtMs, materialsVersion }`. A module with no doc is off |
| `training-participants/{moduleId}_{emailHash}` | `moduleId`, `email`, `addedAtMs`, `revokedAtMs`, `reopenedAtMs?`, `mirrorPending?`, `screenChecks.{testId}`, `attempts.{testId} = { attemptId, startedAtMs, deadlineMs, finishedAtMs, reopenedAtMs?, recording, segmentSeq, uploadAttempts, pending{}, slots{}, workingFiles{}, text, textUpdatedAtMs, answers?{} (T7), datasetChoices?{} (T4), drive* }` |
| `training-candidates/{emailHash}` | The person: `name` (set once) and `driveFolders.{moduleId}` (their Drive folder id) |
| `training-materials/{moduleId}_{key}` | The Drive manifest — see [Google Drive](#google-drive) |
| `training-codes/{emailHash}` | `codeHash` (HMAC), `expiresAtMs`, `attempts`, `sentAtMs` |
| `training-rate/{scope}_{hash}` | Fixed-window abuse counters |

`expiresAt` is written on codes and rate docs for a TTL policy (**not configured**; nothing depends on it). **Indexes:** no composite. `attempts`, `email`, `screenChecks` (participants), `tests` (modules), `files` and `pending` (materials) and `driveFolders` (candidates) are **exempted from indexing** (rule 9). The queries are `moduleId ==` (the roster), `emailHash ==` (one candidate's participations), `mirrorPending == true` (the sweep) — all single-field — plus batched `getAll`s. The module's `participantCount` is kept on its doc so listing modules needs no count query.

## Storage

```
training/materials/{moduleId}/datasets/{IDENTITY}/{driveId}-{md5}.{ext} (+ _thumb.webp)   ← synced from Drive
training/materials/{moduleId}/sources/{key}/{driveId}-{md5}.{ext} (+ _thumb.webp)
training/submissions/{moduleId}/{emailHash}/{testId}/final/{slotId}-{uploadId}.{ext}
training/submissions/{moduleId}/{emailHash}/{testId}/work/{uploadId}                          ← any type, served as a download
training/recordings/{moduleId}/{emailHash}/{testId}/seg-{NNNNNN}.{webm|mp4}, check-{id}.jpg
```

Nothing is public. Reads are v4 signed URLs anchored to a 30-minute window (so repeated reads return byte-identical URLs and the browser cache holds), valid at least 90 minutes; originals and working files are signed as `attachment` so a click saves rather than opens. The checksum is in a material's file name, so a changed Drive file is a **new path** and no cache can show the old bytes under the same address.

## Google Drive

Materials live in the shared **Bluu-Backend** drive; results are mirrored back. The generic client is `lib/google/drive.ts`; this section is Training's use of it.

```
Training/
  Media-Gen/                       ← the module's `driveFolder`
    Datasets/{ADAM,COLE,JACKSON,JOE}      15–30 images each
    Source Media/T1 … T7                   T6: "#1 CANDID SFW", "#2 TEASY", "#3 EXPLICIT"; T7: 10 images
    Submissions/<Candidate name>/T{n}_<attemptId>/
        Final Images/   T1 - 001.png …      ← the name the SERVER chose
        Working Files/  …as uploaded
        Task record.txt                     ← T7: Answers.txt
```

Folders below the drive root are resolved by name **once**; their ids are then kept (the manifest holds `driveFolderId`, the candidate doc `driveFolders`, the attempt its three folder ids) and the names are never searched again. Renaming a folder in Drive afterwards is harmless; deleting one makes the next call re-resolve.

### Materials: Drive → Storage, at Open

A candidate is never served from Drive: Open copies each file into Storage and a candidate reads signed Storage URLs. That keeps Drive's per-minute quota off the candidate path and means a file edited in Drive mid-test cannot change under someone's hands (**materials freeze while a test is open**; edit Drive, then close and re-open).

- **The manifest** `training-materials/{moduleId}_{key}` (keys `dataset_JOE`, `source_T1`, `source_T6_sfw`) holds, per Drive file, the checksum it was copied at and where it went. Open **diffs** the folder against it (`driveId + md5Checksum`) and copies only what is new or changed, deleting what was removed — no difference means no refetch. **Datasets are keyed by identity, not test**, so opening T2 after T1 re-lists JOE and copies nothing.
- **The copy is driven by the client, one file per call**, because a test is ~120 files. `POST …/prepare` (`beginPrepare` marks the test `preparing`, then `planSync` diffs and writes the to-do list into each manifest's `pending`) returns the list; the page calls `…/prepare/file` once per entry (`23 / 41 files`); then `…/open`. `syncFile` **refuses any Drive id that is not pending**, so the route cannot be used to make the server fetch an arbitrary Drive file, and the key must belong to the test. Each file is downloaded, its **MD5 checked against Drive's**, its type **sniffed from the bytes** (not trusted from Drive's label), a 480px WebP thumbnail made, and both stored.
- **Open is enforced on the server.** `openTest` runs `materialsProblems` (Firestore only): every manifest complete, and the folders **cover what the test asks** — each edit slot has a source whose file name carries its number (`0013.png`, `013.jpeg` and `13.jpg` all mean code `013`), no duplicate numbers, every T6 tier has images, T7 holds exactly 10, every dataset is non-empty. It also needs the module on and nothing else open. An abandoned prepare leaves the test `preparing`; pressing Open again **resumes** (the diff is idempotent).
- **Check Drive** is a dry run of the same diff (added / changed / removed per folder, skipped files with a reason, coverage problems). It writes nothing and reads Drive, so it is an admin's deliberate click, never a poll.
- Drive's Google-native files (`application/vnd.google-apps.*`) are skipped — they have no checksum and cannot be downloaded — and a materials folder holds at most 200 images.

### Results: Storage → Drive, after each upload

`finalize` validates the object as always, then in `after()` streams it Storage → Drive with a **resumable** upload (`maxDuration = 300`; the candidate's response does not wait). Storage is the record; **Drive is a copy**. A failed copy never fails the upload: it is marked `failed`, shown on the roster in words ("Drive copy failed") with a **Retry** in the candidate sheet, and retried by the daily sweep.

- **Folders are created under a Firestore lease** on the attempt (`ensureFolders`): Drive allows duplicate names, so two finalizes landing together would otherwise each create a `T1_x`. The loser waits and reads the ids the winner wrote. The candidate folder is the cleaned name; a **same-named candidate gets a short hash suffix**.
- **Naming is the server's.** A slot's copy is `T1 - 001.png`; on T4 the chosen identity is appended (`T4 - 013 - Cole.png`). A working file keeps its (cleaned) original name.
- **A replaced slot** trashes the old Drive copy (`trashFile`: the trash, never a delete), and the result of a copy is recorded only if the slot **still holds the object that was copied** — otherwise the stray Drive file is trashed.
- **The task record** (`Task record.txt`, or T7's `Answers.txt`) is written when the attempt ends: `finish` (early finish, or the room's "time ran out" cue) calls `mirrorRecord`, which skips when Drive already holds the same text (hashed) and otherwise trashes the previous copy and writes a new one.
- **The sweep** (`GET /api/cron/training-mirror`, 03:30 UTC, `CRON_SECRET`, fail-closed) reads `mirrorPending == true` — a flag kept on the participant, so it is one query — retries any copy still pending or failed after 10 minutes, and writes the record of any attempt that has ended. Capped at 40 participants a run.
- Storage → Drive is function egress, not CDN↔origin traffic, so it is not the Fast Origin Transfer bill; it does use function time, which is why it runs in `after()`.

## The clock is the server's

- **Start** is a transaction: refuses unless the test is the open one, the module is on, another attempt is not still running (or inside its grace), or the screen check is stale. It writes `deadlineMs = now + durationMs` **once**. A second Start (a double tap, a second tab) returns the attempt already running; it returns the test, source images included, so the room opens on a running clock. A refresh or closing the page does not move it.
- Every response carries `nowMs`; the browser holds `skew = serverNow − deviceNow` (`useServerClock`) and renders `deadline − (now + skew)`. A wrong device clock cannot add or remove time.
- **"The page is closed" means locked.** A script cannot close a tab it did not open. At zero the room disables every input and hands over once nothing is still travelling. The server enforces the same boundary regardless of what the page does.

### Uploads

`upload-url` → direct `PUT` to Storage → `finalize` (rule 9i: bytes never cross a function). Two kinds, one pipeline:

| | Final image | Working file |
|---|---|---|
| Slot | one per required final (`T1 - 001`), named by the server | any number up to 50 |
| Type | JPG / PNG / WebP, **magic bytes proven** at finalize | **any**; signed as `application/octet-stream` always — never the client's value, so we never sign `text/html` on our bucket |
| Size | 25 MB | 250 MB |
| Grace after the clock | 30 s | **10 min** (a 250 MB file started before the deadline must be allowed to finish) |
| Served | inline (signed read) | **always as a download** |

- A URL is minted only while the attempt runs and its lifetime is capped at `min(15 min, clockEnd + grace)`; the path is server-chosen. `MAX_UPLOAD_ATTEMPTS` (120) bounds swap-and-retry per attempt.
- `finalize` trusts nothing: the object must exist at the server-chosen path, be within the size limit, carry the declared type, and have a `timeCreated` ≤ `clockEnd + grace`. A rejected object is deleted. The call itself is honoured for 5 minutes past the grace, for a retry on a flaky line.
- **Size is checked after the fact.** A V4 signed URL cannot pin a maximum size without `x-goog-content-length-range` (which would also need adding to the CORS policy). An oversized object is deleted at `finalize`; it can briefly exist in the bucket.
- **Failures in the room are told apart** (`isRetryable` in `_lib/api.ts`): a dropped line, a busy server (408/425/429/5xx) or a passing conflict (409) is retried — a failed final image offers **Retry** with the file still held, as working files do — while a refusal of the request itself (400/401/403/404/410/413) is not. The task record stops sending once the server refuses an edit for good (time is up, training ended) and says what was kept, instead of retrying forever; a 429 is a quiet resend, not an error. Both rooms show one **offline** banner (`useOnline`, `OFFLINE_TEXT`) rather than a scatter of failed requests, and an unsupported image names its type ("That is a HEIC file").
- **The task record** is autosaved (debounced 1.5 s) through `PUT …/text`, at most 10,000 characters, accepted until the grace after the clock, and throttled server-side (1 write a second).
- **Each final slot is one upload slot**, so a re-upload replaces it (and deletes the old object).

### The tests

`modules.ts` defines T1–T7. `edit` tests pair a source image to each slot **by the number in its file name**; `generate` (T6) has no source to edit; `sequence` (T7) shows images in windows.

- **T2, T3 and part of T5** fix an identity per slot; the slot shows an identity chip that opens the dataset modal on that tab.
- **T4 — the candidate picks per slot, each identity exactly once.** `POST …/identity` stores the pick in `datasetChoices`; choosing an identity already on another slot **swaps** the two. A slot with an upload is **locked** (its identity is part of what was submitted), so a swap that needs to move an uploaded slot is refused ("Cole is already used on 014"). A pick-slot refuses an upload until an identity is chosen.
- **T5** rows carry their correction brief inline (from `SlotDef.correction`).
- **T6** is a 4×3 grid (identity × SFW / Teasing / Explicit) with no arrows. The supplied media sit in their own panel headed **"Inspiration — viewing only"** and have **no download**.
- **The dataset modal** (`GET …/datasets`, only while the attempt runs) is a gallery per identity with per-image download and **Download all**. The zip is **built in the browser** from the signed URLs (`fflate`, stored not deflated), so no bytes cross a function; a file that fails is named with a Retry and the rest still zip. `?identity=` returns one tab's images so opening the modal does not sign every dataset. This **needs the bucket's CORS policy to allow `GET`** (it does — see [Operational notes](#operational-notes)); `<img>` does not, but `fetch()` does.
- **T7 — Spot the Mistake.** Ten windows of 30 s. **A window starts when its image has rendered, not when it is fetched.** `GET …/sequence` *issues* the current image (the first call writes `attempts.T7.windows.{i}.issuedAtMs` in a transaction, so two tabs cannot issue it twice) and returns it signed, with `windowStartsAtMs: null` and `startsByMs = issued + SEQUENCE_READY_CAP_MS` (8 s). The browser decodes and paints it, then `POST …/sequence/ready {index}`; the server stamps `startedAtMs = min(now, startsByMs)` and the 30 s run from there. First ack wins; with no ack the window starts at the cap, so an image that never draws cannot stall the test and a candidate cannot hold one open for more than 8 s. The next window is only issued once the last has ended. **The attempt's `deadlineMs` is therefore not fixed:** it is projected (`start + windows still to run × 30 s`) at each issue (cap assumed) and tightened at each ack while that window is the latest, so the test never ends on a running window — `getSequence` and `markWindowReady` both return it, and a reopen clears `windows` and starts from image 1. `POST …/answer {index, text}` is accepted from the window's start until 30 s + 5 s grace after it. An image's signed URL runs to `startsByMs + 30 s + grace`, so after an early ack it stays valid a few seconds into the next window (≤ 8 s) — the price of signing once, at issue. The order is the Drive file order, the same for everyone. The room auto-submits the draft at zero and fetches the next image; until the ack the numeral waits at 30 ("Starts when it shows") and the field is read-only; an image that fails to draw is asked for again (4 tries). Its clock has **no milestone pulses and no flash**: each window's last 10 s show the `warn` border and the words "10 seconds". There is no early finish. Answers are free text read by an admin — no key, no score.

## Admin page

`Admin Portal → Training` (page permission `training`, tier 2: a candidate is not part of the employee auth graph, so these routes grant no account and change no claim). **Turn it on from Sharing, not from `/api/admin/init`.** A page with no `page-permissions` doc grants nobody (fail-closed). Ticking a group for Training on `/admin-portal/sharing` creates the doc and recomputes that group's `permittedPageIds` immediately; `init`/`seed` creates the doc for the admin group but does **not** recompute anyone's `permittedPageIds` — admins then wait for the 03:00 UTC sync (or run `repair-permissions.js --fix`, see [permissions.md](permissions.md)).

- **List:** one card per module — On/Off, headcount, the open test. The switch itself is on the module page so turning a module off is always done with the running attempts in view.
- **Module page:** if a live re-read fails while data is on screen, an orange band says so ("Couldn’t refresh, so this is the last read") with **Try again** — stale is never shown as current. A header with the **On/Off switch** (turning it off asks for confirmation and names the count: "3 attempts are running and will end now"), **Copy link**, then:
  - **Tests T1–T7**, each with a status in words and one action: **Open** (with `23 / 41 files` progress), **Resume** (an earlier prepare was abandoned, with Cancel), **Close**, or the disabled **"Close T1 first"**. **Check Drive** shows the dry-run diff. A test with `pending` copy problems shows why and cannot be opened.
  - **People:** a full candidates × T1–T7 matrix (a module holds fewer than ~15 candidates, so no pagination). The open test's column is emphasised. A cell shows the state word, the time left while running (written to the DOM once a second, not through React state — a 1 Hz update interrupts navigation, see CLAUDE.md), `N of M uploaded`, and the Drive mirror in words (*Synced* / *Pending* / *Failed*). While the module is **off**, a warning above the roster says people only get sign-in access once it is live. Row actions: **Reopen**, **Remove / Restore**; **Add people** (a person new to a module that is **on** is emailed an invitation naming the module, button to `/training` — sent in `after()`, best-effort; a restore is not re-invited, and while the module is off nobody is, since they could not sign in: the toast says so) (pasted emails, validated; invalid ones are named, never dropped) sits above. Rows keep the order people were added, so a re-read never moves a row under the reader.
  - **Candidate sheet** (click a name): per test the state and timeline, **Watch live / Screen recording** (the same button becomes **Hide recording**), **View work** (each final beside its source, working files as downloads, the task record, T7's answers with their images or **"No answer"**), the **Drive folder** link with a copy button, and **Retry Drive copy** when anything has not reached Drive.

### Live refresh

Every admin view also has a **Refresh** button (`RefreshButton`): the module list, the module page, and the candidate sheet header. It forces the same read the beat would, spinning until it lands with the figures left in place; in the sheet it also re-reads the open work and remounts any recording player, even when nothing on the roster moved.

An admin on the module page is usually watching a test as it happens, so it re-reads on its own. Every training collection is `if false`, so there is no snapshot listener: it is HTTP polling in `useTrainingAdmin.ts` (`useLiveRefresh`), and it runs only while something can change.

| Beat | While |
|---|---|
| 10 s | anyone (not removed) is `in-progress`, or `timed-out` within the working-file grace + one beat of their deadline (late uploads still land) |
| 15 s | otherwise, a test is open and could be started |
| none | nothing open, nothing running — an idle page costs nothing |

Also: **one read at the next deadline**, and **one read when the window comes back into view**. Nothing polls while the window is hidden. A re-read **keeps the last detail on screen** (never back to a spinner), so an open `RecordingPlayer` is not torn down. Open's file copying is driven by the page, not polled.

## Screen recording

Every attempt is **screen-recorded**, and an admin can watch it live (about one segment, ~10–20 s, behind) and replay it afterwards. `/training` runs in the candidate's own browser, not the Electron shell, so the capture is the browser's `getDisplayMedia` — which needs a click every time and cannot be started silently.

**The share.** Whole screen only: the track's `displaySurface` must be `monitor` (where the browser does not report it, the capture must have the screen's aspect ratio), and a frame must not be blank — a Mac whose browser lacks Screen Recording permission can hand back a black stream. Capture is capped at 1920×1200, ~10 fps, ~1.2 Mbps (`recording.ts`): segments share the candidate's line with their edit uploads, and bitrate is how fast Storage grows. `surfaceSwitching: 'exclude'` removes Chrome's "share this tab instead", which would switch surface mid-test with no event to catch. **Not detectable:** a second monitor — a candidate can share one screen and work on another. The admin sees the recording; that is the check. Phones and tablets have no `getDisplayMedia`, so the test is desktop-only, and the screen check says so.

**Before Start — the screen check (`ScreenCheck`).** Share → a live preview → the browser grabs a JPEG still → `screen-check` `{action:'sign'}` → direct PUT → `{action:'confirm', checkId}`, which proves the object is a real JPEG created in the last few minutes and records `screenChecks.{testId}.atMs`. The candidate must also tick that the preview shows their whole screen, including other apps' windows — a Mac without permission can share the wallpaper alone, which no automated test can tell apart. **Start refuses** without a check from the last `SCREEN_CHECK_TTL_MS` (10 min); the browser redoes an aged check itself before calling Start. A page that somehow skipped the check gets Start's refusal, which tells it to refresh.

**During — segments.** `ScreenRecorder` records standalone ~10 s files: each is a **new** `MediaRecorder` (chunks after a recorder's first have no header), rotated on the recorder's own `timeslice` event rather than a timer — the candidate is in their editing app, and a background tab's timers are throttled to once a minute. `recording` signs `SEGMENT_BATCH` (6) PUT URLs per call, so one call covers a minute (rule 9i). Sequence numbers come from `attempts.{testId}.segmentSeq`, so a segment can never overwrite another; **a reopen continues the counter** instead of resetting it. Every URL dies at the attempt's end plus the grace, like the final-image uploads'. Segments upload one at a time, retried with backoff; up to ~10 minutes queue while a line is down, oldest dropped first. **Nothing is written to Firestore per segment** — the folder is the record.

**The lock.** If the share stops ("Stop sharing" in the browser bar) or the page is refreshed mid-attempt (a share never survives a reload, and only a click can start another), `ScreenLock` covers the task room (`inert` beneath it) until they share again. **The clock does not pause** — pausing would make stopping the share a way to buy time. The server enforces it on its own: `upload-url` refuses an upload (final image or working file) while the newest segment in Storage is older than `RECORDING_STALE_MS` (90 s, generous for a slow line). A failed Storage listing fails **open** — a storage hiccup must not lock an honest candidate out.

**Only attempts that carry `recording: true` are gated.** Start sets it (and `segmentSeq: 0`); a reopen sets it too. Every attempt in this model has it.

**Admin — `RecordingPlayer`.** Behind a **Watch live / Screen recording** button per test in the candidate sheet (one player at a time). `GET …/participants/{emailHash}/recording?test=` lists the folder (`getFiles`) and signs each segment with the window-anchored `signRead`; `&after=<seq>` (Storage `startOffset` — the names are zero-padded, so lexical is chronological) returns only newer ones, and the live view polls with it every 10 s while the window is visible and for a minute after the test ends (the last segment lands in the grace). Two `<video>` elements take turns so the hand-over between files does not flash, and the next file is started the moment the current one ends (before React re-renders). **Live plays one segment behind the newest** (`LIVE_BUFFER`), so the next file is already loaded when the current one ends; if playback still catches up it polls every 2 s until the next segment lands. Controls: click-to-pause, play/pause, a **time-based seek bar** (`mm:ss / mm:ss`, seeking inside a segment), 1×/2×/4×, **Jump to live**, and **full screen** (the video and its controls together). **Resilience:** a clip that fails to load is first retried with a freshly signed list (the usual cause is a URL that expired because the panel sat open for hours), and only skipped — with a visible "N clips could not be played" count — if it fails again; failing polls show "Can't reach the server — retrying" and retry every 2 s instead of leaving an endless "waiting"; catching up with a test that has since ended stops playback instead of waiting forever; 2×/4× drops to 1× at the live edge; polls never overlap and fire again on returning to the window; full screen tries the browser's own full screen and, where that is refused, **fills the app window instead** (`page` mode: fixed over everything, Esc or the button to leave, Esc caught before the sheet's own Esc handler). The desktop app always takes the fallback: the Electron shell grants pages only `clipboard-sanitized-write` (`ALLOWED_PERMISSIONS` in `electron/main.js`), so Chromium's `fullscreen` permission is refused — allowing it there would give true screen-filling full screen, but needs a new build; on the focused picture, Space/K play-pause, ←/→ move ten seconds and F toggles full screen; state changes are announced in a polite live region. A live attempt shows a pulsing **LIVE — test in progress** badge, and on the picture itself a red **LIVE** tag at the live edge or **Behind live** after a seek back. **Gaps are derived on read** (`recordingGaps`) from segment times and drawn red on a coverage strip with "No recording for 2m 10s from about 14:03". Segment times are Storage's `timeCreated` (upload end), so positions are labelled "about".

**Retention is manual.** **Delete recording** (confirmed) removes the folder and the check still and stamps `recordingDeletedAtMs`; refused while the test is running or inside the upload grace. Uploaded work is untouched. Nothing deletes recordings automatically.

**Known limits.** The upload gate proves a file arrived recently, **not that it is real video of the screen** — a scripted candidate could keep it open with junk segments; only the admin watching the playback catches that. A reopen hides any gap at the end of the first run (`recordingGaps` cannot tell where that run ended). A segment PUT cannot pin a maximum size (same reason as edits: `x-goog-content-length-range` would need the CORS policy), so a hostile candidate could upload oversized segments until their deadline; `MAX_SEGMENTS_PER_ATTEMPT` bounds the count. The `video/webm`/`video/mp4` content type is pinned in the signature, so the PUT must send exactly that header (not `MediaRecorder`'s `;codecs=` variant).

## Abuse model

| Layer | Where | Stops |
|---|---|---|
| Honeypot + 1.2 s minimum fill | `request-code` | Naive scripts (silent `200`) |
| Per-IP and per-address ceilings | `consumeRate` | Volume; the address limit counts requests, not approvals, so it leaks nothing |
| Code: 10 min, 5 guesses, one live code, resend cooldown | `issueCode`/`verifyCode` | Guessing a 6-digit space; the attempt is recorded before the compare, in the same transaction |
| Signed cookie, re-authorised per request | `withCandidate` | Stale access after revoke / switch-off |
| Server clock, capped signed URLs, magic-byte + `timeCreated` checks | `trainingService` | Time-shifting, post-deadline uploads, non-images |
| Working files signed as `octet-stream`, served as `attachment`, server-chosen paths | `requestUpload`, `signRead` | Hosting active content from our bucket |
| Screen check before Start; uploads refused without a recent segment | `startAttempt`, `requestUpload` | Sitting the test unrecorded |
| `syncFile` only honours a pending Drive id of the test's own manifests | `lib/training/drive.ts` | An admin route being used to fetch arbitrary Drive files |
| T7 serves one signed image at a time, an answer only inside its window | `getSequence`, `saveAnswer` | Looking ahead or back |
| `no-store` on every route | all | Caching a clock or a signed URL |
| `noindex`, `NoTranslate` | layout | Discovery; a translator killing a live timed task |

Per-IP limits are sized for a group in one office on one address (60 code requests an hour). **Rules for changing it:** never answer differently for an approved address; never sign an upload URL past `clockEnd + grace`; never put a source or dataset image in anything the briefing returns; never sign a T7 image past its window; never loosen the Firestore rules; never make `syncFile` accept an id the plan did not write.

## Operational notes

- **Deploy the rules and indexes** after any change here: `firebase deploy --only firestore:rules,firestore:indexes`.
- **Google Drive:** needs `GOOGLE_DRIVE_SERVICE_ACCOUNT` and `GOOGLE_DRIVE_ROOT_ID` **on Vercel as well as in `.env.local`**, the service account a **Manager** of the shared drive, and the Drive API enabled in the `bluu-backend` Cloud project. A missing variable shows as an error on Check Drive / Open and as `failed` mirror copies. See [architecture-overview.md](architecture-overview.md#4-environment-variables).
- **CORS:** the browser `PUT`s to Storage from `app.bluurock.com` (and the legacy host, redirected for pages), and the dataset zip `GET`s signed URLs with `fetch()`. `storage-cors.json` allows `GET`, `HEAD` and `PUT` for those origins; a new domain must be added there (rule 9i). A recording is PUT from the browser too; a snip recording is not (that is Electron's main process).
- **Cron:** `/api/cron/training-mirror` (03:30 UTC) is in `src/vercel.json`. It needs `CRON_SECRET`.
- **Email:** needs `RESEND_API_KEY`. A send failure is logged (`[training/request-code]`) and the candidate sees nothing different — check the server log if someone says no code arrived.
- **Retention:** there is no deletion or archive for modules, candidates or uploads yet. Candidate work and emails are kept until someone removes them from Firestore/Storage. Screen recordings are deleted only by an admin (**Delete recording**); at the capture settings a 20-minute test is roughly 75–180 MB. Drive keeps what was mirrored.
- **Invitation:** adding someone does not email them. Copy the link from the module page and send it yourself. (Whether switching a module on should email them is an open question — it would be an automated **email**, rule 15b: Resend, not notifications.)

## Open items

- **T5 datasets are used "if and when applicable".** Images 013 and 014 name no identity; 015–017 are Cole, Joe and Adam. The dataset modal offers those three.
- **Copy wording** is cosmetic and unresolved: "Test Time" vs "Working time", "Tests" vs "Task".
- **Generation tools / budgets** are instructions only; nothing is provisioned through the app.
- **A materials change while a candidate is mid-test** is possible in one case: opening T2 re-syncs the datasets, and a T1 attempt still running (closing a test lets clocks finish) could see a dataset image change. Close, and wait for running clocks, before editing Drive.
