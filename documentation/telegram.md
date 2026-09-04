# Telegram

> One bot serves two audiences. For **employees** it is an extra notification channel. For **creators** it is the entire product surface — the creator portal runs inside it as a Mini App, and there is no other way in.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/telegramConfig.ts` | **Client-safe** public names: bot username, Mini App short name, `buildTelegramStartLink` |
| `src/lib/telegramWebApp.ts` | Client: injects Telegram's SDK, exposes `window.Telegram.WebApp` |
| `src/lib/services/telegramService.ts` | **Server-only** Bot API calls, `initData` verification, chat-id resolution, message formatting |
| `src/lib/services/telegramLinkService.ts` | **Server-only** account linking: mint / consume / unlink / lookup |
| `src/app/api/telegram/webhook/route.ts` | The bot webhook. Handles `/start <token>` |
| `src/app/api/creator/telegram/session/route.ts` | Mini App `initData` → Firebase custom token. **The creator portal's only sign-in** |
| `src/app/api/admin/creators/[creatorId]/telegram-link/route.ts` | Admin: mint a creator's invite (POST), disconnect (DELETE) |
| `src/app/api/user/telegram-link/route.ts` | Employee self-service: mint own invite (POST), disconnect (DELETE) |
| `src/app/creator/CreatorPortalShell.tsx` | Signs the creator in from `initData`; renders the three refusal screens |
| `src/lib/notificationContent.ts` | `telegramMessages.*` — **all** bot copy |
| `src/scripts/set-telegram-webhook.js` | One-off webhook registration |
| `src/scripts/mint-creator-telegram-links.js` | Bulk-mint creator invites and print them, for sending by hand |
| `src/scripts/fix-creator-menu-buttons.js` | Re-point already-connected creators' menu buttons (one-off repair) |
| `src/scripts/revoke-creator-sessions.js` | One-off flush of every pre-Telegram creator session |
| `src/lib/middleware/withCreatorAuth.ts` | Enforces the `tg` claim — the session lock — before anything else |

## Firestore

- `telegram-links/{sha256(token)}` — one-time invites. Deny-all.
- `telegram-accounts/{telegramUserId}` — the reverse index → `{ subjectKind, subjectUid, chatId }`. Deny-all.
- `users/{uid}.telegram` and `creators/{uid}.telegram` — the forward binding.
- `users/{uid}.telegramLinkTokenHash` / `creators/{uid}.telegramLinkTokenHash` — pointer to the outstanding invite.

All of these are index-exempt in `firestore.indexes.json` (cross-cutting rule 9) — nothing queries them.

## Environment

| Var | Where | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | server only | Every Bot API call **and** the key `initData` signatures are verified against |
| `TELEGRAM_WEBHOOK_SECRET` | server only | Authenticates webhook deliveries. **Unset → the webhook refuses everything** |

`TG_BOT_TEST_ID` is **gone**. It was the placeholder recipient while nobody had linked an account; keeping it after real linking would mean a broadcast whose recipients happen to be unlinked lands in a test chat instead of nowhere.

---

## RULE 1 — Bot copy lives in `notificationContent.ts`

`telegramMessages.*`, next to the in-app notification factories. These are **not** `notifications/` documents and, with one carve-out, are **not** catalogued in `automatedNotifications.ts` — cross-cutting rule 15 governs in-app notifications, and listing a bot message on the Automated tab would normally misdescribe what that tab is. The strings are Telegram HTML (`<b>`, `<i>`); anything interpolated must go through `escapeHtml`.

**The carve-out is the four `creatorNew*` messages.** Creators have no in-app tray to be confused with, so their automated Telegram notifications *are* catalogued, in their own Creators section on the Automated tab (rendered as plain text via `stripTelegramFormatting`, never `dangerouslySetInnerHTML`). Every other `telegramMessages.*` entry (linking, welcome, `/start` replies) stays uncatalogued — those are session/account-state messages, not automated *events*.

## RULE 2 — Never import `telegramService` or `telegramLinkService` from the client

Both read `TELEGRAM_BOT_TOKEN`. Nothing in `src/components` or `src/hooks` may import them. A component that needs the bot's public name imports `telegramConfig.ts`, which holds no secret.

## RULE 3 — Linking is server-authoritative in both directions, always in one transaction

`consumeTelegramLinkToken` writes the index doc **and** the principal doc together. A half-written link is the one state with no user-side recovery: the token is spent, so the link they were sent no longer works, and nothing on either doc says why.

## RULE 4 — Releasing the index is part of every delete cascade

`telegram-accounts/{id}` is what `lookupTelegramSubject` answers from. A leftover entry keeps resolving a deleted principal's Telegram account to their old uid — the same failure `releaseAllDeviceSessions` exists to prevent. Both delete cascades (`/api/admin/users/[uid]` and `/api/admin/creators/[creatorId]`) call `releaseTelegramIndexEntries`, reading the ids off their **pre-delete** snapshot because the doc that holds them is about to go.

---

## Account linking

```
Admin (creator) or the user themselves (employee)
   │ POST .../telegram-link
   ▼
