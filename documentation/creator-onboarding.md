# Creator Onboarding (the recruiting funnel after the application)

> Everything between "someone emails hello@bluurock.com" and "we have their Telegram handle and their onboarding answers": the inbound email triage, the approval → welcome email, the personal onboarding form at `/join/[token]`, and the staff page Creator Portal → Onboarding. The application form itself (`/model-submissions`) and its review queue are in [model-submissions.md](model-submissions.md) — read that first; this spoke picks up where it ends.

```
 enquiry email ─► Gmail (hello@) ─auto-forward─► Resend receiving ─► POST /api/email/inbound
                                                                        │ classify (rules only)
                                                ┌───────────────────────┼─────────────────────┐
                                             reply                    held               spam / system
                                   "Hey Name! … Form: /model-submissions"   │                (logged only)
                                                                  Onboarding → Inbox → "Send reply"
 applicant fills /model-submissions ─► Creator Portal → Model Submissions ─ Approve
                                                                        │ "Email them their onboarding link?" card
                                                                        ▼ POST /api/creator-onboarding/invite
                                              "Welcome to BLUU ROCK 🎉" email with /join/<token>
                                                                        ▼
                         /join/<token>: welcome pass → You · Your limits · Your persona → review → send
                                                                        ▼ POST /api/join/<token>/complete
                                   notification (+Telegram) ─► Creator Portal → Onboarding → "Message @handle"
```

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/creatorOnboarding.ts` | **The question model** — every question once, as data (tracks, required rules, formats), plus progress, sanitising and the staff stage vocabulary. Client + server. |
| `src/lib/email/inquiryFilter.ts` | **Pure** rules-only classifier for inbound mail (`reply` / `held` / `spam` / `system`) and the contact-form relay parser |
| `src/lib/email/resend.ts` | Resend clients (sending key vs inbound key), `EMAIL_FROM`, `sendEmail` |
| `src/lib/email/templates.ts` | **All email copy** — the enquiry reply and the welcome/onboarding email |
| `src/lib/services/creatorInquiryService.ts` | Webhook handling: fetch body, classify, dedupe, hourly cap, reply; Inbox reads; manual reply |
| `src/lib/services/creatorOnboardingService.ts` | Link tokens, invites (create/rotate), prefill, autosave, completion, staff reads |
| `src/app/api/email/inbound/route.ts` | **PUBLIC** — Resend `email.received` webhook (Svix-signed) |
| `src/app/api/join/[token]/route.ts` · `…/complete/route.ts` | **PUBLIC** — autosave (PATCH) and submit (POST); the token is the credential |
| `src/app/api/creator-onboarding/invite/route.ts` | Send / re-send the welcome email (either page permission) |
| `src/app/api/creator-onboarding/route.ts` · `[id]/route.ts` | Staff list (projected, no answers) and one record |
| `src/app/api/creator-inquiries/route.ts` · `[id]/reply/route.ts` | Inbox list and manual reply |
| `src/app/join/` | The public onboarding surface (server shell + `_components/` + `_lib/useAutosave.ts`) |
| `src/app/(main)/creator-portal/onboarding/` | Staff page: Applicants + Inbox tabs, answers sheet |
| `src/app/(main)/creator-portal/model-submissions/components/InvitePromptCard.tsx` | The approval → "email their onboarding link?" card |
| `src/lib/services/pageNotify.ts` | `notifyPageHolders(pageId, content)` — in-app + Telegram to every holder of a page permission |
| `src/hooks/useCreatorOnboarding.ts` | `useOnboardings`, `useOnboardingDetail`, `useInquiries` |
| `src/scripts/test-inquiry-filter.ts` | Fixture check for the filter — `node --experimental-strip-types scripts/test-inquiry-filter.ts` |
| `src/scripts/seed-onboarding-permission.js` | One-off: copies the Model Submissions permission map to `creators-onboarding` |
| `model-onboarding.md` (repo root) | The source questionnaire the question model was built from |

## Firestore

| Collection | Contents | Client access |
|---|---|---|
| `creator-onboarding/{submissionId}` | One per approved application: name/email/whatsapp/telegram/stageName (denormalised for the list), `track`, `status`, `answers` (flat map), `cursor`, progress counters, `tokenHash`, invite trail | **Denied** |
| `creator-inquiries/{resendEmailId}` | One per received email: sender, parsed reply address/name, subject, snippet, verdict, reasons, score, outcome, reply trail | **Denied** |
| `model-submissions/{id}` | gains `onboardingInvitedAt` / `onboardingInvitedBy` | (unchanged: denied) |

Keyed by the application id and by Resend's email id respectively — so the two records join without a lookup, and a redelivered webhook is a no-op. `answers`, `tokenHash`, `cursor`, `snippet`, `reasons`, `subject` and `messageId` are exempt from indexing (rule 9). No composite index: the only queries are single-field (`orderBy invitedAt` / `receivedAt`, `where replyTo ==`, `where autoRepliedAt >`).

---

## Inbound email: hello@ → the auto-reply

**Routing.** `bluurock.com` mail is Google Workspace. Resend only receives mail routed to it, and its docs warn that adding its MX beside an existing provider breaks delivery to one or the other — so hello@ is **auto-forwarded from Gmail** to the Resend receiving address (`<anything>@<id>.resend.app`). Humans still see every message in Gmail; the app only decides whether to answer.

**The webhook carries metadata only.** `email.received` has no body, so `handleReceivedEmail` fetches it with `resend.emails.receiving.get(id)`. That endpoint refuses a sending-only key (`restricted_api_key`) — hence `RESEND_INBOUND_API_KEY` (below).

**Contact-form relays.** Much of the mail is the website contact form, relayed by the web host: the `From` is the host, and the applicant's real address is in the body (`Name: … Email: … Subject: … Message: …`). `parseInquiry` detects that shape and replies to the address in the body, greets the name in the body, and does **not** thread the reply (the relay's Message-ID means nothing in the applicant's inbox). A direct email replies to `Reply-To` or the sender and threads with `In-Reply-To`/`References`.

### The filter is rules only, and biased toward NOT replying

An auto-reply is outbound mail from our domain. Answering spam teaches the sender the inbox is live; answering a forged address makes hello@ a backscatter source. So:

| Verdict | When | What happens |
|---|---|---|
| `system` | Gmail forwarding confirmation, `mailer-daemon`/`no-reply`-style senders, `Auto-Submitted`, `Precedence: bulk`, `List-Unsubscribe`, or a reply address on `@bluurock.com` (loop guard) | logged, never answered. The Gmail confirmation keeps its whole body so the Inbox can show the link |
| `spam` | spam score ≥ 5 (SEO/dev/crypto/prize/phishing vocabulary, ≥3 links, shorteners, disposable domains, a URL in the name field, gibberish, mostly non-Latin, DMARC fail on a direct email) | logged, never answered |
| `reply` | **two or more** independent creator signals (OnlyFans, creator, model, management, agency, audience, "join", growth…) **and** score ≤ 2 | templated reply sent |
| `held` | everything else — plausible but unproven | logged on **Onboarding → Inbox → Needs a look**, one click to reply |

Strong spam evidence beats relevance: "social media **management** services for your **content**" is still a pitch. Every verdict carries its human-readable `reasons`, shown on the row — a filter nobody can see into cannot be trusted or tuned.

Two more guards before any automatic send: **one auto-reply per address per 14 days** (a second enquiry logs `duplicate`), and **at most 20 automatic replies per rolling hour** (past that, `rate-limited` → held for a person). A spam run that beats the rules still cannot turn hello@ into a bulk sender.

**Changing a rule:** add the email that fooled it to `scripts/test-inquiry-filter.ts` first, then change the rule until every fixture passes.

## Approval → the welcome email

Approving an application on Model Submissions raises a non-modal card (top-right under the top bar, banner layer — bottom-right is reserved for toasts; DESIGN.md §5 The Corner Rule): *"Email {name} their onboarding link?"*. It never takes focus, so a reviewer approving a run of applicants keeps working the grid. Approved cards also carry an **Invite / Invited** action to send later or re-send.

`POST /api/creator-onboarding/invite` refuses unless the application is `approved` and has an email, and refuses a re-send once the form is completed. It creates `creator-onboarding/{id}` (first time, with **prefilled answers**) or **rotates the link** (re-send), then sends **"Welcome to BLUU ROCK 🎉"** from `hello@bluurock.com` with Resend idempotency key `onboarding-invite/<id>/<n>`. Either page permission (`apps-model-submissions` or `creators-onboarding`) may call it — both pages already show that applicant.

**Track:** `hasOnlyFans` on the application → `'of'` (questionnaire "2. OF") or `'no-of'` ("1. NO OF"). Parts II and III are shared.

**Prefill** (`prefillFrom`): Telegram, city, country, social links, orientation (+ persona sexuality), OF trial link, persona location and age. Only what the applicant actually gave — never a plausible default. Prefilled questions say "From your application — change it if it's out of date."

## The link: `/join/<token>`

- `token = <32-hex application id><base64url 160-bit secret>`. Only `sha256(secret)` is stored; the check is one document read by id plus a timing-safe compare. Every refusal is the same not-found — no probing which half failed.
- **Re-sending rotates the secret**: the old link dies immediately, answers are kept.
- Browser-allowlisted in `middleware.ts`; `noindex`; `NoTranslate` on the route (the same React-root crash as the application form — see model-submissions.md).
- The page is a server component that calls `openByToken` directly — no public GET route to rate-limit — and projects only name, track, status, answers, cursor, approval/completion dates and a non-secret pass number. Never the email, the hash or the reviewer. The render itself is **read-only**: `openedAt` is stamped by an empty autosave the page sends from the browser on first load, because mail security scanners (Outlook Safe Links etc.) pre-fetch every link in an email — a server-side stamp would mark people "opened" who never saw it. An empty patch stamps `openedAt` once and nothing else; it never moves a record to `started`.

### Nothing is lost — three layers (`_lib/useAutosave.ts`)

1. **Server autosave**, ~700ms after the last keystroke, PATCHing only changed keys. The server writes `answers.<id>` field paths, so a save can never erase a field it did not mention (two tabs cannot clobber each other).
2. **A local pending buffer** in `localStorage`, holding **only keys the server has not yet acknowledged**, cleared per key on acknowledgement. A tab that dies offline re-sends on the next visit on that device. This is a delivery queue, not a copy of the form — which is why it does not contradict the application form's "no PII on disk" rule: there, the browser is the only draft; here, the server is, and the local copy is bounded to the gap before acknowledgement.
3. **`pagehide` / hidden flush** with `keepalive: true`.

Failures retry with backoff (2→30s) and immediately on `online`. `409` = already submitted (another tab) → the page shows the ending; `404` = link rotated → says so. The resume cursor (`{chapter, screen}`) rides every save, so reopening the link lands where they left.

### Required vs optional (the reasoning)

Required = what staff cannot work without, or what the chat team must know: stage name, Telegram (the creator portal is a Telegram Mini App), date of birth (18+ is enforced), location, socials, equipment, shooting locations, solo hours, earnings goal, commitment/other-platform/content-house answers, privacy answers; on the OF track the trial link, current price, last month's net, PPV frequency and (unless "Never") PPV price; **every** content-limit yes/no; and the persona's age, sex, sexuality, location, personality and interests. Everything else — duo hours, TikTok, sales history, custom pricing, top %, notes, looks, likes/dislikes — is optional. Formats (date, handle, money, numbers) are checked on Continue and again on the server at submit; autosave accepts half-typed values.

### Why it doesn't feel long

Three **sets** with honest minutes (You 6 · Your limits 3 · Your persona 4), small screens of 2–7 questions, a **deck** for limits (one card, Yes/No, `Y`/`N`/`←`, a tally rail that doubles as navigation), a **live persona card** that fills as Part III is answered, and a **set break** between sets. See DESIGN.md §8 → The onboarding pass for the visual rules.

### Completion

`POST /api/join/<token>/complete` folds in any unsaved keys, re-validates every requirement against the shared model (returning field errors to jump to), locks the record, and notifies every holder of `creators-onboarding` in-app and on Telegram (`notifications.creatorOnboardingCompleted`, catalogued in `automatedNotifications.ts`). The page stamps the pass "Onboarded"; reopening the link later shows the stamped pass quietly.

## The staff page: Creator Portal → Onboarding

- Page `creators-onboarding` (its own permission). Seed it as a copy of Model Submissions' with `node scripts/seed-onboarding-permission.js --write`, then `node scripts/repair-permissions.js --fix` (or wait for the 03:00 UTC sync).
- **Applicants** tab, defaulting to **Completed** — the rows ready to act on, each with **Message @handle** (t.me, opened in the system browser) and copy. Other stages: In progress, **Stalled** (derived: started and silent for `STALL_AFTER_DAYS` = 5 — not stored, so no job maintains it), Not opened. Non-completed rows offer **Send new link** (rotates + re-sends).
- The list API projects with `select()` — answers never travel until a row is opened. The answers sheet lays them out for use: contact first, "You" as label/value, limits as **Will make / Won't make** columns with notes, then the persona.
- **Inbox** tab, defaulting to **Needs a look** (held, failed, rate-limited). Every row shows the filter's reasons; **Send reply** sends the standard reply by hand (idempotency key `inquiry-reply/<id>`; a second reply is refused).

Model Submissions itself moved into the Creator Portal on 2026-09-28 (`/creator-portal/model-submissions`). Its pageId stays `apps-model-submissions` deliberately — renaming it would revoke it from everyone. `/applications/apps-model-submissions` 307-redirects (old notifications carry that `actionUrl`).

## Email

- **From** `Bluu Rock <hello@bluurock.com>`, **Reply-To** hello@ — replies land in the same Gmail inbox. `bluurock.com` must stay verified for sending in Resend (DKIM `resend._domainkey` is published).
- `RESEND_API_KEY` — **sending-only** key, used by every send.
- `RESEND_INBOUND_API_KEY` — **full-access** key, used **only** to read received email bodies. Falls back to `RESEND_API_KEY` if that one is full-access.
- `RESEND_WEBHOOK_SECRET` — the `whsec_…` signing secret of the receiving webhook. Unset → the webhook answers 503.
- Copy lives only in `src/lib/email/templates.ts`. The welcome subject is exactly `Welcome to BLUU ROCK 🎉`.

## Setup (one time)

1. Resend → Domains → `bluurock.com`: confirm sending is verified. Resend → Receiving: note the `<id>.resend.app` receiving domain.
2. Resend → Webhooks → add `https://app.bluurock.com/api/email/inbound` for `email.received` (a webhook still on the legacy `bluu-backend.vercel.app` host keeps working — `/api` is never redirected); copy its signing secret into `RESEND_WEBHOOK_SECRET` on Vercel.
3. Create a full-access API key → `RESEND_INBOUND_API_KEY` on Vercel.
4. Gmail (hello@) → Settings → Forwarding → add `hello@<id>.resend.app`. Gmail emails a confirmation to that address: it arrives in **Onboarding → Inbox** (filter "Filtered out" / "All", verdict *Automated*) with the link clickable — open it to confirm. Then enable forwarding (keep Gmail's copy).
5. **The website contact form needs its own route in.** It sends **from hello@ to hello@**, and Gmail does not auto-forward mail the account itself sent — so step 4 never passes these on, and they never reach Resend. In the form's notification settings, add the Resend receiving address as a second recipient (or BCC) alongside hello@. The filter already handles this shape: the reply goes to the `Email:` in the body (fixture: "website form sent from hello@ to hello@"), and a form with no email in it hits the loop guard instead of replying to hello@. If a form message ever arrives by both routes, the 14-day per-address window stops a second reply.
6. Seed the page permission (above) and deploy the Firestore rules + indexes.

## Rules for changing this subsystem

1. **Every question lives in `creatorOnboarding.ts`.** Never add a field to a form screen without adding it there — `sanitisePatch` drops unknown keys, so the server would silently discard it.
2. **A question id is a Firestore field path.** `[A-Za-z0-9_]` only, never renamed once shipped (stored answers are keyed by it).
3. **Never auto-reply on relevance alone.** Strong spam evidence always wins; unsure means `held`.
4. **Never put the link secret anywhere but the URL** — not in storage keys (the pending buffer is keyed by the id half), not in logs.
5. **Copy only in `templates.ts`** (emails) and `notificationContent.ts` (notifications).
6. **No invented claims on `/join`** — no acceptance rates, roster sizes or earnings. The exclusivity is true facts: hand review, a personal link.
