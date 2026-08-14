# OnlyFans CRM (OF Manager)

> The OnlyFans messaging console. Runs in its **own Electron window**, talks to a third-party OnlyFans provider through a single adapter interface, and keeps its chat list live off webhooks rather than polling.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/onlyfans/types.ts` | Domain model + the `IOnlyFansClient` contract |
| `src/lib/onlyfans/providers/onlyfansApi.ts` | **The only** file that knows the provider's URLs/payloads |
| `src/lib/onlyfans/index.ts` | `getOnlyFansClient()` factory + `resolveAccountId()` |
| `src/lib/services/onlyfansService.ts` | Access gate, Firestore mirror, sync, live-message writes |
| `src/app/api/onlyfans/access/route.ts` | Permission probe for the Electron main process |
| `src/app/api/onlyfans/account/route.ts` | Cheap account-id resolve (first-paint path) |
| `src/app/api/onlyfans/chats/route.ts` | Warms the mirror (rate-limited sync) |
| `src/app/api/onlyfans/chats/[chatId]/messages/route.ts` | History page (GET) + send (POST) |
| `src/app/api/onlyfans/chats/[chatId]/read/route.ts` | Mark thread read |
| `src/app/api/onlyfans/media/resolve/route.ts` | Expiring CDN link → loadable URL (batched) |
| `src/app/api/onlyfans/media/upload-url/route.ts` | Signs a one-off Storage slot for an outgoing attachment |
| `src/app/api/onlyfans/media/upload/route.ts` | Hands that upload to the provider → `ofapi_media_…` id |
| `src/app/api/onlyfans/vault/route.ts` / `vault/lists/route.ts` | Vault media page + categories, for the picker |
| `src/app/api/onlyfans/webhook/[secret]/route.ts` | Provider push → Firestore mirror |
| `src/app/of-manager/**` | The window: layout, guard, chat list, thread, attachments, composer |
| `src/app/of-manager/_components/MessageComposer.tsx` | Text, attachments, PPV price, drafts — everything unsent |
| `src/app/of-manager/_components/VaultDialog.tsx` | The vault picker (a dialog, not a satellite) |
| `src/app/of-manager/_lib/drafts.ts` | Per-thread draft persistence |
| `src/lib/onlyfansUpload.ts` | Upload limits shared by the composer and the routes (client-safe) |
| `src/hooks/useOnlyFansChats.ts` / `useOnlyFansMessages.ts` | Client data hooks |
| `src/hooks/useOnlyFansMedia.ts` | Lazy, batched, memoised media resolution |
| `src/hooks/useOnlyFansVault.ts` / `useOnlyFansUpload.ts` | Vault paging · three-hop file staging |
| `electron/main.js` (`openSatelliteWindow`) | Spawns the window after a **server-side** permission check. Reached via `onlyfans:open-window` (legacy name) or `window:open-satellite` |
| `src/components/Sidebar.tsx` (`OfManagerButton`) | Sidebar entry — opens the window instead of navigating |

## Firestore

| Collection | Purpose | Client-readable |
|---|---|---|
| `onlyfans-chats/{accountId}__{chatId}` | Mirror of the provider's chat list | read, gated on `apps-ofmanager` |
| `onlyfans-chats/{…}/messages/{messageId}` | **Live** messages only (webhook + send) | read, same gate |
| `onlyfans-meta/{accountId}` | Sync freshness marker | **no** — server only |

Composite index: `onlyfans-chats` → `accountId ASC, lastMessageAtMs DESC`.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `ONLYFANSAPI_API_KEY` | yes | Provider bearer token |
| `ONLYFANSAPI_WEBHOOK_SECRET` | for realtime | Path secret + HMAC key for the webhook endpoint |
| `ONLYFANS_ACCOUNT_ID` | optional | Pins the operated account. **Set this before a second account is linked** — without it we take the first authenticated account, which is only unambiguous while exactly one exists. Also a latency fix: it saves a `listAccounts` round trip on every cold instance. |
| `ONLYFANS_DEBUG_TIPS` | no | **TEMPORARY.** `1` logs the raw payload of tip messages, to find the field carrying a fan's tip note. Opt-in because the log contains fan text. See [Tips](#tips). |

---

## The non-negotiable rule: everything goes through the adapter

No component, hook, service or route may import a provider SDK, construct a provider URL, or reason about a provider payload. The **only** OnlyFans-shaped code lives in `src/lib/onlyfans/providers/`; everything above it speaks the domain model in `types.ts`.

Swapping providers is therefore: write a second file in `providers/`, point the factory in `index.ts` at it, done. If a provider field ever leaks upward (an `isSentByMe`, a `_pagination`, an `acct_` prefix parsed outside the provider file), that property is broken — put it back behind the seam.

`OnlyFansApiError` is the one error type callers see, so nothing above the adapter branches on HTTP status.

---

## Data flow (and why it is shaped this way)

Two costs drive every decision here: **provider credits** (each call is billed) and **Firestore I/O**.

```
                       ┌──────────── provider webhook ───────────┐
                       ▼                                          │
 GET /api/onlyfans/chats ──► syncChats() ──► onlyfans-chats  ◄────┘
   (rate-limited, 60s)          (diffed)          │
                                                  │ onSnapshot
                                                  ▼
                                      OF Manager chat list (realtime)

 GET …/messages?cursor=  ──► provider ──► client sessionStorage cache
                                          (history is NEVER mirrored)
 POST …/messages ──► provider ──► onlyfans-chats/{…}/messages (live tail)
```

- **The chat list is mirrored, history is not.** A chat row is a handful of fields that change often and are read by everyone — worth one Firestore doc. A thread is thousands of messages read once — mirroring it would be the most expensive thing this feature does. History is paged from the provider on demand and cached in `sessionStorage` for 60s.
- **The list is realtime via `onSnapshot`, not polling.** Webhook writes land in the same docs the window is already listening to, so a new message appears with no provider call and one Firestore read.
- **`syncChats` is rate limited twice** — an in-process timestamp (free) *and* `onlyfans-meta/{accountId}.chatsSyncedAt` (authoritative across serverless instances). `?refresh=1` bypasses both and is only ever an explicit user click.
- **The mirror is diffed before writing.** A sync over an idle inbox costs zero writes (`chatChanged`).
- **Unread counts use `FieldValue.increment`** — a read-modify-write transaction would cost a Firestore read on every inbound message.
- **Mark-as-read fires once per thread per session** (`markedRef` in the page), because it costs a provider call.

### The two-source thread

`useOnlyFansMessages` merges **history** (provider pages) with the **live tail** (the `messages` subcollection), de-duplicating by message id — the same message legitimately appears in both once the next history page is fetched. Sent messages are written to the subcollection by the send route *and* by the `messages.sent` webhook; both write the same doc id, so it is idempotent.

### Refresh covers both panes

The chat list's refresh button drives two different things, because the two panes have unrelated freshness models. The list is a Firestore mirror, so `refresh` calls `?refresh=1` and lets the snapshot listener deliver the rewritten rows. The **thread is provider history that the sync route never touches**, so it would otherwise sit unchanged behind a refresh the operator just pressed — the one pane they are reading being the one that does not move. The page therefore also bumps a `threadReloadToken`, passed to `ChatThread` → `useOnlyFansMessages(accountId, chatId, reloadToken)`, which re-runs the initial-page effect.

A reload is not the same as opening a thread, and the effect distinguishes them via a ref holding the last token it saw:

- it **bypasses the 60s `sessionStorage` history cache** — serving the copy the operator asked to replace is the one thing a refresh must never do;
- it leaves `history`, `loading` and `optimistic` alone before the fetch, so the thread stays readable rather than flashing a skeleton, and an in-flight send keeps its bubble;
- the response then *replaces* history with the newest page, so a thread paged far back collapses to page one exactly as re-opening it would.

The live tail needs no part of this — it is an `onSnapshot` and is already current. Note the spinner on the button tracks the chat-list sync only; the thread updates in place.

### Optimistic send has exactly one failure model

A send inserts an optimistic row (`pending: true`) which the live listener replaces with the real message. **A send that fails removes its row and returns `false`; the composer restores the draft.** There is deliberately no `failed` message state: the earlier version kept a red bubble *and* refilled the composer, so the operator saw one unsent message twice, the ghost never cleared, and each retry appended another. The composer is the only place unsent text lives. `error` is cleared at the start of every attempt so a second identical failure still toasts.

### Webhooks are best-effort, never load-bearing

The provider's OpenAPI document lists the event names but **not the payload bodies or delivery headers**, so both the signature check (`verifyWebhookSignature`) and the payload parse (`parseWebhookEvent`) sit **behind the adapter**, alongside every other provider-shaped concern — the route itself never touches a provider field. `parseWebhookEvent` probes each field across the plausible spellings; an unrecognised payload returns null and is 200'd rather than retried, because the app self-corrects on the next chat sync. Only a *failed Firestore write* returns 5xx (the one failure worth retrying).

**One-time registration** (the endpoint exists but nothing is subscribed until this is run):

```bash
curl -X POST https://app.onlyfansapi.com/api/webhooks \
  -H "Authorization: Bearer $ONLYFANSAPI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "endpoint_url": "https://app.bluurock.com/api/onlyfans/webhook/<ONLYFANSAPI_WEBHOOK_SECRET>",
    "signing_secret": "<ONLYFANSAPI_WEBHOOK_SECRET>",
    "events": ["messages.received", "messages.sent"],
    "account_scope": "global"
  }'
```

Until it is registered the inbox still works — it just refreshes on open and on the refresh button instead of live.

---

## Latency: what makes this window feel fast

Every number below was tuned against a real complaint ("opening a chat, then another, then the first again buffers"; "everything is slow"). They are load-bearing, not preferences.

### Four caches, each answering a different question

| Layer | Where | Lives | Answers |
|---|---|---|---|
| Thread history — **show** | `sessionStorage`, per account+chat | 10 min | "What do I put on screen *right now*?" |
| Thread history — **trust** | same entry, by age | 20 s | "Can I skip the network entirely?" |
| Message page | server, in-process | 20 s | "Has anyone else just asked for this page?" |
| Resolved media URL | client `Map` + server `Map` | 5 min | "Do I need to pay to show this tile again?" |

**The A → B → A complaint was the first two.** The history TTL was 60s and *display* was the only thing it governed, so an operator who spent a minute in another thread came back to a blank pane, a skeleton and a billed provider call. Now a cached thread renders immediately for ten minutes and revalidates behind the render, and a thread re-opened within twenty seconds makes **no request at all**. Neither is risky: the cache is only ever half the thread, and the other half — the live tail — is an `onSnapshot` that is always current.

**The server memo also dedupes in flight.** Two operators opening the same chat at the same moment make one provider call, not two. A send invalidates that chat's pages, so the operator's own message can never be missing from the page they get back a second later. `?refresh=1` (the refresh button, and only it) bypasses every layer.

### First paint does not wait on the provider

`GET /api/onlyfans/chats` returns the account id, but only *after* pulling the provider's chat list and reconciling the mirror. The list cannot attach its snapshot listener without that id, so on a cold session the whole inbox used to wait on work it did not need. [`GET /api/onlyfans/account`](../src/app/api/onlyfans/account/route.ts) answers the same question for free (from `ONLYFANS_ACCOUNT_ID`, or an hour-memoised resolve) and the hook calls it in parallel. **Pinning `ONLYFANS_ACCOUNT_ID` is therefore a latency fix as well as the Phase 4 correctness fix** — without it, a cold lambda spends a provider round trip on `listAccounts` before it can answer anything.

### The bug that was quietly billing

`useOnlyFansChats` back-fills profile fields for a chat a webhook created before the fan was ever synced. That was guarded only by an *in-flight* boolean, so a fan the sync could not reach (they are not in the first page of chats) stayed `fanMissing` forever and **every subsequent snapshot fired another forced, billed provider sync** — each of which wrote rows, producing another snapshot. It is now one attempt per chat id, ever.

### Media is optimistic with a real fallback

The resolved-URL TTL was briefly 45s, matching the pessimistic figure for the *source* CDN link. That was a cost bug, not a safety margin: re-resolving is billed and scrolling a tile out of view and back is routine. The TTL is now 5 minutes and correctness comes from the consumer — `onError` on the element invalidates the entry and re-resolves once. Optimistic with a real fallback beats pessimistic with a bill.

### Degradation is visible, not toasted

- **Offline** shows a persistent strip above the chat list ("showing the last synced inbox"), in zinc — offline is a condition, not an error, and the mirrored inbox is still readable.
- **A chat-list error** renders inline with a Retry, and deliberately does **not** toast: it is persistent state, and a toast beside it reports the same fact twice then vanishes.
- **A thread that fails to load** shows an error with Retry, never "No messages yet." Those are different facts, and acting on the wrong one — messaging a fan you believe you have never spoken to — is a real mistake.
- Send failures still toast, because those genuinely are events.

---

## Tips

A tip is the one unambiguously good thing that happens in this window, and it has its own rendering ([`TipBubble`](../src/app/of-manager/_components/ChatThread.tsx)).

**The data trap — and it is worse than it looks.** The provider reports **`price: 0` on a tip**, and its OpenAPI document describes no tip-amount field at all (the message examples simply omit it). Two wrong guesses were shipped before this was pinned down: first the PPV row labelled a tip "$50 locked", then reading `price` rendered every tip as **"$0"**.

The model is now explicit: **`price` is the PPV unlock price and nothing else** (the adapter forces it to 0 on a tip); **`tipAmount` is the money.** `parseTip` fills it by probing the plausible field spellings (`tipAmount`, `tipsAmount`, `tipsAmountRaw`, `amount`) and then — because the documented payload has none of them — falling back to reading the figure out of the provider's own generated sentence, which is the one place the amount is *known* to appear.

> `MessageAttachments` still zeroes the price on a tip. That is not redundant: rows mirrored to Firestore before this change carry the tip amount in `price`.

**`text` on a tip is boilerplate, not a message.** The provider generates `I sent you a $150.00 tip` as the body. Rendered verbatim it tells the operator nothing. `parseTip` strips that sentence, so `text` on a tip is whatever remains.

**The accompanying note is still unsolved.** Fans can attach a message to a tip, and it does not appear. Stripping the generated sentence leaves *nothing*, so the note is not in `text`; the documented message schema has exactly one text field and no note field, so the docs cannot say where it is. `parseTip` therefore probes `tipComment` / `tipMessage` / `tipText` / `comment` / `note` / `description` — **all unverified guesses.**

To settle it without spending a provider call, set **`ONLYFANS_DEBUG_TIPS=1`** and open a thread containing a tip: `debugLogTipPayload` prints the raw payload of that message, piggybacking on the history fetch the thread already makes. Read the real field name off the log, wire it up, and **delete the diagnostic** — it is tagged `TEMPORARY` in `onlyfansApi.ts`. The log contains the fan's own words, so it is opt-in and must not be left on in production.

**A zero amount renders as "Tip", never "$0".** If parsing ever fails, saying less is correct; stating a falsehood about money is the worse failure by a distance.

**Why it looks the way it does:** a tip is not speech, so it does not get a speech bubble. The amount is set at display size with the digits carrying the line and the `$` stepped down beside them (`splitMoney`); the note hangs below a hairline. Green is the existing semantic "paid" hue, not a new colour.

**It deliberately does not animate.** Tips arrive all day in a window an operator lives in for a whole shift — anything that celebrated would be charming twice and irritating thereafter. [DESIGN.md](../DESIGN.md) also reserves celebration for exactly one screen and says not to extend that vocabulary. The delight is in the typesetting, which costs nothing to see for the thousandth time.

> Not done: the **chat list** still previews a tip as its note text (or "Media attachment" when the note is empty). Showing "Tipped $50" there needs `isTip`/`price` on the mirrored row — which means adding them to `chatChanged` too, or every sync rewrites every row.

---

## Media

Attachments render inline. The mechanics are unusual enough that changing any of them casually will either break the images or cost money, so they are written down here in full.

### A provider CDN link is not a URL you can use

`cdn*.onlyfans.com` is IP-locked to the provider's proxy — putting one in an `<img>` always fails. Every display goes through `GET /api/{account}/media/download/{cdnUrl}`, which answers **302** to either `cdn.fansapi.com` (the provider's cache — free) or `dl.fansapi.com` (streamed through the account proxy — **billed**).

`resolveMediaUrl` on the adapter follows that redirect **manually** (`redirect: 'manual'`) and returns the `Location`. Two consequences worth keeping:

- **The origin guard in `request()` needs no relaxing.** The only request carrying the API key still goes to the provider. Following the 302 with `fetch` would have sent the key to a different host, which is exactly what that guard exists to prevent — so `resolveMediaUrl` deliberately does not use `request()`.
- **The redirect host is allowlisted** (`cdn.fansapi.com`, `dl.fansapi.com`). Anything else is a 502, not a URL we hand the renderer.

The source link itself is validated against `CDN_URL_PATTERN` before use. Media URLs reach the server *from the client* — they arrive on a message page and come back on a resolve request — so they are untrusted input; without that test the route is a way to point the provider's fetcher at an arbitrary host.

### CDN links expire, so they are never mirrored

The provider's docs contradict themselves (~20 minutes per the `cdnUrl` parameter, "don't wait longer than a minute" per the 403 FAQ). We budget for one minute, which is short enough that a persisted copy is dead before anything reads it back.

So `stripMediaUrls` blanks every URL before a message is written to Firestore. **Attachment *metadata* is mirrored** — id, type, dimensions, duration, DRM-or-not, locked-or-not — because that is durable and is what lets a tile lay itself out. The URL is resolved at render time.

That produces one behaviour worth recognising rather than "fixing": a message that arrives by webhook shows its tiles as **metadata placeholders** ("Photo", correct aspect ratio) until the thread is refreshed and history supplies fresh links. It is not a bug; it is the cost model.

It also produces one real trap, already handled: history and the live tail overlap, and the live copy normally wins as the newer fact — which would blank the media on any message present in both. `mergeMessage` in `useOnlyFansMessages` keeps the newer row but the resolvable attachments.

### Resolving is billed, so it is lazy, batched and memoised

Three layers, each doing a different job:

1. **Lazy.** `MediaTile` resolves nothing until an `IntersectionObserver` (200px `rootMargin`) says it is near the viewport. Opening a thread does not pay for media nobody scrolled to.
2. **Batched.** `useResolveMedia` collects requests for 30ms and posts them as one array (route cap: 12). A four-photo message is one round trip. Failures are reported **per URL**, so one expired link degrades its own tile rather than blanking the set.
3. **Memoised twice.** Client-side in a module-level `Map` for the TTL the server reports; server-side in `resolveMediaUrlCached` (bounded at 500 entries), which collapses repeats across operators in one lambda. Neither is Firestore-backed on purpose — the answer is worth under a minute, so persisting it would cost a read to return something already expired.

The tile requests **`preview`** (~960px), not `thumb`, because the same resolved URL is reused as the lightbox image and as a video poster — one resolve per attachment on the common path. Full resolution for a photo is a second billed download and is therefore an explicit "View full resolution" click, never automatic.

### The three cases, and the one that cannot work

| Case | Signal | What happens |
|---|---|---|
| Photo / GIF | `files.full.url` populated | Resolve preview → `<img>`; lightbox offers full resolution. |
| Plain video | `files.full.url` is an mp4 | Resolve preview as poster; lightbox resolves the file into `<video>`. Electron's Chromium ships H.264/AAC, so it plays natively. |
| **DRM video** | `files.drm` present, `files.full.url` null | **Poster + "DRM · not playable" and nothing else.** No player is mounted. |

> **DRM is a confirmed blocker, not an open question.** There is no downloadable file — only HLS/DASH manifests whose CloudFront credentials arrive as a separate object. Chromium plays neither format natively *and* the content is Widevine-encrypted, which stock Electron cannot decrypt at any price (it ships without the CDM). The only fix would be the castlabs ECS Electron fork: a different binary, a full re-sign and re-notarize under rule 14. The provider's own bulk exporter hits the same wall.

**Test `files.drm`, never `convertedToVideo`.** The provider's FAQ says a null `full.url` means "still converting"; its own examples disprove that — a plain video ships `convertedToVideo: false` *with* a populated `full.url`, while the DRM example is `isReady: true`, `canView: true` and has no file at all. Following the FAQ mounts a player on every DRM message and lets it fail silently.

`canView: false` is a locked PPV: only `thumb`/`preview` exist, so the tile blurs the preview behind a lock and the full file is never requested.

### Every tile reserves its space before the image lands

`aspectRatio` comes from the mirrored dimensions. This is not polish — `ChatThread` restores `scrollTop` around content-height changes when paging back through history, and media that popped in at its natural size after resolving would move the reading position under the operator on every tile. Metadata-first layout is what keeps the two from fighting. Anything virtualising this thread later (Phase 3c) must own the anchoring rather than sit beside it.

---

## Composing a message

The composer holds **everything unsent** — text, staged attachments, the PPV
price — and it is the only thing that does. That was already the rule for a
failed send (the optimistic bubble is removed and the draft handed back); pass
3b extends the same rule across three new axes rather than inventing a second
place for unsent work to hide.

| Axis | Rule |
|---|---|
| A failed send | Restores **text and media together**. Half a restore leaves the operator with a caption and no photo. |
| A closed window | The draft is persisted per account+chat in `localStorage` and cleared only by a **confirmed** send. |
| A staged upload | Kept across a failure and retried against the *same* provider id — a failed send has not consumed it, and re-uploading is billed. |

### Sending a file never touches our API

A Vercel function accepts roughly **4.5MB** of request body. The media an
operator sends routinely exceeds that, so the bytes go around us entirely:

```
 browser ──1──► POST /api/onlyfans/media/upload-url   (signs a v4 PUT slot)
         ──2──► PUT   storage.googleapis.com/…        (the file itself, XHR)
         ──3──► POST /api/onlyfans/media/upload       ({path})
                          │
                          ├─ signs a 10-minute READ url
                          ├─ provider fetches it → ofapi_media_…
                          └─ deletes the staged object
```

- **The path is server-chosen and re-derived, never trusted.**
  `onlyfans-outgoing/{uid}/{uuid}.{ext}`, and the commit route refuses anything
  outside the caller's own folder. Signing a client-supplied path would be a
  write primitive for the whole bucket.
- **The signature pins the content type**, so the allowlist in
  [`src/lib/onlyfansUpload.ts`](../src/lib/onlyfansUpload.ts) cannot be
  sidestepped by lying at PUT time. That file is deliberately outside
  `src/lib/onlyfans/` (which is server-only) so the composer can reject a 400MB
  drop *before* uploading it.
- **No Storage rules are involved.** A v4 signed URL authenticates as the service
  account against the GCS API; Firebase Storage rules are not consulted on either
  leg. The authorisation that matters is `requireOnlyFansAccess` on both routes.
- **The staged object is deleted once the provider has it.** It is a fan's media
  sitting in our bucket, and the provider fetches synchronously — by the time the
  call returns the copy is dead weight. *Known gap:* an upload that is signed and
  PUT but never committed (the operator closes the window mid-compose) is not
  cleaned up. A bucket lifecycle rule on `onlyfans-outgoing/` is the fix.
- **XHR, not `fetch`**, for the PUT — `fetch` still cannot report upload
  progress, and a 90MB video with no progress bar reads as a frozen window.

### The staged id is single-use and billed

`ofapi_media_…` is spent by the first message that references it. That is what
makes "a failed send keeps its upload" a cost decision rather than a nicety, and
it is why the draft persists the ids: dropping them on window close means paying
to upload the same file again.

Vault ids are the opposite — durable, re-sendable, free to hold. The provider
takes both in the same `mediaFiles` field, so nothing above the adapter branches
on which kind an id is.

### The vault picker is a dialog

Not a satellite window: a second window would need a native build (rule 14) and
cross-window selection plumbing, to solve "pick a file and come back" — which a
modal solves natively. It is card-sized because it is a step inside composing a
message, not a destination.

**It is billed twice per page** — once to list the media, again to resolve each
tile's preview — so: listing is paged explicitly (never infinite-scrolled),
search commits on submit rather than per keystroke, pages are cached in
`sessionStorage` for 5 minutes *and* memoised server-side for 60s, categories are
memoised for 30 minutes, and every tile is behind the same `useInViewport` gate
the thread's tiles use.

> **`openapi.yaml` understates the vault-lists limit.** The parameter is
> documented as "Default: 24" with no maximum; the endpoint 422s above **30**
> ("The limit field must not be greater than 30"). Categories are therefore paged
> at 30 rather than pulled in one call. Treat the spec's stated limits as a
> starting guess on this provider, not a contract — this is the second field it
> has been wrong about, after `convertedToVideo`.

Vault media **is** `OFAttachment` — a vault entry and a message attachment are the
same provider object, so they share one normaliser, one tile contract and one
expiry rule: resolve on demand, never persist. `saveDraft` blanks `previewUrl`
for exactly that reason, so a restored chip shows its type and label rather than
a link that died in a minute.

### PPV: `price` means the third thing here

On a message `price` is the unlock price, on a tip it is the amount tipped — and
in the composer it is neither until there is media to lock. The provider rejects
a priced message with nothing to unlock, so the price control is **disabled
without media** and says why, rather than letting the send fail later. Bounds are
the provider's own: **free, or $3–$200**, validated in the composer, in the route
and behind the adapter.

With a price set, `mediaFiles` becomes the *locked* set and `previews` the
visible exception to it — which is why each staged tile grows an eye toggle only
once a price exists, and why the price strip states the preview count. A set with
no preview shows the fan nothing at all; that is a legitimate choice, but one
worth seeing before pressing Send.

### Emoji, paste and drag-drop need nothing native

- A pasted screenshot arrives as a real `File` on `clipboardData` in Chromium, so
  `onPaste` covers it — no `clipboard.readImage()`, no Electron change, no
  rule-14 build.
- Drag-drop and `<input type=file>` likewise give real `File`s.
- The emoji picker is a `Popover` over a **curated list**
  ([`_lib/emoji.ts`](../src/app/of-manager/_lib/emoji.ts)) rather than a picker
  library: the UI rule is shadcn primitives only, and the full Unicode set is the
  wrong content anyway — an operator reaches for the same three dozen glyphs all
  shift. It stays open after a pick, because emoji arrive in threes.

---

## Security

Three independent layers, deliberately:

1. **Electron main process** — `onlyfans:open-window` will not create the window until it has POSTed the renderer's Firebase ID token to `/api/onlyfans/access` and got a 200. Hiding the sidebar item is a convenience; **this** is the gate that a determined renderer cannot skip.
2. **Every API route** re-checks `requireOnlyFansAccess(uid)` (the `apps-ofmanager` page permission, tier 2). No route trusts that the window opened legitimately.
3. **Firestore rules** gate the mirror on `hasPagePermission('apps-ofmanager')`, not `isSignedIn()` — the docs hold fans' names, avatars and message text, and a staff member without the page must not be able to read them directly.

Plus:
- The **webhook is unauthenticated by construction** (the provider has no Bluu session). The path secret is the credential, compared in constant time, and a signature header — when present — is HMAC-verified against the raw body. A wrong secret returns **404**, never 401, so the endpoint's existence is not confirmed.
- **The API key never reaches the client.** `src/lib/onlyfans/**` is server-only; the client talks exclusively to `/api/onlyfans/*`.
- Message bodies arrive as **HTML** and are stripped to plain text at the adapter boundary (`htmlToText`). The UI renders text nodes only — never `dangerouslySetInnerHTML`.
- The adapter refuses to send the API key to any origin but the provider's, which matters because a message cursor *is* a provider-supplied URL.

---

## The window

`/of-manager` is **not** inside `(main)`, and that is load-bearing: `(main)`'s layout mounts `TimeTrackingProvider`, and a second copy in a second window would run a second heartbeat, screenshot scheduler and clock-out flush against the same session. The OF layout mounts only `AuthProvider` + `NetworkStatusProvider` + `UserDataProvider`.

Auth is shared with the main window for free — Firebase persists to IndexedDB, which is per-origin, and both windows load the same origin.

Window properties that are part of the spec:
- **Co-equal with the main window, never `parent: mainWindow`.** A parented window is pinned above its parent on macOS for as long as it lives, which leaves the main window permanently behind it and effectively unusable — operators need both windows and either one on top. The close-dependency is therefore enforced by hand: `mainWindow.on('closed', closeAllSatellites)`. It is hooked to `closed` rather than `close` so the clock-out flush veto still runs, and it is not optional — without it `window-all-closed` never fires and the app never quits.
- `resizable: true` with its own minimums — sized independently of the main window.
- One window per `key` — a second sidebar click focuses the existing window.
- `will-navigate` / `setWindowOpenHandler` mirror the main window's posture (app origin in-window, everything else to the system browser), along with the offline screen, crash auto-reload and unresponsive reporting — all applied by the shared `attachWindowBehaviour`.

**Never size this window's shell in `vw`/`vh`.** The layout wraps everything in a single `fixed inset-0 overflow-hidden` box and every surface below it uses `h-full`/`w-full`. Windows Electron uses classic space-consuming scrollbars, so a `w-screen`/`h-screen` shell oscillates: `100vw` exceeds the client width as soon as any vertical scrollbar exists → a horizontal scrollbar appears → it eats height → `100vh` now exceeds the client height → the vertical scrollbar it needs narrows the client width again. The symptom is the window scrolling a little past its own bottom and flickering under the cursor. A `fixed inset-0` box is measured against the client area and adds nothing to the document's scroll height, so it cannot feed the loop. The two scroll containers (chat list, thread) are `overscroll-contain` so a wheel event running out of list does not chain to the document behind it.

Row hover is **colour and transform only** — no `filter`. A `hover:brightness-*` on a chat row makes Chromium promote and re-rasterise the entire row, avatar included, on every enter and leave, which tears visibly when the cursor is dragged down a long list.

`src/middleware.ts` is untouched: `/of-manager` is not on the browser allowlist, so browser traffic rewrites to `/desktop-only` exactly like the rest of the app.

**Older installed builds** lack the `onlyfans:open-window` IPC. `OfManagerButton` feature-detects and falls back to navigating to `/of-manager` in the main window, so the feature works before the fleet updates (with the sidebar still rendered around it).

### Sub-routes are renderer-only (v0.10.0+)

The shell accepts **any path under `/of-manager`**, not a fixed route:

```ts
window.electronAPI?.onlyfans?.openWindow(idToken, {
  path: '/of-manager/chat/abc',
  key: 'of-chat:abc',
  width: 520, minWidth: 380,
});
```

So a popped-out chat, a vault browser or a media viewer is a **web deploy**, not a native release. The permission check still runs server-side per open, the path is validated as untrusted input, and 8 satellite windows is the cap. Only adding a *new prefix* (a non-`/of-manager` route) needs a native build. Full contract: [electron.md](electron.md#multi-window-the-main-window-and-its-satellites).

### Native capability available to this window

Everything the messaging surface is likely to want is already exposed, feature-detected off `window.electronAPI` (see the IPC table in [electron.md](electron.md#ipc-surface)):

| Need | API |
|---|---|
| Unread count on the dock/taskbar | `app.setBadgeCount` (mac/Linux) · `window.setOverlayIcon` (Windows, renderer-drawn) · `window.flashFrame` / `app.bounceDock` |
| New-DM alert that focuses **this** window | `notifications.show({ target, id, actionUrl })` |
| Reply from the notification (macOS) | `notifications.show({ hasReply: true })` + `notifications.onReply` |
| Suppress alerts for the visible thread | `window.onFocusChange` / `window.isFocused` |
| Paste a screenshot into the composer | `clipboard.readImage()` |
| Right-click cut/copy/paste + spellcheck | automatic — `attachContextMenu` |
| Save a fan's media | `files.download({ url })` for large media, `files.save({ dataBase64 })` for small · `files.showInFolder` |
| Remember this window's size | `window.getState` / `setSize` / `onUserResized` — **use your own storage key**, not `bluu_window_size` |
| Open a chat from outside the app | `bluu://…` → `app.onDeepLink` / `getPendingDeepLink` |

Attaching files needs nothing native — `<input type=file>` and drag-drop give a real `File`.

---

## Scope of this iteration

Implemented: chat list (search + All/Pinned/Unread filters, load older), thread history with lazy load on scroll-up, mark-as-read, **inline media on received messages** (photos, GIFs, plain video, locked-PPV previews, DRM fallback — see [Media](#media)), and the **full composer**: attachments by picker/drag-drop/paste, the vault picker, PPV pricing with previews, emoji, multi-line, and per-thread drafts (see [Composing a message](#composing-a-message)).

Deliberately **not** implemented: per-function permissions, audit logs, time-tracking gating, linking to the `creators` collection, earnings, notifications, mass-messaging. Tagging other creators is a **visible stub** in the composer — it needs the creator registry Phase 5 builds. Message affordances (reply, copy, pin, like), the fan context panel, list sorting/keyboard navigation and virtualisation are the remainder of Phase 3 and are tracked in [`OF-Manager.md`](../OF-Manager.md).

The shape anticipates them: the adapter covers the whole provider surface, `chatDocId` is account-scoped, `OF_PAGE_ID` is the single place the permission is named, and the native shell (v0.10.0+) already exposes every capability the list above would need.

> **Note: the provider has no unsend.** `/{account}/chats/{chat_id}/messages/{message_id}` supports only `GET`, plus `pin`/`unpin`/`like`/`unlike`. Do not design a delete affordance for sent messages.

## Gotchas

- [ ] Adding a provider call → add it to `IOnlyFansClient` first, then implement. Never call the provider from a route.
- [ ] New OnlyFans route → `requireOnlyFansAccess(token.uid)` before anything else.
- [ ] Changing the mirror's shape → update `chatChanged`, or syncs will write every row on every pass.
- [ ] `electron/` changed → new build, released in **two pushes** (rule 14 in [CLAUDE.md](../CLAUDE.md)).
- [ ] `ONLYFANS_ACCOUNT_ID` must be pinned before a second account is linked.
- [ ] **Never persist a CDN URL.** Anything writing an `OFMessage` to Firestore goes through `stripMediaUrls` first — a mirrored link is dead on arrival and looks like data.
- [ ] **Never resolve media eagerly.** Resolving uncached media is billed; keep the viewport gate and prefer `preview` over `full`.
- [ ] **Tip money is `tipAmount`, never `price`.** The provider sends `price: 0` on tips. Earnings work (Phase 8) must sum `tipAmount`, or every tip counts as zero.
- [ ] **Never call the provider API to investigate.** Every call is billed. Use `openapi.yaml` and the provider docs, or ask the user for the payload — see rule 9b in [CLAUDE.md](../CLAUDE.md).
- [ ] **A staged upload id is single-use and billed.** Anything that clears the composer must clear it only on a *confirmed* send; anything that retries must reuse the id, never re-upload.
- [ ] **Never route file bytes through an API route.** Vercel caps a request body at ~4.5MB — use the signed-URL path in [Sending a file](#sending-a-file-never-touches-our-api).
- [ ] **A priced message needs media, and the price is 0 or $3–$200.** Enforced in the composer, the route and the adapter; the provider rejects anything else.
- [ ] **Unsent work lives in exactly one place.** Text, attachments and price all belong to the composer — a second copy anywhere (a "failed" bubble, a parent's state) is the bug that pass 3b was written to avoid.
- [ ] Adding a field to the mirror that the media path reads → check `chatChanged` (rule: a field in the mirror but not the diff makes every sync write every row).
- [ ] New full-height surface in this window → `h-full`, never `h-screen`/`w-screen` (see [The window](#the-window)).