mintTelegramLinkToken
   • 32 random bytes → 43 base64url chars  (Telegram caps `start` at 64, [A-Za-z0-9_-])
   • stores SHA-256 only, 7-day TTL, single use
   • deletes the previous invite via telegramLinkTokenHash  → one live link per principal
   │ returns https://t.me/BluuRockBot?start=<token>
   ▼
User opens the link, presses Start
   │ Telegram POSTs an update with `/start <token>`
   ▼
/api/telegram/webhook
   • X-Telegram-Bot-Api-Secret-Token, compared constant-time
   • private chats, non-bot senders only
   • consumeTelegramLinkToken → binds both directions in one transaction
   • creator → setChatMenuButton('Creator Portal') then the welcome message
   • employee → the welcome message
```

**The token is returned exactly once.** Only its hash is stored, so there is no "show it again" — lose it and mint another, which revokes the first.

### Getting the links out

Two surfaces, same service and same rules:

- **One creator** — the `⋯` row menu on `/admin-portal/creator-management` → "Copy Telegram link", straight to the clipboard.
- **The whole roster** — `cd src && node scripts/mint-creator-telegram-links.js`, which prints one link per creator for sending by hand. `--dry-run` first; already-connected creators are skipped unless you pass `--all`.

**Minting revokes**, so re-running the script over creators you have already sent links to invalidates what you sent — that is why the skip is the default.

This is deliberately **not** a page. A screen rendering every live invite at once would be a standing list of account-binding credentials, and nobody needs to see anyone else's. For the same reason the script's output is credential material: send each creator only their own line, never the whole block into a shared channel.

**Why the doc id is the hash.** A link doc is readable by anything with Admin SDK access — backups, an exported collection, a future admin screen — and a plaintext token there would be a live, replayable credential for someone else's account.

### The webhook's threat model

It is the only unauthenticated write path besides the public model-application form, and it decides account identity. Three things guard it:

1. **The secret header** — set at `setWebhook` time, compared in constant time. Without it, anyone who learns the URL can post a synthetic `/start <token>` and bind **their own** Telegram id to someone else's account, because the update body is the only thing naming the Telegram user. **An unset `TELEGRAM_WEBHOOK_SECRET` refuses everything** rather than falling open.
2. **The token** — 256 bits, single-use, hashed, minted only behind an authenticated surface.
3. **A per-sender rate limit** — in-process, therefore per-lambda and best-effort, same caveat as `exchange-code`'s.

**Past the secret check it always answers 200.** Telegram retries non-2xx deliveries with backoff and eventually disables a webhook that keeps failing, so a bad token — an *expected* input — must not look like an outage. The user is told what went wrong in the chat instead.

### One Telegram account, one principal

`consumeTelegramLinkToken` refuses (`conflict`) a Telegram account already bound to a *different* principal, and releases the stale index entry when a principal moves to a *new* Telegram account. Without the first, one chat would address two identities and a notification's recipient would stop being well defined.

---

## Creators: the Mini App is the whole front door

`t.me/BluuRockBot/BluuBackend` → the webview loads `/creator` → `CreatorPortalShell` exchanges Telegram's signed `initData` for a Firebase custom token. **There is no email/password screen; `/creator/login` was deleted.**

- **The launch payload is read from the URL, not from the SDK.** Telegram opens the webview at `…#tgWebAppData=<initData>&…` and `telegram-web-app.js` merely parses that fragment, so depending on the script adds two failure modes (slow or blocked CDN) for no benefit. [`readTelegramInitData`](../src/lib/telegramWebApp.ts) reads the fragment directly, falls back to the query string, and caches the first read in `sessionStorage`; the SDK is loaded only for `ready()`/`expand()` and its failure is survivable.

  **The fragment is fragile, and that is the failure to know about.** A fragment is client-side only and is re-attached across a 3xx by the browser *usually* — Telegram's in-app webviews are not reliable about it. So **the chat menu button points at `/creator/dashboard`, never `/creator`** (which 307s): one hop is one chance to lose the entire session, and the symptom is the "Open in Telegram" screen shown to a creator who is correctly linked. A client-side navigation or a reload also drops it, which is what the `sessionStorage` cache covers — it is needed because Firebase persistence is in-memory, so every reload re-runs the exchange.

  **Caching it widens nothing.** `sessionStorage` dies with the webview exactly as the in-memory Firebase session does, it is origin-scoped, and the blob is re-verified server-side (signature *and* `auth_date`) on every exchange. A rejected payload is cleared so it cannot be replayed on each reload.

  Creators connected before the menu-button URL was corrected still hold the old one — `cd src && node scripts/fix-creator-menu-buttons.js` re-points them. Idempotent.

