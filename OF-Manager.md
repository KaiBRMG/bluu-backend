# OnlyFans CRM — Implementation Roadmap

## Context

This is an additive feature to an existing SaaS application built as a **Next.js web app wrapped in an Electron container** (desktop-only). The OnlyFans CRM lives in a dedicated Electron window, spawned from the main app's sidebar. The underlying data layer interfaces with a **third-party OnlyFans API provider** via a clean adapter interface, designed for future provider replacement without rearchitecting.

**Reference documentation:** the living spoke for this subsystem is [`documentation/onlyfans-crm.md`](documentation/onlyfans-crm.md) — read it before touching any of the code named below. This file is the *roadmap* (what is done, what is next); the spoke is the *system of record* (how it works and why). Keep both current.

---

## Guiding Architecture Principle

All OnlyFans operations must go through a single adapter interface (`IOnlyFansClient`). No component, hook, or service may call a provider's SDK or HTTP endpoints directly. This is the non-negotiable prerequisite for plug-and-play provider replacement, and it holds for every phase below — a new capability starts by being added to the contract in `src/lib/onlyfans/types.ts`, never by reaching past it.

---

# Part I — Shipped (Phases 1–2)

## Phase 1 — Config & window ✅

- **Sidebar entry.** `apps-ofmanager` in `src/lib/definitions.ts` (`icon: 'OnlyFans'`, `href: null` — it opens a window instead of navigating). Rendered by `OfManagerButton` in `src/components/Sidebar.tsx`, gated on the user's shared pages.
- **Dedicated Electron window.** `openSatelliteWindow` in `electron/main.js`. Independently resizable with its own minimums; one window per `key` (a second click focuses the existing one); closes with the main window via `mainWindow.on('closed', closeAllSatellites)` — hooked to `closed`, not `close`, so the clock-out flush veto still runs.
- **Never `parent: mainWindow`.** A parented window is pinned above its parent on macOS for its whole life, which leaves the main window permanently behind it. The two are co-equal; the close-dependency is enforced by hand.
- **Permission is checked in the main process, server-side.** The window is not created until the renderer's Firebase ID token has been POSTed to `/api/onlyfans/access` and returned 200. Hiding the sidebar item is convenience; this is the gate.
- **Generalised to satellites (v0.10.0+).** The shell accepts any path under `/of-manager`, so a popped-out chat or a vault browser is a *web deploy*, not a native release. Cap of 8 windows; the path is validated as untrusted input. Only a new non-`/of-manager` prefix needs a native build.

## Phase 2 — Messaging on one account ✅

One linked test account, messaging only. Delivered:

- **Chat list** — search, All/Pinned/Unread filters, load-older paging, unread badges, spend chip, realtime via `onSnapshot`.
- **Thread** — history lazy-loaded on scroll-up, live tail, optimistic send, mark-as-read (once per thread per session — it costs a provider call).
- **Refresh drives both panes** — the list is a Firestore mirror; the thread is provider history the sync never touches, so a `threadReloadToken` re-pulls it, bypassing the 60s history cache without blanking the pane.

### What exists in code

| File | Role |
|---|---|
| `src/lib/onlyfans/types.ts` | Domain model + the `IOnlyFansClient` contract |
| `src/lib/onlyfans/providers/onlyfansApi.ts` | **The only** file that knows the provider's URLs/payloads |
| `src/lib/onlyfans/index.ts` | `getOnlyFansClient()` factory + `resolveAccountId()` |
| `src/lib/services/onlyfansService.ts` | Access gate, Firestore mirror, sync, live-message writes |
| `src/app/api/onlyfans/access/route.ts` | Permission probe for the Electron main process |
| `src/app/api/onlyfans/chats/route.ts` | Warms the mirror (rate-limited sync) |
| `src/app/api/onlyfans/chats/[chatId]/messages/route.ts` | History page (GET) + send (POST) |
| `src/app/api/onlyfans/chats/[chatId]/read/route.ts` | Mark thread read |
| `src/app/api/onlyfans/webhook/[secret]/route.ts` | Provider push → Firestore mirror |
| `src/app/of-manager/**` | The window: layout, guard, `ChatList`, `ChatThread` |
| `src/hooks/useOnlyFansChats.ts` / `useOnlyFansMessages.ts` | Client data hooks |

`IOnlyFansClient` currently covers: `listAccounts`, `listChats`, `listMessages`, `sendMessage` (media + PPV since 3b), `markChatRead`, `resolveMediaUrl` (3a), `listVaultLists` / `listVaultMedia` / `uploadMediaFromUrl` (3b), `setMessagePinned` / `setMessageLiked` / `getFanNotes` (3c), `verifyWebhookSignature`, `parseWebhookEvent`.

### Cost model established (do not regress)

- **The chat list is mirrored; history is not.** A thread is thousands of messages read once — mirroring it would be the most expensive thing this feature does. History pages from the provider on demand, cached in `sessionStorage` for 60s.
- **Realtime is webhook-driven, not polled.** Webhook writes land in the docs the window already listens to: a new message costs zero provider calls and one Firestore read.
- **`syncChats` is rate limited twice** — in-process timestamp (free) *and* `onlyfans-meta/{accountId}.chatsSyncedAt` (authoritative across serverless instances). `?refresh=1` bypasses both, and only ever on an explicit click.
- **The mirror is diffed before writing** (`chatChanged`) — a sync over an idle inbox costs zero writes.
- **Unread counts use `FieldValue.increment`** — never a read-modify-write.

