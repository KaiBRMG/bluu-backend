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
| `electron/main.js` (`onlyfans:open-window`) | Spawns the window after a **server-side** permission check |
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
- **Co-equal with the main window, never `parent: mainWindow`.** A parented window is pinned above its parent on macOS for as long as it lives, which leaves the main window permanently behind it and effectively unusable — operators need both windows and either one on top. The close-dependency is therefore enforced by hand: `mainWindow.on('closed', closeOfWindow)`. It is hooked to `closed` rather than `close` so the clock-out flush veto still runs, and it is not optional — without it `window-all-closed` never fires and the app never quits.
- `resizable: true` with its own minimums — sized independently of the main window.
- Single instance — a second sidebar click focuses the existing window.
- `will-navigate` / `setWindowOpenHandler` mirror the main window's posture (app origin in-window, everything else to the system browser).

`src/middleware.ts` is untouched: `/of-manager` is not on the browser allowlist, so browser traffic rewrites to `/desktop-only` exactly like the rest of the app.

**Older installed builds** lack the `onlyfans:open-window` IPC. `OfManagerButton` feature-detects and falls back to navigating to `/of-manager` in the main window, so the feature works before the fleet updates (with the sidebar still rendered around it).

---

## Scope of this iteration

Implemented: chat list (search + All/Pinned/Unread filters, load older), thread history with lazy load on scroll-up, send, mark-as-read.

Deliberately **not** implemented: vault/media upload, PPV composition, per-function permissions, audit logs, time-tracking gating, linking to the `creators` collection, earnings, notifications. Media on existing messages renders as an attachment chip rather than an image — nothing here assumes text-only, but rendering signed CDN/DRM media is its own piece of work.

The shape anticipates them: the adapter covers the whole provider surface, `chatDocId` is account-scoped, and `OF_PAGE_ID` is the single place the permission is named.

## Gotchas

- [ ] Adding a provider call → add it to `IOnlyFansClient` first, then implement. Never call the provider from a route.
- [ ] New OnlyFans route → `requireOnlyFansAccess(token.uid)` before anything else.
- [ ] Changing the mirror's shape → update `chatChanged`, or syncs will write every row on every pass.
- [ ] `electron/` changed → new build, released in **two pushes** (rule 14 in [CLAUDE.md](../CLAUDE.md)).
- [ ] `ONLYFANS_ACCOUNT_ID` must be pinned before a second account is linked.