- **The `signature` field is tried both ways, deliberately.** Telegram later added a `signature` parameter (Ed25519, for third parties without the bot token). Whether it belongs in the *HMAC* data-check-string is genuinely ambiguous — the spec says "all received fields except `hash`", several client libraries exclude it, and clients predating the field send none at all. Getting it wrong is total: every launch from a newer client fails, and the symptom is a linked creator being told to "Open in Telegram" *from inside Telegram*. Both candidate strings are computed and either match is accepted. It does not weaken anything — a forger still needs a valid HMAC under the bot token for one of two well-defined strings.

- **Every refusal carries an on-screen diagnostic**, because a creator cannot open devtools inside Telegram and neither can whoever they send the screenshot to. `describeTelegramLaunch()` reports where the payload was looked for (`hash:… query:… cache:… sdk:… path:…`); a server refusal reports `server <status> <error> (<reason>)`. Presence flags and lengths only — never the payload, which is a signed credential. **A refusal screen with no diagnostic line at all means the client is running a bundle that predates this**, i.e. Telegram is serving a cached copy — reload the Mini App from its ⋮ menu.

- **`verifyTelegramInitData` is the entire gate.** HMAC-SHA256 with the two-level key the spec requires (`HMAC(HMAC("WebAppData", bot_token), data_check_string)`), plus an `auth_date` freshness window — the HMAC alone never expires, so a captured blob would otherwise mint sessions forever. The window is 24h because Telegram issues `initData` at launch and does not refresh it while the Mini App stays open.
- **`initDataUnsafe` is never trusted.** It is the same content without the signature check. Read it for cosmetics or not at all.
- **Downstream is unchanged.** `CreatorAuthProvider` and the timezone sync work exactly as before; only how the Firebase session starts changed.

### The session lock — three parts, one of which is the real one

The requirement is that the portal is reachable **only** from inside Telegram. A client-side check cannot deliver that: anyone can call the API directly. So the enforcement is a token claim.

**1. `tg: true`, minted only by the Telegram exchange (the actual lock).** `createCustomToken(uid, { tg: true, tgUserId })` embeds a developer claim in every ID token the session mints, preserved across refreshes. `POST /api/creator/telegram/session` is the only thing that can produce it, and only after verifying `initData`. Enforced in two places, because the portal talks to both:

- **`withCreatorAuth`** refuses `token.tg !== true` with a 403, *before* the Firestore read — a non-Telegram token costs no read.
- **`firestore.rules`**, via `isTelegramCreator()`. Every portal screen is a live `onSnapshot`, so checking only in the API would leave the entire data path open. The creator branches of `/creators`, `/campaign-tracking` and `/content-planning` all require the claim; employee branches are untouched.

This is what makes leaving creator passwords in place survivable: the credential still exists, but a session built from it carries no `tg` claim and reaches nothing.

**`checkRevoked` is deliberately not used** — it would add a round trip to Google's Identity service on every creator API call, and the sessions it would catch are exactly the ones the claim already refuses.

**2. `inMemoryPersistence`, set before anything else can run.** Firebase's default writes a refresh token into the webview's storage, which would keep working if the same URL were later opened in an ordinary browser on that device. In memory, the session dies with the webview and every launch re-proves `initData`. One round trip per launch.

**3. A restored session is discarded, never adopted.** `onAuthStateChanged` hands the shell any locally persisted user before it gets a say, so `established` gates the render: a `creatorUser` this mount did not itself mint is not trusted, and bootstrap calls `signOut` on it. **Gating the bootstrap on `!creatorUser` — the obvious shape — is precisely how such a session gets let through**, which is the bug this arrangement exists to avoid. `setPersistence` *migrates* the current user rather than clearing it, so the explicit `signOut` is required, not belt-and-braces.

### Flushing the pre-Telegram sessions