### Security posture established

Three independent layers: the Electron main-process check, `requireOnlyFansAccess(uid)` at the top of **every** route, and Firestore rules gating the mirror on `hasPagePermission('apps-ofmanager')` rather than `isSignedIn()`. The webhook is unauthenticated by construction — the path secret is the credential (constant-time compared, wrong secret → **404**, never 401), with HMAC verification of the raw body when a signature header is present. The API key never leaves the server. Message bodies arrive as HTML and are stripped to plain text at the adapter boundary.

### Deliberately not built in Phases 1–2

Vault/media upload, PPV composition, per-function permissions, audit logs, time-tracking gating, links to the `creators` collection, earnings, notifications, multi-account. Media on existing messages rendered as an attachment chip, not an image — **that part is done, in pass 3a**; **vault + upload + PPV composition are done in pass 3b**; **message affordances, the fan panel and list ergonomics are done in pass 3c.** Everything else is in Part II below.

## Pitfalls already paid for — do not regress

Each of these was a real bug. The shape of the code is the fix, so a "tidy-up" that reverts one brings the bug back.

**Layout & rendering**

- **Never size this window in `vw`/`vh`.** Windows Electron uses classic space-consuming scrollbars, so a `w-screen`/`h-screen` shell self-oscillates: `100vw` exceeds the client width the moment a vertical scrollbar exists → a horizontal scrollbar appears → it eats height → `100vh` now exceeds the client height → the scrollbar it needs narrows the width again. Symptom: the window scrolls slightly past its own bottom and flickers under the cursor. The layout is one `fixed inset-0 overflow-hidden` box; everything below it is `h-full`/`w-full`.
- **Both scroll containers are `overscroll-contain`**, so a wheel event that runs out of list does not chain to the document behind it.
- **No `filter` on row hover.** A `hover:brightness-*` makes Chromium promote and re-rasterise the entire row — avatar included — on every enter and leave, which tears visibly when the cursor is dragged down a long list. Colour and transform only. A selected row also needs its *own* hover state, or hovering the selected row appears dead.
- **Load-older must anchor the scroll.** `ChatThread` captures `scrollHeight` before the older page lands and restores `scrollTop = scrollHeight - saved` after. Without it the viewport jumps to a random point in history every time the operator scrolls up.

**The window**

- **Never `parent: mainWindow`.** macOS pins a child window above its parent for as long as it lives, leaving the main window permanently behind and effectively unusable. The satellite is co-equal; the close-dependency is manual.
- **Hook the dependency to `closed`, not `close`** — `close` runs before the clock-out flush veto and would skip it. And it is not optional: without it `window-all-closed` never fires and the app never quits.

**Send & thread state**

- **There is deliberately no `failed` message state.** The earlier version kept a red bubble *and* refilled the composer: the operator saw one unsent message twice, the ghost never cleared, and every retry appended another. A failed send removes its row and returns `false`; **the composer is the only place unsent text lives.**
- **`error` is cleared at the start of every attempt**, or a second identical failure produces no toast.
- **Refresh must move the thread, not just the list.** They have unrelated freshness models — the list is a Firestore mirror the sync rewrites, the thread is provider history the sync never touches. Without `threadReloadToken`, pressing refresh leaves the one pane the operator is actually reading unchanged.
- **A reload is not a chat switch.** It must bypass the 60s `sessionStorage` history cache (serving the copy the operator just asked to replace is the one thing refresh must never do), must *not* blank `history`/`loading` (the thread flashes a skeleton), and must *not* clear `optimistic` (an in-flight send loses its bubble). `seenReloadRef` is what distinguishes the two cases.
- **History and the live tail legitimately overlap** — the same message appears in both once the next history page is fetched. Dedupe by message id. The send route and the `messages.sent` webhook both write the same doc id, which is what makes double-delivery harmless.

**Cost**

- **Forgetting a field in `chatChanged` is a silent, permanent cost regression.** Add a field to the mirror without adding it to the diff and every sync rewrites every row forever — nothing breaks, it just bills.
- **Mark-as-read costs a provider call**, hence `markedRef`: once per thread per session.
- **Never read-modify-write an unread count.** `FieldValue.increment` keeps it a single blind write; a transaction costs a Firestore read on every inbound message.
- **Mounting the hooks repeatedly is cheap by design** (the sync is rate limited server-side) — do not add client-side "don't fetch" cleverness on top of it.

**Provider boundary**

- **A message cursor *is* a provider-supplied URL**, followed verbatim. The adapter refuses to call any origin but the provider's — that guard is what stops a poisoned cursor from exfiltrating the API key. Never relax it.
- **Message bodies arrive as HTML** and are stripped to plain text at the adapter boundary. Render text nodes only; never `dangerouslySetInnerHTML`.
- **Webhooks are best-effort and must never be load-bearing.** The provider documents event *names* but not payload bodies or headers, so both the signature check and the parse live behind the adapter and probe across plausible spellings. An unrecognised payload is 200'd, not retried — the next chat sync self-corrects. Only a failed Firestore write returns 5xx. A wrong path secret returns **404, never 401**, so the endpoint's existence is not confirmed.
- **`resolveAccountId()` guesses.** With `ONLYFANS_ACCOUNT_ID` unset it takes the first authenticated account — correct only while exactly one is linked. See Phase 4.
- **The client caches the account id for 30 minutes** (`bluu_of_account_v1`, `sessionStorage`). Anything that changes which account is operated must invalidate it.

