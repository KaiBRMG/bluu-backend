# Training revamp — plan

**Status:** built 2026-10-29 (all of §11 steps 1–7 except `/simplify`'s follow-up and the manual checks below). The permanent description is [`documentation/training.md`](documentation/training.md); this file is now the record of the decisions and what changed from them.

**Built differently from the plan** (each is also in `documentation/training.md`):
- **Drive layout has a module folder:** `Training/Media-Gen/{Datasets, Source Media, Submissions}`, not `Training/{…}`. It is `TrainingModuleDef.driveFolder`, so a second module gets its own.
- **Materials are keyed by module as well as identity/test** (`training-materials/media-gen_dataset_JOE`, Storage `training/materials/{moduleId}/…`), and a file's checksum is in its Storage name so a changed file is a new path.
- **The switch is on the module page, not on the list card**, so switching off is always done with the running attempts in view; the list card shows On/Off, headcount and the open test.
- **Reopen needs the module on and an existing attempt.** A candidate who never started a test is not reopened — open the test and they can Start it.
- **`fflate`** was added for the in-browser dataset zip (no zip library existed).
- **New `mirrorPending` flag** on the participant doc so the daily sweep is one query, and **`participantCount`** on the module doc so listing needs no count query.
- **The task record reaches Drive when the attempt ends** (`finish`, or the room's "time ran out" call), not on every keystroke; the sweep catches the rest.

**Resolved by the Drive probe (read-only, 2026-10-29):** T6's three Source Media subfolders are `#1 CANDID SFW`, `#2 TEASY`, `#3 EXPLICIT` (§10 Q1); T7's 10 images are in `Source Media/T7/` (§10 Q2); **T5 has five sources, `0013`–`017`** (§9.2: five slots, and they do not collide with T4's in meaning — the codes are the same numbers on a different test). T5 was held back (`TestDef.pending`) until §9.2–9.4 were answered; they now are (2026-10-29): **five images**; **016 is "Body Proportions and Overall Realism"**; **datasets are used if and when applicable** (013/014 have none assigned). The draft's "four images" wording and its four-name submission list were corrected — the names are now rendered from the five slots. Source file codes are inconsistent (`0013.png` vs `013.jpeg`), so sources are matched to slots by the *number* in the name.

**Not verified by running (needs you):** nothing was exercised against live Firestore/Storage — the Drive listing, download, checksum and `sharp` thumbnail path were run read-only against the real drive (125 dataset/source images, largest 7.8 MB, ~3.5 s each), but `Check Drive`, `Open`, uploads, the mirror and the sweep were not clicked through. The Firestore rules test suite was not run (no emulator dependencies are installed in `tests/firestore-rules`).
**Surfaces:** candidate `src/app/training` · admin `src/app/(main)/admin-portal/training`.
**Scope:** a full rebuild of how training runs. Sessions with dates are replaced by **modules that an admin switches on and off**. A module holds **tests that the admin opens one at a time**. Each test's materials come from a **Google Drive shared drive**, and submissions are mirrored back to it.

The candidate-facing copy from the original draft is kept **verbatim** in [Appendix A](#appendix-a--module-explainer-verbatim) (module explainer) and [Appendix B](#appendix-b--test-briefs-verbatim) (T1–T7). It becomes structured content in `modules.ts`. Errors in that copy are listed in [§9](#9-open-copy-issues-to-fix-before-content-goes-in), not silently fixed.

---

## 1. Decisions (settled)

| # | Decision | Notes |
|---|---|---|
| D1 | **Old data and code are dropped.** | The current site never ran with real candidates. `training-sessions`, `training-participants` and the per-session Storage paths go. There is no migration and no "past sessions" view. |
| D2 | **Access is per module, with no sessions.** | A participant is `(moduleId, email)`. Being on a module that is **switched on** is the only way into `/training`. With no module, or a module switched off, nobody gets a code. |
| D3 | **Each candidate starts their own clock.** | An admin **opens** a test, and candidates then see its briefing and do the screen check. Each candidate presses **Start** and gets the full duration. The server clock rules (`deadlineMs` written once, skew-corrected display) carry over unchanged. |
| D4 | **Only one test is open per module at a time.** | Opening T2 requires closing T1 first. A candidate can only run one attempt at a time anyway. |
| D5 | **Close test = no new Starts. Module off = everything ends.** | Closing a test lets running clocks finish. Switching the module off works like today's Stop session: access ends, running attempts end where they stand, uploaded work is kept, and in-flight uploads get the grace period. |
| D6 | **Each test is sat once, and per-candidate Reopen is kept.** | Same semantics as today's `reopenParticipant` (a fresh clock on the same attempt, uploads kept). This is the escape hatch for a crashed machine. |
| D7 | **One upload slot per required final.** | The server names the Drive copy (for example `T1 - 001.png`), so naming is guaranteed and the admin sees each result beside its source. See §5 for the slots in each test. |
| D8 | **Working Files accept any type, up to 250 MB each.** | They are always served as a download, never inline (§6). |
| D9 | **Screen recording stays exactly as it is.** | That covers the screen check before Start, the ~10 s segments, the admin's live view and the upload lock while the share is stopped. It is re-keyed to module/test ids. |
| D10 | **Datasets open in a modal on the test page.** | A gallery with per-image download and **Download all**. The zip is built **in the browser** from signed URLs, so no bytes cross a function (rule 9i). |
| D11 | **Briefs live in code, as structured data.** | Typed sections and lists in `modules.ts`, next to each test's slots, duration and dataset rules, so the copy and the mechanics can't drift apart. Changing the wording is a deploy. |
| D12 | **T7 answers are free text, read by the admin.** | There is no answer key and no score. |
| D13 | **The Drive root comes from an env var.** | `GOOGLE_DRIVE_ROOT_ID` is the id of the `Bluu-Backend` shared drive. It is **shared by every subsystem**: Training is one top-level folder in it, and other subsystems will add their own. Both it and `GOOGLE_DRIVE_SERVICE_ACCOUNT` are in `.env.local`. |

### Decided by default — say if you disagree

- **Candidates see the whole test list, not only the open test.** Titles and durations show with a locked/done state. The module explainer is always reachable, even with no test open.
- **A test's materials freeze while it is open.** Drive is synced at Open. Edits made in Drive while the test is open are not picked up until it is closed and opened again. A candidate mid-attempt never has a file change under them.
- **The `<sessionID>` in `T1_<sessionID>` becomes a short attempt id**, for example `T1_k3f9x2`, because sessions no longer exist.
- **The text input goes to Drive as `Task record.txt`** in the attempt folder. It autosaves to Firestore while the candidate types.
- **Working files get a longer post-deadline grace (10 min) than final images (30 s).** A 250 MB file started before the deadline must be allowed to finish arriving. URLs are still only minted before the deadline.
- **The `SessionsList` and Candidates tabs, the source-image uploader and per-part open times are deleted.** Drive replaces the uploader, and the switch replaces the open times.
- **T4: choosing an identity already used on another slot swaps the two**, rather than being blocked (§8).
- **T7 has no milestone pulses and no flash.** Each 30 s window's last 10 s show the `warn` border and the words "10 seconds" (§8).

---

## 2. Lifecycle

```
Module:   OFF ───switch on───► ON ───switch off───► OFF        (off = hard stop, D5)

Test (admin):   closed ──Open──► preparing ──sync done──► open ──Close──► closed
                                  (Drive → Storage diff)          (no new Starts; running finish)

Attempt (candidate, while test open):
   locked → briefing → [screen check] → Start → in-progress → submitted | timed-out
                                                             ↑ Reopen (admin, D6)
   A test that closed before the candidate pressed Start → missed
```

- **Briefing (open, not started).** The candidate sees the summary: what the test asks, its time, budget, deliverables and datasets by name. **No source images and no dataset images.** The existing rule stays: nothing the briefing returns is signed.
- **In progress.** The full brief, source images (primary, large), a **Datasets** button (the modal), the slots, working files, the text input and the timer.
- State is still **derived on read** (the `derivePartState` pattern): from the module, the test status, the attempt and the clock. No cron is involved.

---

## 3. Google Drive

### Shared drive layout (the source of truth for materials)

```
Bluu-Backend/                     ← GOOGLE_DRIVE_ROOT_ID (the shared drive; other subsystems' folders sit beside Training)
Training/
  Datasets/{ADAM,COLE,JACKSON,JOE}/     20–30 images each
  Source Media/T1 … T7/                 2–4 images (T6: 3 subfolders, T7: 10 images — see §10)
  Submissions/<Candidate name>/T{n}_<attemptId>/
      Final Images/   T1 - 001.png …
      Working Files/  …as uploaded
      Task record.txt
```

### Client — two layers, both server-only

- **`src/lib/google/drive.ts`** is the generic client, which any subsystem may use. It knows nothing about training.
  - It uses `googleapis` (already a dependency) with a JWT from `GOOGLE_DRIVE_SERVICE_ACCOUNT`, scope `drive`.
  - It provides list, stream-download, resumable upload, create folder, trash and `resolvePath(['Training', 'Datasets', 'JOE'])`.
  - Every call passes `supportsAllDrives: true`. Every list passes `includeItemsFromAllDrives`, `corpora: 'drive'` and `driveId = GOOGLE_DRIVE_ROOT_ID`. A shared drive's root folder id is the drive id, so one env var serves both.
- **`src/lib/training/drive.ts`** handles training's paths, the materials sync and the submissions mirror, all built on the generic client.
- Folders below the root (`Training`, `Training/Datasets/JOE` and so on) are resolved by name **once**. Their **ids are then cached in Firestore** and the names are never searched again. Renaming a folder in Drive after that is harmless; deleting one needs a re-resolve, which the sync does when a cached id 404s.
- Drive calls are free but quota-limited. Calls are sequential, and nothing polls Drive.

### Sync (Drive → Storage), at Open

- **The manifest lives in Firestore:** `training-materials/{key}`, keyed `dataset:JOE` and `source:T1`. It holds one entry per file: `{ driveId, name, md5Checksum, modifiedTime, storagePath, thumbPath, width, height }`.
- **The diff:** list the folder, compare `driveId + md5Checksum`, then copy only what is new or changed and delete what was removed. **No difference means no refetch**, as the draft asks.
- **Datasets sync once per identity, not once per test.** T1 needs JOE, most tests need all four, and T7 needs none. Opening T2 after T1 re-lists JOE but copies nothing.
- **The copy is driven by the client, one file per call.** Open calls `POST …/tests/{id}/prepare`, which returns a to-do list. The admin page then calls `…/prepare/file` once per file and shows progress (`23 / 41`). Each call streams Drive → GCS, with no buffering of the whole file. `sharp` makes a 480px WebP thumbnail on the server. `maxDuration = 60`. About 120 files is too many for one invocation.
- **Open is a transaction** that refuses until every manifest the test needs is complete. "The test opens only once files are fetched" is enforced on the server, not only in the UI.
- An abandoned prepare leaves the test `preparing`. Pressing Open again resumes the diff, which is idempotent.

### Mirror (Storage → Drive), after each upload

- `finalize` validates the object as it does today, then runs `after()` to stream Storage → Drive with a resumable upload. It records `driveFileId` and `driveState: pending | done | failed` on the slot or working-file entry.
- **Folders are created under a Firestore lease.** Drive allows duplicate names, so two concurrent finalizes would otherwise create two `T1_x` folders. The candidate folder id lives on `training-candidates/{emailHash}` and the attempt folder ids live on the attempt.
- **Candidate folder name:** the sanitised `name`. A same-named candidate gets a short hash suffix. Renaming later doesn't matter, because the id is stored.
- **Replacing a slot** trashes the old Drive file. **Failed copies** show on the dashboard with **Retry**, and a daily sweep (Vercel cron) retries any `pending` or `failed` copy older than 10 minutes.
- Cost note: Storage → Drive is function egress, not CDN↔origin traffic, so it is not the Fast Origin Transfer bill. It does use function time, so it runs in `after()` with `maxDuration = 300`.

---

## 4. Data model (all Admin-SDK-only, `read, write: if false`)

| Collection | Contents |
|---|---|
| `training-modules/{moduleId}` | `isOn`, `switchedOnAtMs`, `switchedOffAtMs`, `openTestId \| null`, `tests.{testId} = { status: 'closed'\|'preparing'\|'open', openedAtMs, closedAtMs, materialsVersion }` |
| `training-participants/{moduleId}_{emailHash}` | `email`, `addedAtMs`, `revokedAtMs`, `accessUntilMs?` (set by Reopen), `screenChecks.{testId}`, `attempts.{testId} = { attemptId, startedAtMs, deadlineMs, finishedAtMs, reopenedAtMs, recording, segmentSeq, uploadAttempts, slots{}, workingFiles{}, text, answers?{} (T7), datasetChoices?{} (T4), driveFolderIds{} }` |
| `training-candidates/{emailHash}` | `name`, `driveFolderId` |
| `training-materials/{key}` | The Drive manifest (§3) |
| `training-codes/*`, `training-rate/*` | Unchanged |

- Index exemptions: `attempts`, `screenChecks`, `tests`, `files` and `email` (rule 9). Reads are `moduleId ==` for the roster and `emailHash ==` for a candidate, plus batched `getAll`. There is no N+1.
- **Rule 1:** these rule and index changes will be called out when they land, with `firebase deploy --only firestore:rules,firestore:indexes`.

### Storage

```
training/materials/datasets/{IDENTITY}/{driveId}.{ext} (+ _thumb.webp)
training/materials/sources/{testId}/{driveId}.{ext}    (+ _thumb.webp)
training/submissions/{moduleId}/{emailHash}/{testId}/final/{slotId}-{uploadId}.{ext}
training/submissions/{moduleId}/{emailHash}/{testId}/work/{uploadId}
training/recordings/{moduleId}/{emailHash}/{testId}/…      (unchanged scheme)
```

---

## 5. Tests in code (`src/lib/training/modules.ts`)

A test definition carries `id`, `title`, `durationMs`, `budgetUsd`, `brief` (structured sections), `summary` (the briefing view), `datasets` (which identities, and how they are assigned), `slots[]` and `kind`.

| Test | Kind | Slots (final images) | Datasets | Special mechanics |
|---|---|---|---|---|
| T1 ID only | `edit` | 001–004 → `T1 - 00N` | JOE | — |
| T2 ID + body | `edit` | 005–008 | fixed per source (005 Jackson, 006 Cole, 007 Joe, 008 Adam) | Each slot shows its assigned identity, and the modal opens on it |
| T3 + background | `edit` | 009–012 | fixed per source | as T2 |
| T4 + pose | `edit` | 013–016 | **the candidate picks per slot; each identity exactly once** | Identity picker on each slot. The server rejects a duplicate. Stored in `datasetChoices`. Drive name includes the identity (see §9) |
| T5 corrections | `edit` | 5 slots (see §9) | per source | Each slot shows its correction brief |
| T6 original | `generate` | 12: {Adam, Cole, Jackson, Joe} × {01 SFW, 02 Teasing, 03 Explicit} | all four | No source to edit. Source media is **viewing-only inspiration**, labelled so. Extras go in Working Files |
| T7 spot the mistake | `sequence` | none | none | §7 |

The `edit` room replaces today's ID-swap `TaskRoom`, and `pickCount` and the four-level slots are gone. Every test except T7 has **Final images** (the slots), **Working files** and **Text**.

---

## 6. Uploads

- **Final images** follow today's pipeline unchanged: `upload-url` → PUT → `finalize`, with JPG/PNG/WebP magic bytes, 25 MB, the `deadline + 30 s` grace and replace-on-reupload.
- **Working files (D8):**
  - The content type is pinned to `application/octet-stream` in the signature. It is never the client's value, so we never sign `text/html` on our bucket.
  - The object path is server-chosen. The original filename is stored sanitised (length cap, no path separators) and is used only for display and for the Drive name.
  - `finalize` checks that the size is ≤ 250 MB and that `timeCreated` is ≤ `deadline + 10 min`. Anything else is deleted.
  - Reads are always signed as `attachment`. There are no thumbnails except for image types, which are sniffed at finalize.
  - A per-attempt cap of 50 working files bounds Storage.
- **Text:** at most 10,000 characters. It is autosaved (debounced) through `PATCH …/text` and accepted until `deadline + grace`.

---

## 7. Test 7 — Spot the Mistake

- The clock is 10 windows × 30 s, starting at the candidate's Start.
- `GET …/sequence` returns **only the current image**, signed until the end of its window plus a few seconds. Earlier images are no longer signed, and later ones never are. Nothing is prefetched.
- `POST …/answer {index, text}` is accepted only while `index` is current, plus a 5 s grace. The page auto-submits the draft at the window's end and advances. There is no going back.
- The order is the Drive file order (by name). Every candidate sees the same order.
- Admin view: the 10 images in a row, each with its answer and the time it was submitted, or **"No answer"**.

---

## 8. UI

*Shaped 2026-10-29 (`/impeccable shape`).* The candidate side stays in DESIGN.md §11, "the focus room": no new visual world. The admin side is the console (§1–6). Both DESIGN.md §11 and `.impeccable/surfaces/src-app-training.md` still describe the session model, and both are rewritten in close-out (§11 step 7).

### What carries over and what goes

- **Kept as is:** the email → code gate, the name step, `CLOCK_PHASE` and its two numeral motions, `ScreenCheck`, `ScreenLock`, the one-sentence `AlertDialog` confirms for Start and Finish early, the quiet "N saved" finish with no celebration, and `StateChip`.
- **Removed:** session dates, `pickCount`, the "choose N images, then step 2 unlocks" lock, and the source-choice radio group. **Do not recreate the two-step lock.** The radio-group idea survives only as T4's identity picker.

### Candidate: home (module on)

- A masthead, then the **module explainer** (Appendix A). It is collapsible and always reachable.
- Then the **test list T1–T7**. Each row shows the title, minutes, a chip and one action:
  - Locked
  - Open → *Read briefing*
  - In progress → *Return* (with time left)
  - Submitted
  - Time's up
  - Missed
- When the `/me` poll sees a test open, that row changes in place and the polite live region announces it.
- With the module off, one honest panel says training isn't running right now.

### Candidate: briefing (test open, not started)

- Time, budget, deliverables as a count plus their names, datasets by name, and the recording rules.
- **No images of any kind**, because nothing the briefing returns may be signed. Datasets show as text chips.
- Then the screen check, then **Start**.

### Candidate: edit room, T1–T5 (focus room)

- **The brief comes first and starts expanded.** Its sections are headings. Once read, it folds to a one-line strip ("Brief · T2 ID + Body ▸") that can be reopened at any time. The fold is a state change, not one of the numeral motions.
- **Paired rows, one per source:**
  - The code (`005`), then the large source image, then an arrow, then the slot. The slot is labelled with its server name (`T2 - 005`) and shows its state: empty drop zone / uploading % / ✓ thumbnail with *Replace*.
  - T2, T3 and T5 rows carry an **identity chip that is a button**: it opens the dataset modal on that identity.
  - T5 rows also carry their correction brief inline.
- **T4 identity picker:** four options on each slot, and an identity used on another slot shows as **"Used on 014"**. Choosing a used identity **swaps** it with the other slot (*assumed*). A slot refuses uploads until an identity is chosen.
- **Below the rows:**
  - **Working files**: each shows its name, size and progress, with an `N / 50` counter.
  - **Task record**: a textarea with a "Saved · 12s ago" status and an `N / 10,000` counter.
- **Rail (`lg` and up):**
  - the clock
  - `N of M uploaded`
  - **Datasets** (opens the modal)
  - **Explainer** (opens a sheet, so it stays reachable inside the focus room)
  - the recording dot
  - Finish early
- Below `lg` the rows stack (source above slot) and the clock becomes the pinned band.

### Candidate: dataset modal (D10)

- One tab per identity in the test.
- A thumbnail gallery with a download button on each image.
- **Download all**: zipped in the browser, with progress (`18 / 26`). If one file fails, its name is shown with *Retry*, and the rest still zip.
- An expired signed URL is re-fetched silently.

### Candidate: T6 generate room

- **No source→slot arrows.** The slots form a 4 × 3 grid, Adam/Cole/Jackson/Joe by 01 SFW / 02 Teasing / 03 Explicit, each named `T6 - Adam - 01 - SFW`.
- The source media sits in its own panel headed **"Inspiration — viewing only. Do not edit or use as input."**
- Working files and the task record follow, as in the edit room.

### Candidate: T7 sequence room (a different clock)

- The focal number is the **per-window 30-second countdown** with "Image 3 of 10". There are no milestone pulses and **no 1 Hz flash**, because a 30-second window would make the whole test flash.
- Each window's last 10 seconds use the `warn` border plus the word "10 seconds" (*assumed*).
- One large image and one answer field.
- At zero the draft auto-submits, a calm "Saved — next image" holds while the next image loads (nothing is prefetched, §7), and then it advances. Nothing says "go back".

### Candidate: endings

- **Deadline:** the room locks with "Time's up". Files still arriving get their grace (30 s for final images, 10 min for working files, §6). Each in-flight file shows "Still arriving…" until it lands or fails. The lock must never imply that an arriving upload is lost.
- **Module switched off mid-attempt:** the same calm lock, with "Training has been ended by the team. Your uploaded work is kept."

### Admin (console skin)

- **`/admin-portal/training`** lists the modules: today only one card, Media Generation, with its switch, participant count and currently open test.
- **Module page:**
  - **Header:** a large **On/Off switch**. Turning it off asks for confirmation (D5), and the copy names the count: "3 attempts are running and will end now."
  - **Tests strip, T1–T7.** Each test shows a status (in words, with hue from `campaignTracking.ts`) and one action:
    - **Open**: shows preparing progress (`23 / 41 files`) and then opens.
    - **Resume**: shown when an earlier prepare was abandoned.
    - **Close**.
    - **"Close T{n} first"** (disabled, with the reason).
  - **Check Drive** on the strip shows a dry-run diff (added / changed / removed per folder), so an admin can prepare before the sitting.
  - **Live roster:** a full matrix of candidates × T1–T7, because a module is expected to hold fewer than ~15 candidates.
    - The open test's column is emphasised.
    - A cell shows the state word, the time left while running and `N of M uploaded`, plus a Drive mirror marker: *Synced* / *Pending* / *Failed · Retry*, always with the word.
    - Row actions: **Reopen**, **Remove/Restore**, **Copy link**. **Add people** (pasted emails, validated as today) sits above the roster.
  - **Candidate panel (sheet):**
    - Per test: each final beside its source, working-file downloads and the task record.
    - T7 answers as 10 images in a row, each with its answer and the time it was submitted, or **"No answer"**.
    - The recording player.
    - The **Drive folder link with a copy button**.
- Buttons are the plain shadcn `Button`. Nothing is inked in the component.

### Live updates

- **Admin:** the existing `useLiveRefresh` polling, at 10 s while anyone is running and 15 s while a test is open, with nothing while hidden. The tick stays out of React state (the sidebar-hang rule).
- **Candidate:** `/me` polls every 15 s, only while the module is on, no attempt is running and the page is visible, so they see a test open without refreshing. This is the one standing poll. It is per-candidate, `no-store`, and bounded by the sitting.

### Constraints

- Every rule, duration, budget, slot name and limit is rendered from `modules.ts` and the server constants. Nothing is typed twice.
- Fields are 16px, targets ≥44px, `NoTranslate`, `noindex`, and `<Link>` never prefetches.
- The clock is server time only.

### Blocked: build the components, not the content

- **T5:** the slot count and names, and the identities for 013 and 014, are pending §9.2–9.4.
- **T6:** the three inspiration subfolder labels are pending §10.
- **T7:** the image folder is pending §10.
- **T4:** whether the slot label carries the identity is pending §9.1.

Use no placeholder content that looks final.

---

## 9. Open copy issues (fix before content goes in)

*Resolved 2026-10-29:* T1 is ID only, with the pose text removed. T2 is ID + body with no pose changes, 40 minutes. T4 is ID + body + pose change, with one dataset per image and each dataset used exactly once.

1. ✅ **T4 naming — settled 2026-10-29: yes.** The Drive name carries the identity (`T4 - 013 - Cole.png`); the choice is stored per slot and used by `driveNameForSlot` in `lib/training/mirror.ts`.
2. **T5** lists **5** images (013–017) but says "all four images", and the submission names are four: `T5 - 0017 … 0020`, four digits and a different range. What are the five names? Do T5's codes 013–016 deliberately collide with T4's?
3. **T5 image 016** is titled "Face Correction and Overall Realism", but its text is a body resize.
4. **T5 images 013 and 014** have no identity assigned ("use the dataset assigned to each image").
5. **T1** header says "Test Time", the others say "Working time"; the module intro says "Tests" while T3–T5 say "Task". These are cosmetic; is one term preferred?

## 10. Open questions (need an answer before that test is built)

- **T6's three Source Media subfolders:** the draft says "see below" but never defines them. Are they `SFW / Teasing / Explicit` style references? Are their exact folder names fixed?
- **T7's 10 images:** do they go in `Source Media/T7/`? The schema stops at T6.
- **Generation budgets and tools:** the explainer says "the agency will specify the permitted tools and a spending cap for each stage". Is anything provisioned through the app (for example WaveSpeed keys), or is it purely instructions? This plan assumes instructions only.
- **Inviting candidates:** adding someone still doesn't email them, and an admin copies the link. Should switching a module on send them the link? That would be an automated email (rule 15b: Resend, not notifications).

---

## 11. Build order

1. **Drive client + materials sync:** `drive.ts`, the manifest, prepare/file routes, and Check Drive. Verify against the real shared drive first; it is the riskiest dependency.
2. **Data model + service rewrite:** modules, participants, attempts and state derivation. Delete the session code paths. Keep `trainingAuthService`, the recording code and the upload validation, re-keyed.
3. **Admin module page:** switch, tests strip, roster, candidate panel.
4. **Candidate home + briefing + `edit` room:** slots, dataset modal, working files, text. This covers T1–T5.
5. **Storage → Drive mirror:** folder lease, retry, sweep cron.
6. **T6 (`generate`) and T7 (`sequence`) rooms.**
7. **Close-out:**
   - Firestore rules, indexes and tests, with the deploy command given to you.
   - A full rewrite of `documentation/training.md`.
   - A rewrite of DESIGN.md §11 and `.impeccable/surfaces/src-app-training.md` for the module model (§8).
   - The CLAUDE.md Training box (Drive, module switch).
   - The architecture-overview env vars (`GOOGLE_DRIVE_SERVICE_ACCOUNT`, `GOOGLE_DRIVE_ROOT_ID`), described as the shared Bluu-Backend drive, not as training-only.
   - The new cron in `vercel.json`.
   - `/simplify` (rule 17).

**Needed from you before step 1:**
- Add `GOOGLE_DRIVE_ROOT_ID` on Vercel. It is already in `.env.local`.
- Confirm `drive-mirror@bluu-backend.iam.gserviceaccount.com` is a **Manager** of the shared drive.
- Confirm the Drive API is enabled in the `bluu-backend` Cloud project.

---

## Appendix A — Module explainer (verbatim)

Shown to the candidate at all times while the module is on, even with no test open.

"Purpose
These tests are built to assess whether you can consistently produce realistic, accurate, usable image and video content, follow a brief, identify defects, make controlled revisions, and hand over a repeatable workflow.
A strong submission should demonstrate both good final results and sound judgement about what is ready to use.
General Instructions
Materials and permissions
The agency will supply approved reference images, source images, source videos, and written briefs.
All people depicted must be verified adults. References must be approved for the intended edits and for processing through the permitted tools.
Use only the supplied or explicitly approved materials. Do not publish test materials or results, use them for unrelated work, or upload them to public galleries.

Datasets
You will be supplied with datasets for four different identities: Adam, Cole, Jackson, and Joe.
Each task will specify which identity dataset to use. Use only the assigned dataset for that task, and review its reference images carefully before editing to familiarise yourself with the person’s appearance.
Do not mix references from different identities.

Tools and budget
The agency will specify the permitted tools and a spending cap for each stage before work starts.
Check the expected charge before submitting a generation. Keep a record of all spending, including failed attempts. Stop before exceeding the cap and explain what remains unfinished.
Candidate payment is separate from generation credits.
💡 To get the most out of your credits, we recommend 1k generations with medium quality and 420p quality for videos for test purposes only.
Do not include API keys, passwords, or other account credentials in submitted files.
Required submission for every practical task
Submit:
Final files.
Original source filenames or asset IDs.
Tool and model names.
Prompts and relevant settings, including seeds where available.
Editable project or workflow files where supported.
Attempt count, total cost, and working time.
A short self-review identifying any remaining defects.
Rejected attempts or a contact sheet of attempts, with brief rejection reasons.
If a setting or workflow cannot be exported, explain the steps sufficiently for another team member to repeat the work.

Quality expectations
Unless the brief requests a change, preserve the subject’s identity, apparent age, body proportions, clothing, background, lighting, and overall image character.
Do not hide defects through excessive smoothing, heavy filters, unnecessary cropping, or reduced resolution.
If an issue cannot be corrected within the time or budget, disclose it.

What We’re Looking For
We’re looking for someone who can produce excellent image and video content while working in an organised, efficient, and repeatable way.
Strong organisational skills are essential. We will assess how you title your content, name your files, structure your folders, and organise your working materials and final deliverables. Another team member should be able to find the correct files and understand your work without needing additional explanations.
We’re also looking for high-quality results with low credit spend. Choose appropriate tools and models, plan your generations carefully, and make targeted corrections. We value someone who can consistently achieve strong results within a small budget.
Record your generation costs, including unsuccessful attempts. We will assess the quality of your final results alongside your total spend, number of attempts, and ability to avoid unnecessary generations. Low spending alone will not compensate for poor-quality work.

Meaning of ID and Body
ID means matching the assigned identity's face, head, and hair. Body means matching that same identity's visible build and proportions using the supplied references, while maintaining natural anatomy. Use comparable reference angles where available. Flag insufficient references rather than inventing distinguishing details.
"

---

## Appendix B — Test briefs (verbatim)

Layout rule from the draft: the briefing shows the essentials (time, budget, deliverables, what to expect); the full text and source media appear only after Start. UI compact, simple, easy to understand.

Test 1 - ID Only: 4 Images

Test Time: 30 minutes
Dataset: JOE
Generation Budget: $1.50
Deliverables: 4 identity swapped images
You will be supplied with 4 source selfie images and a set of identity reference images. Your task is to seamlessly replace the identity in each source selfie with the identity shown in the dataset (Joe).
We will be looking for attention to detail in accurately matching the face, head and hair of the supplied identity. We will also assess image quality, looking for the best possible realism without a synthetic appearance or unwanted artefacts.
Preserve the clothes, pose, expression, background, framing and image quality of each source image. Only change the identity. Match the identity naturally to the source lighting without introducing unnecessary changes.
Budget and Time
You will have a $1.50 WaveSpeed spending limit for all four images, including retries and corrections, and 30 minutes to complete the task.
The 30 minutes includes reviewing your dataset and source images, generating results, checking your work, and organising your submission. 
We are looking for high-quality results with low credit spend. The $1.50 is a maximum allowance, not a spending target. Record your total spend and number of attempts, including unsuccessful generations.
What Must Stay the Same
Preserve the clothes, pose, expression, background, lighting, overall framing and image quality of each source image.
Only change the identity.
Submission
Submit 4 final images: one completed image for each source selfie.
Keep the original source image code and add “T1 - ” at the beginning:
T1 - 001.png
T1 - 002.png
T1 - 003.png
T1 - 004.png
Upload these as your final images. If you’d like to include rejected attempts, upload these under your working files.
Include a short task record listing the tools and models used, prompts and relevant settings, number of attempts, total spend, and any remaining defects.
Before submitting, check all four images for identity accuracy, hairline and jawline transitions, natural skin texture, and unintended changes to the source.
Final Check

Compare each final with its source. Confirm that only the identity changed and that no body, pose, or background changes were introduced.

Test 2 - ID + Body: 4 Images
Working time: 40 minutes
Dataset: Mixed, assigned below
Generation Budget: $1.50
Deliverables: 4 final images
You will be supplied with four source selfie images. Replace the identity and match the visible body build and proportions to the assigned person using their dataset. Apply both edits to all four images.
Here are which identities to swap for which source images:
005.jpg - Jackson
006.jpg - Cole
007.jpg - Joe
008.jpg - Adam
What We’re Looking For
We will be looking for attention to detail in accurately matching the face, head and hair of the supplied identity, with consistent body proportions and a natural transition between the face, neck and visible skin.
We will also assess image quality, looking for the best possible realism without a synthetic appearance or unwanted artefacts. Pay particular attention to skin texture, anatomy, hands, clothing fit, and how the body interacts with its surroundings.
What Must Stay the Same
Preserve the clothes, pose, expression, background, lighting, overall framing and image quality of each source image.
Clothing should keep its fit natural on the new body build. Keep the same level of coverage, with no nudity or unintended exposure.
Only change the identity and the body.
What We Will Assess
Accurate face, head, and hair; reference-based body proportions; natural transitions between face, neck, and body; realistic anatomy and skin texture; and believable clothing fit. Maintain source image clarity and avoid unwanted changes.
Budget and Time
You will have a $1.50 WaveSpeed spending limit for all four images, including retries and corrections, and 40 minutes to complete the task.
The 40 minutes includes reviewing your datasets and source images, generating results, checking your work, and organising your submission. 
We are looking for high-quality results with low credit spend. The $1.50 is a maximum allowance, not a spending target. Record your total spend and number of attempts, including unsuccessful generations.
Submission
Submit 4 final images: one completed image for each source selfie.
Keep the original source image code and add “T2 - ” at the beginning:
T2 - 005.png
T2 - 006.png
T2 - 007.png
T2 - 008.png
Upload these as your final images. Keep working files and rejected attempts and upload as your working files.
Include a short task record listing:
The tools and models used.
Prompts and relevant settings.
Number of attempts and total spend.
Any remaining defects.
Before submitting, check all four images for identity accuracy, natural anatomy and skin texture, clothing consistency, and unintended changes.
Final Check

Compare each final with its source. Confirm that only the identity and body changed and that no pose, or background changes were introduced.


Task 3 — ID + Body + Background Change: 4 Images
Working time: 40 minutes
Dataset: Mixed, assigned below
Generation Budget: $1.50
Deliverables: Four final images
For each of the four supplied source images, replace the identity, match the assigned person's visible body build and proportions, and completely change the background. Preserve the original pose.
Background Changes
Each image must feature a clearly different environment. Simply changing the background colour, blurring the original setting, or replacing a few objects will not be accepted.
Choose a new setting that naturally supports the existing pose. For example:
A leg resting on a bed: Replace the bed with a couch or padded bench at a suitable height, keeping the leg supported.
- Leaning over the edge of a pool: Change the setting to a balcony with a solid parapet or a terrace with a suitable ledge. The surface must support the original position of the hands, arms, and torso.
- Lying on a tree trunk: Replace the trunk with a garden bench, sun lounger, or upholstered bench that supports the body in the same position.
- Leaning against a bedroom wall: Move the subject to a courtyard wall or another clearly different setting, preserving believable contact with the surface.
These are examples. You may choose other settings, provided they look natural and maintain the original pose.
Here are which identities to swap for which source images:
009.jpg - Jackson
010.jpg - Joe
011.jpg - Adam
012.jpg - Cole
What We’re Looking For
We will assess attention to detail in accurately matching the face, head and hair of the supplied identity.
We will also assess whether the subject looks physically present in the new environment. Pay particular attention to:
Correct scale and perspective.
Believable contact between the body and supporting surfaces.
Natural contact shadows, lighting, and reflections.
Clean edges around hair, skin, and clothing.
Realistic anatomy and skin texture.
Removal of objects or details left over from the original background.
The final images should look like photographs taken in the new locations, without a synthetic appearance or unwanted artefacts.
What Must Stay the Same
Preserve the pose, expression, clothing, body proportions, camera angle, overall framing, and image quality of each source image.
Keep the same level of clothing coverage, with no nudity or unintended exposure.
You may adapt the scene lighting and the subject’s colour balance to integrate them naturally into the new environment. Do not unnecessarily alter the subject’s appearance.
Budget and Time
You will have a $1.50 WaveSpeed spending limit for all four images, including retries and corrections, and 40 minutes to complete the task.
The 40 minutes includes reviewing the supplied materials, choosing suitable replacement settings, generating results, checking your work, and organising your submission. 
We are looking for high-quality results with low credit spend. The $1.50 is a maximum allowance, not a spending target. Record your total spend and number of attempts, including unsuccessful generations.
Submission
Submit 4 final images: one completed image for each source image.
Keep the original source image code and add “T3 - ” at the beginning:
T3 - 009.png
T3 - 010.png
T3 - 011.png
T3 - 012.png
Upload these as your final images. Keep working files and rejected attempts and upload as your working files.
Include a short task record listing:
The replacement setting chosen for each image.
The tools and models used.
Prompts and relevant settings.
Number of attempts and total spend.
Any remaining defects.
Before submitting, compare each result with its source. Confirm that the pose is preserved, the background is completely changed, and all points of contact with the new environment look believable.

Task 4 - ID + Body + Pose Change: 4 Images
Working time: 40 minutes
Dataset: You will choose for each image
Generation Budget: $1.50
Deliverables: Four final images
You will be supplied with 4 source images and the datasets for all four identities.
For each image, replace the identity, match the chosen person's visible body build and proportions, and change the pose, while preserving everything else as closely as possible.

For this task, you will choose which dataset to use for each image. Each dataset must be used exactly once, so each of the four identities appears in one of your four final images.
Pose Requirements

The new pose must show an obvious, meaningful change in the overall body position. A simple head tilt or small arm or leg adjustment is not enough. Choose a pose that works naturally in the existing setting, such as changing a seated upright posture to sitting sideways, or changing a standing posture to a supported seated position where the scene allows it.
The clothing should remain consistent with the source while its folds and positioning adapt naturally to the new pose. Keep the same level of coverage, with no nudity or unintended exposure.


What Must Stay the Same

Keep the original background and location, outfit, expression, lighting style, camera viewpoint, and image quality. Clothing folds, contact shadows, and body overlap with the scene may change naturally with the new pose. Keep framing as close to the source as practical.

What We Will Assess

Accurate ID and body matching; a clearly different pose in every image; natural anatomy and balance; believable contact with the environment; consistent clothing; and preservation of the original setting.
Budget and Time
You will have a $1.50 WaveSpeed spending limit for all four images, including retries and corrections, and 40 minutes to complete the task.
The 40 minutes includes reviewing the images and references, choosing a dataset and a new pose for each image, generating results, checking your work, and organising your submission. 

We are looking for high-quality generations with low credit spend. The allowance is a maximum, not a spending target.
Submission
Submit 4 final images: one final version for each source image.
Keep the original source image code and add “T4 - ” at the beginning:
T4 - 013.png
T4 - 014.png
T4 - 015.png
T4 - 016.png
Upload these as your final images. Keep working files and rejected attempts and upload as your working files.
Include a short task record listing:
The dataset chosen for each image.
The pose change made to each image.
The tools and models used.
Prompts and relevant settings.
Number of attempts and total spend.
Any remaining defects or unintended changes.
Before submitting, compare each final with its source at full size. Confirm that every image shows a clearly different pose, that each dataset is used exactly once, and that the background, outfit, lighting and framing are unchanged.

Test 5 — Corrections: 5 Images
Test time: 50 minutes
Generation budget: $2 total
Dataset: Use the identity dataset assigned to each image.
Deliverables: Five corrected images.

You will be supplied with a set of source images containing specific issues. Your task is to make the corrections below while preserving unrelated details.
- Image 013.png — Fingers Holding the Phone
Correct the fingers holding the phone so the hand has natural anatomy, believable finger placement, and a realistic grip.
Preserve the phone’s shape, position, and perspective. Check that the fingers make natural contact with the phone and do not merge into it.
- Image 014.png — Remove the Extra Limb
Remove the unwanted extra limb and reconstruct the affected area naturally.
- Image 015.png — Penis Proportion Correction
Using Cole’s Dataset, correct the size of his penis. The angle may change if necessary.
- Image 016.png — Face Correction and Overall Realism
Using Joe’s Dataset, resize his body to be in correct proportions and perspective.
- Image 017.png — Face Change, Body Change and Overall Realism
Using Adam’s dataset, change the face and body to match him. Then work on the realism of the overall photograph and the cumshot to look as close to a genuine photo as possible.
What Must Stay the Same
Preserve the source pose, expression, clothing, background, framing, and image quality unless a local change is necessary for the assigned correction.
Make targeted edits. Do not introduce unnecessary changes to previously correct details.
Budget and Time
You will have 50 minutes and a $2 WaveSpeed spending limit for all four images, including retries and corrections.
The time includes reference review, editing, quality checks, and organising your submission.
We are looking for high-quality corrections with low credit spend. The allowance is a maximum, not a spending target.
Submission
Submit one final corrected version of each source image:
T5 - 0017.png
T5 - 0018.png
T5 - 0019.png
T5 - 0020.png
Upload these as your final images. Keep working files and rejected attempts and upload as your working files.
Include a short task record listing:
The corrections made to each image.
Tools and models used.
Prompts and relevant settings.
Number of attempts and total spend.
Any remaining defects or unintended changes.
Before submitting, compare each result with its source at full size. Check that the assigned issue is corrected and that the edit has not introduced new problems elsewhere.

Test 6 - Original Image Generation
Working time: 90 minutes
Dataset: Each dataset
Generation Budget: $5
Deliverables: 12 final images
This task tests your creativity, identity consistency, photographic realism, and ability to produce varied content with low credit spend. Choose your own settings, outfits, poses, and compositions.

You will be supplied with source media showing roughly the style, quality, and creative direction we are looking for. 
These photos are for viewing and inspiration only. Do not use them as generation inputs, edit or identity-swap them, or recreate their specific compositions. Continue to use the assigned datasets for identity references.

Your submissions must be original. Any image found to copy or closely recreate a supplied reference photo will be disqualified from the final assessment. General similarities in style or theme are acceptable; reproducing a recognisable combination of pose, outfit, setting, and framing is not.
What We’re Looking For
For this task, you will have complete creative control. Using each dataset, you will produce 3 images each, 1 must be SFW, 1 must be teasy and 1 must be explicit.
You will do this for:
Adam
Cole
Jackson
Joe
That means a total of 12 final images.
- Image 1 — Completely Safe for Work
Create a fully clothed image suitable for a general audience.
You may choose a lifestyle, fashion, fitness, travel, or everyday setting. The image should look natural and believable, with a clear creative direction. 
You must capture a candid, low resolution style image which matches the images given in your reference photos.
- Image 2 — Teasing
Create a non-explicit image showing some body, such as a shirtless image or an image featuring shorts or boxers.
Keep intimate areas fully covered. Pay attention to natural anatomy, clothing fit, skin texture, and believable posing.
- Image 3 — Explicit
Create a more confidently styled, explicit image which features either full frontal or full rear nudity.
Keep intimate areas visible. Make this image clearly different from Image 2 through its composition and creative direction.
What We’re Looking For
Accurate face, head, hair, and visible body proportions and genitalia for each dataset.
Consistent identity across all 3 images per dataset.
Creative variety rather than repeated poses or backgrounds.
Realistic anatomy, hands, skin texture, lighting, and shadows.
Strong composition without a synthetic appearance or unwanted artefacts.
Efficient model selection, targeted corrections, and low credit spend.
Use each dataset in isolation. Do not mix references between identities.
Budget and Time
The 90 minutes includes reviewing references, planning, generating, checking, and organising all 12 images.
The budget will be $5 covers all generations, retries, and corrections. It is a maximum allowance, not a spending target. Record your attempts and spending.
Submission
Name each dataset's images using this format:
T6 - Adam - 01 - SFW.png
T6 - Adam - 02 - Teasing.png
T6 - Adam - 03 - Explicit.png
Use the same naming structure for Cole, Jackson, and Joe.
Upload working files.
Include a short task record listing your creative concepts, tools and models, prompts and settings, number of attempts, total spend, and any remaining defects.
Before submitting, review the images individually and as a set. Confirm that every dataset has three distinct images and that their identity remains consistent throughout.
Optional Extra Points
For a chance to earn extra points, include any permitted source or reference images you used to create your submissions, clearly labelled alongside the relevant final image. Explain briefly how you used them. The supplied creative reference photos remain viewing-only and must not be used as generation inputs or copied.
If you finish the required images with time and credit remaining, you may create additional original images. These must fit within the same $5 total task budget, including all required images, retries, corrections, and extras.
Upload additional images as working files. Extra points will be based on quality, creativity, and useful variety—not quantity alone. Prioritise completing and checking the required images first.

Test 7 — Spot The Mistake: 10 Images
Working time: 5 minutes
Deliverables: Completed timed assessment
You’ll be shown 10 images, one at a time. You have 30 seconds per image to identify what’s wrong and write down your answer before the next image appears.
You will not be able to review the other images prior. Only when each one shows up with the 30s timer.