Creators signed in during the password era hold refresh tokens that never expire on their own. They are already dead by claim check, but they stay *signed in* client-side and fail every request, which reads as a broken app rather than a signed-out one.

```bash
cd src && node scripts/revoke-creator-sessions.js --dry-run
cd src && node scripts/revoke-creator-sessions.js
```

Run it **once, before sending the links out**. It does not touch passwords or disable accounts — a creator regains access the moment they use their Telegram link.
- **The window after sign-in shows the loader, never a failure screen.** `signInWithCustomToken` resolves before `CreatorAuthProvider` has read `creators/{uid}`, so for a few hundred milliseconds the session exists and `creatorUser` does not. Deriving "no account" from that gap produced a real bug — an "Account unavailable" card flickering on *every successful launch*, because the provider's first callback (with no user) had already set `loading` false. It is also the wrong inference: the session route verified the creator is active before minting the token, so a `creatorUser` that never arrives means the client's own read failed, not that the account is off. The gap is time-boxed (`PROVIDER_SETTLE_TIMEOUT_MS`) and falls through to a retryable error.

- **Three refusal screens, deliberately distinguishable** — not in Telegram at all / not yet linked / linked as a staff account. Unlike the employee login allowlist (which returns one generic 403 so staff cannot be enumerated), the audience here is a creator who has been handed a link and cannot get in, and the caller has already proven ownership of the Telegram account being described.
- **The PWA install path was removed with it.** An installed home-screen copy would open outside Telegram with no `initData` and therefore no session — an icon leading to a dead end. Telegram's own "add to home screen" covers the same need and launches back through the bot. `InstallPrompt.tsx` and `public/creator/manifest.webmanifest` are gone; the icons stay as ordinary favicons.

### The menu button is managed on every `/start`, in both directions

A chat menu button is **per-chat and persistent**: once set it stays until something changes it, which makes "we only ever add one" a leak. A creator who is later disconnected keeps a shortcut into a portal that now refuses them.

So the webhook decides the button on every outcome:

| Outcome | Button |
|---|---|
| Creator linked | `web_app` → `/creator/dashboard` |
| Employee linked | cleared (`type: 'default'`) |
| `/start`, no token, **bound to a creator** | re-set to `web_app` |
| `/start`, no token, **bound to an employee** | cleared |
| `/start`, no token, **not bound** | cleared |
| Invalid / conflict / inactive token | cleared |
| Creator disconnected (admin) | cleared |

**A bare `/start` is three situations, not one.** It costs one indexed read (`lookupTelegramSubject`) to tell them apart, and skipping that read is a real bug: a connected creator tapping Start twice would have their portal button stripped and be told they are not linked. It is also the **self-serve repair for a stale menu-button URL** — a creator linked before the URL was corrected fixes their own by pressing Start.

**Also do not configure a menu button globally in BotFather** (Bot Settings → Menu Button). A global one appears in every chat with the bot and can only be suppressed by a per-chat override, so it turns the table above into a fight. Leave it Disabled and let the webhook own it.

Its `web_app` URL must be on a domain registered for the bot in BotFather, which must match `PUBLIC_APP_ORIGIN` (`publicOrigin.ts`) — **not** the vercel.app host the Electron shell is pinned to, if those two ever diverge.

### Admin surface

`/admin-portal/creator-management` shows a **Telegram** column — `Connected`/`@handle` in green, `Not connected` in orange (warning, not neutral: an unconnected creator cannot sign in at all). The row menu offers "Copy Telegram link" (which becomes "Copy **new** Telegram link" once one is issued — pressing it revokes the previous) and "Disconnect Telegram".

---

## Employees: an extra channel

Linking is self-service — `POST /api/user/telegram-link` mints a link for **the caller's own uid**, taken from the verified token and never from the body. There is deliberately no `uid` parameter: a route that accepted one would let any signed-in user bind their Telegram account to a colleague's identity.

Three surfaces reach it, all duplicating the same mint-and-`window.open` logic rather than sharing a hook:
- **Onboarding's dedicated Link Telegram section** — `src/app/(main)/onboarding/profile/page.tsx`, part of the "Your details" step. Never blocking: it has its own "Skip for now", independent of the step's required-field gate. Completing this step (linked or skipped) sets `users/{uid}.telegramPromptedAtOnboarding: true` alongside `hasCompletedOnboarding`.
- **The announcement card** (see below), when armed.
- **Settings → App Settings → Notifications → Telegram Alerts.** Connect / Disconnect, outside the form's dirty/Save model because connecting is a round trip through another app and disconnecting takes effect immediately.

