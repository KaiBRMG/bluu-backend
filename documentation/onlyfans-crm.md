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
| `src/app/api/onlyfans/chats/route.ts` | Warms the mirror (rate-limited sync) |
| `src/app/api/onlyfans/chats/[chatId]/messages/route.ts` | History page (GET) + send (POST) |
| `src/app/api/onlyfans/chats/[chatId]/read/route.ts` | Mark thread read |
| `src/app/api/onlyfans/webhook/[secret]/route.ts` | Provider push → Firestore mirror |
| `src/app/of-manager/**` | The window: layout, guard, chat list, thread |
| `src/hooks/useOnlyFansChats.ts` / `useOnlyFansMessages.ts` | Client data hooks |
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
| `ONLYFANS_ACCOUNT_ID` | optional | Pins the operated account. **Set this before a second account is linked** — without it we take the first authenticated account, which is only unambiguous while exactly one exists. |

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

Implemented: chat list (search + All/Pinned/Unread filters, load older), thread history with lazy load on scroll-up, send, mark-as-read.

Deliberately **not** implemented: vault/media upload, PPV composition, per-function permissions, audit logs, time-tracking gating, linking to the `creators` collection, earnings, notifications. Media on existing messages renders as an attachment chip rather than an image — nothing here assumes text-only, but rendering signed CDN/DRM media is its own piece of work.

The shape anticipates them: the adapter covers the whole provider surface, `chatDocId` is account-scoped, `OF_PAGE_ID` is the single place the permission is named, and the native shell (v0.10.0+) already exposes every capability the list above would need.

> **One native unknown remains: DRM.** Stock Electron ships without Widevine. If any provider media is DRM-protected rather than a plain signed CDN URL, it cannot play at all, and the fix is a different Electron binary (the castlabs ECS fork) — a full re-sign and re-release, not an IPC. Verify how the provider serves media before promising in-window playback.

## Gotchas

- [ ] Adding a provider call → add it to `IOnlyFansClient` first, then implement. Never call the provider from a route.
- [ ] New OnlyFans route → `requireOnlyFansAccess(token.uid)` before anything else.
- [ ] Changing the mirror's shape → update `chatChanged`, or syncs will write every row on every pass.
- [ ] `electron/` changed → new build, released in **two pushes** (rule 14 in [CLAUDE.md](../CLAUDE.md)).
- [ ] `ONLYFANS_ACCOUNT_ID` must be pinned before a second account is linked.
- [ ] New full-height surface in this window → `h-full`, never `h-screen`/`w-screen` (see [The window](#the-window)).