---

# Part II — Upcoming work

Phases are ordered by dependency, not by appetite. **Phase 3 is complete** (see Part I). **Phase 4 (multi-account) is the structural unlock and blocks 5, 8 and 9, and it is next.** Do not start sales tracking or multi-account views before the account model is real.

---

## Phase 3 — Chat interface fine-tuning ✅

**Complete** (3a, 3a.1, 3b, 3c). Kept here rather than moved into Part I because
the research below it — the media payload, the DRM finding, the three-cases table
— is the record of *why* the shipped code is shaped the way it is, and it belongs
next to the passes it decided.

Polish and completeness on the surface that already exists. No Firestore schema
change and no rules/index change in any pass. Split into passes because media
alone was larger than it looked.

### Pass 3a — media rendering ✅

Shipped. Inline media on received messages, end to end. What landed:

- **`attachments: OFAttachment[]` on `OFMessage`**, alongside the existing `mediaCount` (the two legitimately disagree — a chat row's embedded `lastMessage` carries a count with no `media[]`). `resolveMediaUrl(accountId, cdnUrl) → ResolvedMedia` is on `IOnlyFansClient`.
- **`POST /api/onlyfans/media/resolve`** — batched (12 max), per-URL failures, `requireOnlyFansAccess` first.
- **Lazy + batched + memoised resolution.** `useOnlyFansMedia.ts`: IntersectionObserver gate (200px margin), 30ms request coalescing, module-level TTL cache; `resolveMediaUrlCached` memoises server-side. Tiles request `preview`, never `full` — full resolution is an explicit click.
- **`stripMediaUrls`** blanks every CDN link before a message is written to Firestore, and `mergeMessage` in `useOnlyFansMessages` stops the URL-less live copy from blanking a history copy that still has resolvable links.
- **Rendering:** photo/GIF/plain-video tiles, blurred locked-PPV previews, a DRM poster + "not playable" line, per-message PPV price row (orange locked / green unlocked), a `Dialog` lightbox. Every tile reserves its aspect ratio from mirrored metadata so it does not fight `ChatThread`'s scroll anchoring.

Two things resolved along the way, both now in the spoke:

- **The origin guard did not need relaxing after all.** The download redirect is followed with `redirect: 'manual'` and only the `Location` is returned, so the API key still never leaves the provider's host. The earlier note about allowlisting `cdn.fansapi.com`/`dl.fansapi.com` applies to the *redirect target check*, not to `request()`.
- **The provider has no unsend.** `/messages/{message_id}` is `GET` only (plus pin/unpin/like/unlike), so the "delete/unsend" bullet below is dead — it becomes copy + reply + pin + like.

#### Pass 3a.1 — latency, resilience and tips ✅

A follow-up pass against "opening a chat, then another, then the first again buffers" and "everything is slow". Full detail in the spoke ([Latency](documentation/onlyfans-crm.md#latency-what-makes-this-window-feel-fast), [Tips](documentation/onlyfans-crm.md#tips)).

- **The A → B → A complaint was the history TTL.** 60s, governing *display* only, so a minute away meant a blank pane, a skeleton and a billed call. Now: 10-minute stale-while-revalidate, plus a 20s window in which re-opening makes **no request at all**.
- **Server-side page memo + in-flight dedupe** (20s). Two operators opening one chat cost one provider call. A send invalidates that chat's pages; `?refresh=1` bypasses everything.
- **First paint no longer waits on the provider** — `GET /api/onlyfans/account` resolves the account id for free so the snapshot listener attaches immediately. **Pinning `ONLYFANS_ACCOUNT_ID` is a latency fix too**, not only the Phase 4 correctness one.
- **Fixed a silent billing loop.** The `fanMissing` back-fill was guarded by an in-flight boolean only, so an unreachable fan re-fired a forced provider sync on *every* snapshot — and each sync produced another snapshot. Now one attempt per chat, ever.
- **Media TTL 45s → 5 min with `onError` re-resolve.** The short TTL was a cost bug; scrolling a tile out of view and back was re-billing it.
- **Degradation is visible:** offline strip, inline chat-list error with Retry (not a toast — it is state, not an event), and a thread error state that never masquerades as "No messages yet".
- **Tips are rendered properly.** Took three passes and two wrong guesses, both from assuming the documented payload was complete:
  1. The shared PPV row labelled a tip "$50 locked" — `price` is not an unlock price on a tip.
  2. Reading `price` rendered every tip as **"$0"** — the provider sends `price: 0` on tips, and documents **no tip-amount field at all**.
  3. Now: `price` is the PPV price only (forced to 0 on tips) and **`tipAmount`** carries the money, filled by `parseTip` probing the plausible spellings and falling back to the figure in the provider's own generated sentence. That sentence (`I sent you a $150.00 tip`) is stripped from `text`, so what remains is the fan's actual note. A zero amount renders as "Tip", never "$0".

  **Phase 8 depends on this:** earnings must sum `tipAmount`, or every tip counts as zero.

### Pass 3b — composer ✅

Shipped. The composer now holds **everything unsent** — text, staged
attachments, PPV price — and nothing else does. Full detail in the spoke
([Composing a message](documentation/onlyfans-crm.md#composing-a-message)).

What landed:

- **Attachments three ways** — file picker, drag-drop onto the composer, and
  paste. A pasted screenshot is a real `File` on `clipboardData` in Chromium, so
  `clipboard.readImage()` was not needed after all: **no Electron change, no
  rule-14 build**.
- **The bytes never pass through our API.** Vercel caps a request body at ~4.5MB
  and the media operators send is routinely larger, so it is three hops:
  `/api/onlyfans/media/upload-url` signs a v4 Storage PUT → the browser uploads
  straight to GCS (XHR, for progress) → `/api/onlyfans/media/upload` signs a
  10-minute read URL, the provider fetches it, and the staged object is deleted.
  Path is server-chosen and re-derived per uid; the signature pins the content
  type. **No Storage rules involved** — signed URLs bypass them.
- **Vault picker** as a `Dialog`: categories, type filters, search-on-submit,
  explicit paging, multi-select. Vault media *is* `OFAttachment`, so it reuses
  the normaliser, the tile contract and the lazy-resolve gate wholesale.
- **PPV** — price control disabled without media (the provider rejects a priced
  message with nothing to unlock, so the button says so rather than the send
  failing later), bounds of 0 or $3–$200 enforced in three places, per-tile
  preview toggles, optional locked text, and a strip that states the preview
  count because "nothing shown before unlocking" is a real choice.
- **Drafts** persist per account+chat in `localStorage`, cleared only by a
  confirmed send. Staged upload ids ride along — they are billed and single-use,
  so dropping them on window close means paying twice. CDN preview links are
  blanked on save, exactly as `stripMediaUrls` does for the mirror.
- **Emoji** as a `Popover` over a curated set (shadcn only; no picker library),
  auto-growing multi-line textarea, character counter past 4500, attachment
  counter, and a **visible stub** for tagging creators — it needs Phase 5's
  registry, and a button that silently did nothing would be worse.

Two operational notes carried out of this pass:

- **Orphaned uploads are not cleaned up.** A file PUT to the signed slot whose
  commit never runs (window closed mid-compose) stays in `onlyfans-outgoing/`. A
  bucket lifecycle rule on that prefix is the fix — nothing in the app leaks it,
  but nothing sweeps it either.
- **Storage rules were not touched** and did not need to be. Worth confirming the
  project's rules do not let the *client SDK* read `onlyfans-outgoing/`; the
  route path is signed-URL only and unaffected either way.

### Pass 3c — thread affordances and list ergonomics ✅

Shipped, and **Phase 3 is complete**. Full detail in the spoke ([the message
menu](documentation/onlyfans-crm.md#the-message-menu-and-the-two-things-it-cannot-do),
[the fan panel](documentation/onlyfans-crm.md#the-fan-panel), [working the list
without the mouse](documentation/onlyfans-crm.md#working-the-list-without-the-mouse)).

- **Message affordances** — reply, copy, pin/unpin, like/unlike, in one menu per
  bubble revealed on hover *and* keyboard focus. Optimistic and **reverted** on
  failure, which is the opposite trade to a send: a failed pin has no unsent work
  to protect, so the honest thing is to put the flag back. The override lives in
  a `flags` map applied at merge time, because history and the live tail are
  unwritable in different ways.
- **Fan context panel** — a third pane, default closed, remembered. **It costs
  zero provider calls:** the chat-list payload already embeds a full fan profile
  (subscription status and dates, the spend split, join date, location, bio), so
  it is mirrored and read from Firestore. Notes are the one billed part and sit
  behind an explicit click. Mirroring the profile meant teaching `chatChanged`
  about it — via a digest that deliberately **excludes `lastSeen`**, which is on
  the same payload and would otherwise rewrite every row on every sync forever.
- **List refinements** — saved filter + sort (Most recent / Unread first /
  Highest spend), `j`/`k`/arrows, Enter, Escape. The keys move **DOM focus, not
  selection**: opening a chat fires a billed mark-as-read, so a cursor that
  selected as it moved would be a call per keystroke. Focus also means the
  browser owns the ring and the scroll-into-view, and there is no second cursor
  state to keep in sync.
- **Empty/error/offline states** — the composer disables Send behind an offline
  strip (the draft persists, so nothing is lost), a failed upload is retryable in
  place from the chip (nothing was staged, so a retry is free), and the vault
  dialog's error state grew a Retry and names offline as itself rather than
  reporting it as a vault failure.
- **Performance** — the chat list uses `content-visibility: auto` with a
  remembered intrinsic size rather than a virtualiser. Chromium skips style,
  layout and paint for offscreen rows while **every row stays in the DOM**, which
  is what `j`/`k`, find-in-page and the screen reader all need. This window is
  Chromium-only, so there is no fallback to carry.

Three things settled along the way, all now in the spoke:

- **The provider never reports a reply target.** It accepts `replyToMessageId` on
  a send and reports it on no message it returns — so the composer's quote strip
  is the only place the relationship is ever visible, and it exists until Send.
  Not a gap in the UI; the thread cannot render what it is never told.
- **`subscribedOnData`, not `subscribedByData`.** The two are mirror images on the
  same object and only the first carries the spend sums. The choice is made once,
  in `normaliseFanProfile`.
- **The thread is deliberately still un-windowed.** `ChatThread` restores
  `scrollTop` around content-height changes and media tiles reserve their aspect
  ratios for that same reason; a virtualiser estimating those heights fights both,
  and the list's `content-visibility` trick does not transfer — it estimates
  content that has never rendered, which is exactly what gets prepended above the
  viewport. Whichever virtualiser is eventually chosen must **own** the anchoring.
  Left as the one open item of Phase 3, tracked in the spoke's gotchas.

### Media: how it actually works

Researched against `openapi.yaml` and the provider docs, then **implemented in pass 3a**. Kept here as the research record; the living description of the shipped behaviour is [onlyfans-crm.md § Media](documentation/onlyfans-crm.md#media). One of the three cases below cannot be built at all in the current app.

**The payload.** Each message carries `mediaCount` and a `media[]` array ([openapi.yaml:12698-12780](openapi.yaml#L12698-L12780)):

```
id, type (photo|video|gif|audio), convertedToVideo, canView,
hasError, createdAt, isReady, duration, hasCustomPreview
files.full          { url, width, height, size, sources[] }
files.thumb         { url, width, height, size }   // 300x300
files.preview       { url, width, height, size }
files.squarePreview { url, width, height, size }   // 960x960
files.drm           { manifest:{hls,dash}, signature:{hls:{…},dash:{…}} }  // DRM only
videoSources        { "240": url|null, "720": url|null }
```

**Those URLs cannot be fetched.** `cdn*.onlyfans.com` is IP-locked to the provider's proxy. Every URL must be resolved through:

**`GET /api/{account}/media/download/{cdnUrl}`** → `302`

- `cdnUrl` is the **whole CDN URL including its query string**, percent-encoded into one path segment.
- Redirects to `cdn.fansapi.com` when cached (free) or `dl.fansapi.com` otherwise, which streams through the account proxy and **reports billing back** — uncached media costs credits (consider adding a download button for old media in chats).
- Must use the **same account id** that fetched the URL. On `403`: re-fetch the URL from the messages endpoint and retry.

**Expiry — the docs contradict themselves.** The `cdnUrl` parameter says URLs "expire in approx. 20 minutes"; the 403 FAQ says "don't wait longer than **1 minute**". Budget for 1 minute. Either way, far too short to persist.

**Three cases, and only two are buildable:**

| Case | Signal | Path |
|---|---|---|
| Photo / GIF | `files.full.url` populated | Download endpoint → render. Straightforward. |
| Plain video | `files.full.url` is mp4, `videoSources.240/720` populated | Download endpoint → `<video>`. Electron's Chromium ships H.264/AAC, so it plays natively. |
| **DRM video** | `files.drm` present, `files.full.url` **null**, both `videoSources` null | **Cannot be played.** See below. |

> **DRM is now a confirmed blocker, not an open question.** On DRM media there is no downloadable file at all — only HLS/DASH manifests, with the CloudFront credentials supplied as a *separate object* rather than baked into the URL ([openapi.yaml:10246-10292](openapi.yaml#L10246-L10292)). That is three problems stacked: Chromium plays neither HLS nor DASH natively (needs hls.js / shaka), and the content behind the manifest is Widevine-encrypted, which **stock Electron cannot decrypt at any price** — it ships without the CDM. The only fix is the castlabs ECS Electron fork: a different binary, a full re-sign and re-notarize, released under rule 14. The provider's own bulk exporter hits the same wall — its docs state that "Media Vault exports of **videos** will fail to download when **DRM is enabled**."
>
> **Decide the fallback before building:** DRM media should render as a poster (`files.preview`) plus an explicit "DRM: not playable here" message. Do not ship a player that silently fails.

**The docs are wrong about one thing, and it matters.** The FAQ says `files.full.url` is null because `convertedToVideo: false` means "still converting". That does not hold: a non-DRM video example has `convertedToVideo: false` *and* a populated `full.url` ([openapi.yaml:17411-17437](openapi.yaml#L17411-L17437)), while the DRM example has `convertedToVideo: false`, `isReady: true`, `canView: true`, and a null `full.url`. **The reliable discriminator is the presence of `files.drm`, not `convertedToVideo`.** Verify empirically against the test account — this single test decides whether a video renders or falls back.

**Consequences for the adapter:**

- **Never mirror or cache a CDN URL.** At a ~1 minute budget it is stale before the Firestore write lands. Mirror media *metadata* only (id, type, dimensions, duration, drm-or-not); resolve URLs on demand.
- ~~**The foreign-origin guard will block the 302.**~~ It did not, because the 302 is never followed: `resolveMediaUrl` uses `redirect: 'manual'` and returns the `Location` for the renderer to load. The API key goes only to the provider, exactly as before. `cdn.fansapi.com` / `dl.fansapi.com` are allowlisted as **redirect targets** — the guard in `request()` is untouched.
- **`canView: false`** = a locked PPV the fan has not purchased; only `thumb`/`preview` exist. Render the blurred preview and a lock state; do not attempt the full file.
- **Media is billable when uncached**, so a thread that eagerly loads every image is a live cost surface. Lazy-load on viewport and prefer `thumb`/`preview` in the list.

## Phase 4 — Multiple OnlyFans pages (accounts)

The unlock. Today exactly one account is operated and `resolveAccountId()` guesses it when `ONLYFANS_ACCOUNT_ID` is unset.

- **Pin the account id now.** `ONLYFANS_ACCOUNT_ID` **must be set before a second account is linked** — without it we take the first authenticated account, which is unambiguous only while exactly one exists.
- **An accounts registry in Firestore.** `onlyfans-accounts/{accountId}` — display name, username, avatar, `isAuthenticated`, link to the `creators` doc (Phase 5), operational status. Synced from `listAccounts()` on a slow TTL; it changes about never.
- **Kill the implicit account everywhere.** Every route takes an explicit `accountId` and validates the caller may operate it. `chatDocId` is already `{accountId}__{chatId}`, so the mirror needs no migration — but the composite index (`accountId ASC, lastMessageAtMs DESC`) and every query must carry the account.
- **Account switcher** in the OF Manager chrome, with the current account visible at all times. An operator sending to the wrong fan from the wrong page is the failure mode this phase exists to prevent.
- **Re-auth surface.** An expired provider session (`isAuthenticated: false`) must be visible and actionable, not a silent stream of 4xx.

## Phase 5 — Creator linkage & multi-account views

Depends on Phase 4.

- **Join `onlyfans-accounts` to the existing `creators` collection**, so an OF page is a creator's page rather than a free-floating provider id. See [user-management.md](documentation/user-management.md) for name resolution and archiving rules — an archived creator's account must drop out of pickers.
- **Unified inbox.** All chats across every account the operator may see, in one list, each row carrying its account badge. This is a fan-out read over the mirror — design the query against the index before building the UI.
- **Per-creator dashboard.** One creator, all their pages: inbox, unread totals, sales (Phase 8), activity.
- **Assignment.** Which operators work which accounts — the data behind Phase 6's access control and Phase 7's shift gating.

## Phase 6 — Granular access control

Today access is one binary: the `apps-ofmanager` page permission. That does not survive multiple creators and multiple chatters.

- **Per-account permission.** An operator sees only the accounts assigned to them. Enforced at three layers exactly as Phase 1 established: the satellite window's access probe, every API route, and Firestore rules on the mirror. **Rules are the layer that matters** — the mirror holds fans' names, avatars and message text, and the current rule grants any holder of the page permission all of it.
- **Per-function permission.** Read vs send vs price-setting vs vault vs mass-message, as separate grants. Model it alongside the existing page-permission system ([permissions.md](documentation/permissions.md)) rather than inventing a parallel one.
- **Rules and indexes change here** → notify the user and print the deploy command (cross-cutting rule 1).

## Phase 7 — Time-tracking integration

Gate OnlyFans work on being clocked in. Read [time-tracking.md](documentation/time-tracking.md) first — the session model is an event log, not a duration field.

- **Clocked-out is read-only, or closed entirely** (decide which; read-only is the safer default). Sending while off-shift is the case this prevents.
- **The window must not mount a second `TimeTrackingProvider`.** `/of-manager` sits outside `(main)` precisely so it does not — a second copy would run a second heartbeat, screenshot scheduler and clock-out flush against the same session. Consume the session **state**; do not re-instantiate the provider.
- **Attribute activity.** Messages sent, threads handled and response times belong on the shift record, feeding the existing analytics rollup.
- **Clock-out closes the loop** — flush anything in flight, surface unsent drafts.

## Phase 8 — Sales tracking & earnings

Depends on Phase 4; benefits from Phase 5.

- **Extend the adapter** with the provider's earnings/transactions surface — `listTransactions`, `getEarnings` — added to `IOnlyFansClient` first.
- **Attribute revenue to the operator, not just the account.** A PPV unlock or tip traced back to the chatter who sent it is the entire point of tracking sales in a CRM; without attribution this is just a reporting page.
- **Rollups, not live queries.** Follow the nightly analytics rollup pattern in `functions/` rather than hitting the provider per page view — every provider call is billed.
- **Surfaces:** per-account and per-operator revenue, PPV conversion rates, tips, subscription revenue, leaderboards. Charts follow the `dataviz` conventions and the dashboard-widget pattern in [`DESIGN.md`](DESIGN.md).
- **Home-page widget** → must gate boot via `useBootPhase('home-<name>', isLoading)` (cross-cutting rule 8).

## Phase 9 — Audit logs

Every OnlyFans action is a real-world action on a real creator's account, taken on their behalf. It must be attributable.

- **Log the writes, not the reads.** Messages sent, prices set, media released, mass-messages, mark-as-read is noise. Actor uid, account id, chat id, action, timestamp, payload digest.
- **Append-only, server-written.** Firestore rules: no client write, ever; read gated on admin. A log an operator can edit is not a log.
- **Retention and volume.** This is the one collection here with unbounded write growth — decide TTL and shard/partition strategy up front rather than after it is expensive.
- **A review surface** for admins: filter by operator, account, date, action.

## Phase 10 — Notifications

- **New-DM alerts** via the existing native surface: `notifications.show({ target, id, actionUrl })` focuses **this** window; macOS supports inline reply (`hasReply: true` + `notifications.onReply`).
- **Suppress alerts for the visible thread** — `window.onFocusChange` / `window.isFocused`. Alerting an operator about the message they are reading is the fastest way to get notifications turned off.
- **Unread badge** on dock/taskbar: `app.setBadgeCount` (mac/Linux), `window.setOverlayIcon` (Windows, renderer-drawn), `window.flashFrame` / `app.bounceDock`.
- **In-app notifications** go through the existing system — copy lives only in `src/lib/notificationContent.ts`, written via `addNotificationToBatch` (cross-cutting rule 5). See [notifications.md](documentation/notifications.md).
- **Deep links.** `bluu://…` → `app.onDeepLink` / `getPendingDeepLink` opens a specific chat from outside the app.
- **Per-operator preferences** — which accounts alert, quiet hours, and a hard mute.

---

## Gotchas ahead — traps waiting in each phase

Not yet bugs. Each is a decision that is cheap now and expensive after the phase ships.

**Phase 3 — chat interface (shipped; these are now regression risks, not future traps)**

Every one of these is **handled**. They are recorded so a later change does not undo them.

- ~~**DRM video cannot be played in this app.**~~ Handled: poster + an explicit "DRM · not playable" line, no player mounted.
- ~~**Test `files.drm`, never `convertedToVideo`.**~~ Handled in `normaliseAttachment`, with the reasoning in the code — do not "simplify" it back to the FAQ's rule.
- ~~**CDN URLs die in about a minute and cannot be fetched directly.**~~ Handled: `stripMediaUrls` before every Firestore write, resolve on demand. **Anything new that writes an `OFMessage` must go through it.**
- ~~**Media downloads are billed when uncached.**~~ Handled: viewport gate, 30ms batching, two memo layers, `preview` over `full`. Removing any one of those is a cost regression that nothing will visibly break.
- ~~**The download redirect crosses origins.**~~ Handled *without* touching `request()`'s origin guard: the 302 is followed manually and only its `Location` is returned, so the API key still never leaves the provider's host. The allowlist is on the redirect target.
- ~~**The chat list needs virtualising before 500 rows.**~~ Handled in 3c *without* a virtualiser: `content-visibility: auto` + a remembered intrinsic size skips style/layout/paint offscreen while every row stays in the DOM — which `j`/`k`, find-in-page and the screen reader all need. Do not "upgrade" it to a windowing library; that would take all three away.
- **Virtualisation fights the scroll anchoring already in `ChatThread`** — and now also the media tiles' reserved aspect ratios. All three manipulate or depend on height around a content change. **Still true, and the thread is deliberately still un-windowed** (the `content-visibility` trick does not transfer: it estimates content that has never rendered, which is exactly what gets prepended above the viewport). Whichever virtualiser is eventually chosen must own the anchoring, not sit beside it. The **one open item** of Phase 3.
- ~~**Opening a chat costs a billed mark-as-read.**~~ Handled: the keyboard cursor moves DOM *focus*, not selection, and Enter opens. A "select as you scroll" convenience here would be a provider call per keystroke.
- ~~**The fan panel wants data the provider bills for.**~~ Handled: the fan profile rides in on the chat-list payload and is mirrored, so the panel opens for free. **Anything added to that mirrored profile must go into `profileDigest`** — and must not be a volatile field (`lastSeen` is right there on the same payload and would rewrite every row on every sync forever).
- **The provider has no unsend, no edit, and never echoes a reply target.** Pin/unpin and like/unlike are its whole per-message surface. Do not design around affordances it does not have.
- ~~**Attachments make send fail in new ways.**~~ Decided in 3b: **retry against the upload**, never orphan it. A staged `ofapi_media_` id is billed and single-use, and a failed send does not consume it, so the composer restores text *and* media together and re-sends the same ids.
- ~~**Draft persistence is unsent text.**~~ Handled: `_lib/drafts.ts`, per account+chat, cleared only by a confirmed send. Staged ids persist with it; CDN preview links are blanked on save.
- **Never route file bytes through an API route.** Vercel caps a request body at ~4.5MB. The signed-URL path exists for this reason — anything new that uploads (a vault upload surface, a mass-message composer) must use it rather than posting a file to a handler.

**Phase 4 — multiple accounts**

- **Pin `ONLYFANS_ACCOUNT_ID` before linking a second account, not after.** The moment two exist, an unpinned deploy silently starts operating an arbitrary one.
- **The mirror needs no migration but every query does.** `chatDocId` is already `{accountId}__{chatId}`; the composite index and every read must start carrying `accountId`. A query that forgets it reads another creator's inbox.
- **Route the webhook by the account in the payload.** `parseWebhookEvent` already returns `accountId` — do not fall back to `resolveAccountId()` on a webhook path, or one account's messages land in another's mirror.
- **The account switcher is a safety control, not chrome.** The current account must be unmissable at all times; the failure mode this phase creates is sending to the right fan from the wrong page.
- **Invalidate the client account cache when the switcher moves** (see the 30-minute `sessionStorage` key above).

**Phase 5 — creators & multi-account views**

- **A unified inbox is a fan-out read.** Firestore `in` queries cap at 30 values — design the query and index before the UI, or the "all accounts" view becomes N listeners.
- **Archived creators must drop out of pickers** but their history must stay readable. Archive ≠ delete (cross-cutting rule 6); add any new per-creator collection to the delete cascade.
- **Avatar fallbacks seed from `displayName`** — a fan or creator seeded from anything else renders in a different colour on every screen (rule 7).

**Phase 6 — access control**

- **The Firestore rule is the only layer that actually protects the data.** A per-account grant enforced in routes and UI but not in rules leaves the mirror — fan names, avatars, message text — readable by anyone holding `apps-ofmanager`. Write the rule in the same change as the feature.
- **A per-function grant that only hides a button is not a permission.** Every one needs a server-side check at the route.
- **Do not invent a parallel permission system.** Model it on the existing page-permission machinery, or two sources of truth will disagree and the more permissive one will win.
- **Rules and indexes change here** → notify the user, print the deploy command.

**Phase 7 — time tracking**

- **Do not mount a second `TimeTrackingProvider`.** `/of-manager` sits outside `(main)` precisely so it does not; a second copy runs a second heartbeat, screenshot scheduler and clock-out flush against the same session. Consume the state, never re-instantiate the provider.
- **Elapsed time comes from `sessionCloseMs` + `parseBuffer`**, never `parseBuffer(events, Date.now())` (rule 4).
- **Decide what "clocked out" does to an open window** — read-only is safer than closing it, which can discard a draft mid-sentence.

**Phase 8 — sales**

- **The provider is the source of truth for money, never the mirror.** Reconciling revenue off cached chat rows produces numbers that are wrong in a way nobody notices until payout.
- **Attribution is the feature.** Revenue tied to an account but not to the operator who earned it makes this a reporting page, not sales tracking — and retrofitting attribution needs historical data that may not be re-fetchable.
- **Never hit the provider per page view.** Roll up nightly like the existing analytics job; every call is billed.
- **Any home-page widget must gate boot** via `useBootPhase` (rule 8).

**Phase 9 — audit logs**

- **This is the only collection here with unbounded write growth.** Decide retention and sharding before it ships, not when it is expensive.
- **Append-only or it is not a log.** No client write in the rules, ever; read gated on admin.
- **Log writes, not reads.** Mark-as-read and list views are noise that will bury the actions that matter.
- **Log the actor, not the account.** "A message was sent from this page" is worthless; "this operator sent it" is the point.

**Phase 10 — notifications**

- **Alerting an operator about the thread they are reading is how notifications get muted forever.** Gate on `window.isFocused` / `onFocusChange` plus the open thread id.
- **`notifications.show({ target })` must name this window's satellite key**, or the alert focuses the main window and the operator lands in the wrong app surface.
- **Badge counts are cross-account.** Decide whether the dock number means "my unread" or "this account's unread" before wiring it, because both are defensible and only one can be shown.
- **Notification copy lives only in `src/lib/notificationContent.ts`**, written via `addNotificationToBatch` (rule 5).

---

## Cross-phase reminders

- **New provider capability → `IOnlyFansClient` first**, then the provider file, then the service, then the route. Never call the provider from a route.
- **New OnlyFans route → `requireOnlyFansAccess(token.uid)` before anything else.**
- **Changing the mirror's shape → update `chatChanged`**, or every sync writes every row.
- **`electron/` changed → a new build, released in TWO pushes** (rule 14 in [CLAUDE.md](CLAUDE.md)). Most of Part II should not need one — the satellite shell already accepts any `/of-manager/*` path and exposes the native surface these phases want.
- **Firestore rules/indexes changed → notify the user and show the deploy command.**
- **New full-height surface in this window → `h-full`, never `h-screen`/`w-screen`.**
- **Update [`documentation/onlyfans-crm.md`](documentation/onlyfans-crm.md) as part of the change**, not after it.

---

## Instructions

- **NEVER call the OnlyFans provider API yourself.** No scripts, no `curl`, no diagnostic fetches against `app.onlyfansapi.com` — **every call is billed** and an exploratory loop burns credits fast. Permitted sources are `openapi.yaml`, [the provider docs](https://docs.onlyfansapi.com/llms.txt), and whatever the user provides (screenshots, pasted payloads). When the documentation is silent — and it often is, its message examples omit real fields — **ask the user for the payload rather than fetching it**, write the adapter defensively (probe the plausible spellings, as `parseWebhookEvent` does), and state plainly what is still unverified.
- Minimise firestore reads and writes where possible.
- ALWAYS read the API documentation first: `openapi.yaml` , [https://docs.onlyfansapi.com/llms.txt]
- IMPORTANT: minimimse onlyfans api (openapi) reads and writes where possible, and opt for webhooks where relevant [https://docs.onlyfansapi.com/webhooks].
- Consider the use of cache.
- Only use shadcn components.
- Implement lazy load where possible.
- Update this document after each pass.