**Disconnecting is the real opt-out.** `resolveChatIds` reads the chat id off `users/{uid}.telegram`, so removing it genuinely stops delivery — which is what the linking message means by "can be disabled in Bluu Backend settings". There is no separate preference flag to keep in sync.

`contactInfo.telegramHandle` — free text somebody typed into their profile, proving nothing — is **gone**. `/admin-portal/user-management` now shows only the verified bot connection (`users/{uid}.telegram`), read-only, under the Contact section.

### What actually gets delivered

Two paths push to Telegram: **manual admin broadcasts** (the Create Notification dialog's "Also send as a Telegram alert" checkbox) and **automated notifications** — every event in the table in [notifications.md](notifications.md#notification-events--factory-functions) except Onboarding and OF Manager also pushes to Telegram, for whichever recipients have linked their account. The Automated tab of `/admin-portal/notifications` marks each wired entry with a Telegram chip. See [notifications.md](notifications.md#telegram-alerts).

**Creators are a separate case, in both automated and manual sends.** They have no in-app notification tray at all, so Telegram is not an *additional* channel for them — it is the only one.

- **Automated:** the four events that concern creators (a custom/item/call request approved, a content request created) are catalogued in their own **Creators** section on the same Automated tab, a deliberate carve-out from the rule below (RULE 1's "not catalogued" applies to bot copy that has an in-app counterpart to be confused with; these have none). Delivery is `sendTelegramToCreator(creatorUid, html)` — one recipient at a time, read off `creators/{uid}.telegram.chatId`.
- **Manual:** the Create Notification dialog's recipient picker lists every creator individually plus an "All Creators" pseudo-group. A creator recipient is delivered via `sendTelegramNotificationToCreators(creatorUids, payload)` — the batched, `creators`-collection analogue of `sendTelegramNotification` — **unconditionally**, never gated on the dialog's "Also send as a Telegram alert" checkbox (that checkbox only governs employee recipients). See [notifications.md](notifications.md#creator-recipients-in-a-manual-send).

Both paths are deliberately separate from `resolveChatIds`/`sendTelegramNotification`, which are `users`-collection only and would silently resolve a creator uid to nothing.

---

## Setup (once per environment)

```bash
# 1. Generate a webhook secret and put it in src/.env.local AND in Vercel.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Register the webhook.
cd src && node scripts/set-telegram-webhook.js
cd src && node scripts/set-telegram-webhook.js --info     # verify
```

In BotFather: the Mini App's URL must be `<PUBLIC_APP_ORIGIN>/creator`, and that domain must be registered for the bot or `setChatMenuButton` will refuse it.

A script rather than an admin route on purpose: an HTTP endpoint that can re-point the bot is a redirect of every future account link to wherever the caller says — not a button worth having for a thing done twice.

---

## In-app announcements (the module the Telegram rollout card is built on)

Not Telegram-specific, but it ships here and its first entry is the Telegram one.

- **The gate is [`src/lib/announcementConfig.ts`](../src/lib/announcementConfig.ts)** — same shape and reasoning as `appUpdateConfig.ts` and `emailMigrationConfig.ts`. `enabled: false` means nobody. Test on yourself with `uids: ['<your uid>']`.
- **It is read over HTTP** (`/api/announcements`), never from the compiled constant — cross-cutting rule 9c. The cohort match happens server-side so uid and group lists never reach a renderer.
- **Three exits.** The primary action does not dismiss — the card retires when the action's *effect* lands (`hideWhen`, re-checked live off the `useUserData` snapshot), which is the honest signal: someone who opens the link and never presses Start has not finished. "Remind me later" lasts the app session and re-arms on the next start **or the next clock-out**. "×" is permanent, stored in `users/{uid}.dismissedAnnouncements`.
- **The telegram entry's `hideWhen: 'telegram-linked'` also retires for anyone already asked at onboarding.** `announcementConditionMet` treats `users/{uid}.telegramPromptedAtOnboarding` as equivalent to being linked — a user who went through onboarding's dedicated Link Telegram section (linked or "Skip for now") has already seen this exact ask, so the card would only repeat it. Users who onboarded before that section existed never got the flag, so they still see the card.
- **Dismissals are append-only**, written with `arrayUnion` in `/api/user/update`: the app can have more than one window open, and a read-modify-write of the full list from each would silently drop the other's dismissal.
- **`id` is never reused** — dismissals are keyed on it, so recycling one hides a new announcement from everyone who dismissed the old.
