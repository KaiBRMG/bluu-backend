# Notification System

> All notification **content** is centralized in one file; all **writes** go through one batch helper. Follow both rules — copy edits and new events have exactly one correct place each.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/notificationContent.ts` | **ONLY** place notification copy (titles, messages, types, actionUrls) lives. Named factory functions returning `NotificationContent`. |
| `src/lib/middleware/apiHelpers.ts` | `addNotificationToBatch(batch, userId, content)` — writes to Firestore with boilerplate fields |
| `src/hooks/useNotifications.tsx` | Client-side notification stream |
| `src/components/NotificationTray.tsx` | UI surface. Its visual + motion contract (the type/read dot, the bell strike, the badge ink) is documented in [DESIGN.md](../DESIGN.md#the-notification-tray) — read it before changing the tray's look. |
| `src/hooks/useAdminNotifications.ts` | Admin broadcast/announcement management |
| `src/lib/automatedNotifications.ts` | **Display-only catalogue** of every *automated* notification (trigger, recipients, source route). Derives its copy by calling the real factories with `{token}` placeholders — it never retypes a title or message. |
| `src/lib/services/onlyfansOpsAlerts.ts` | `sendOpsAlertOnce` + the single-maintainer recipient uid, for the two OF Manager diagnostics |
| `src/lib/notificationTypeBadge.ts` | Two maps, one per ground. `notificationTypeBadge(type)` — badge label/colour for the three **admin** surfaces (light chips, `-600` inks). `notificationTypeDot(type)` — the `-400` semantic hue for the **tray's** leading dot on the near-black panel. Import the one that matches the surface; never re-map a type to a hex inline. |
| `src/components/admin/notifications/AutomatedNotificationsList.tsx` | Renders the catalogue on the **Automated** tab of `/admin-portal/notifications` |
| `src/lib/services/telegramService.ts` | **Server-only** Telegram Bot API delivery + recipient resolution. Owns formatting, never copy. See "Telegram alerts" below. |
| `src/lib/notificationActionUrl.ts` | Pure classifier: is an `actionUrl` an app route or an external link? Shared by the client helper below **and** the server (which normalises before storing). See RULE 3. |
| `src/lib/notificationNavigation.ts` | `navigateToNotificationAction(router, actionUrl)` — the **only** place an `actionUrl` is followed. External vs internal branch + arms `NavigationWatchdog`. See RULE 3. |
| API: `src/app/api/notifications/*` | `create`, `dismiss`, `mark-read` |
| API: `src/app/api/admin/notifications/*` | admin send + `[batchId]/recipients` (GET) + `[batchId]` (DELETE = "unsend": removes every per-user notification doc for the batch + the batch record) |

## Firestore

- `notifications/{docId}` — per-user notification records.
- `notifications-batches/{batchId}` — admin broadcast batches.

---

## RULE 1 — Content lives in ONE file

All notification content is centralized in `src/lib/notificationContent.ts`. Each notification is a **named factory function** returning a `NotificationContent` object. **When adding or editing notification copy, only edit this file.**

## RULE 2 — Write via `addNotificationToBatch`

`addNotificationToBatch` (from `apiHelpers.ts`) handles boilerplate fields: `read`, `dismissedByUser`, `createdAt`, `announcement`, `announcementExpiry`.

```ts
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';

const batch = adminDb.batch();
addNotificationToBatch(batch, userId, notifications.crCompleted(cr, stageName));
await batch.commit();
```

## RULE 3 — Following an `actionUrl` goes through `navigateToNotificationAction`

`src/lib/notificationNavigation.ts` is the only place a notification's `actionUrl` is acted on. All three surfaces call it — the tray (`NotificationTray`), the home-page widget (`(main)/page.tsx`), and the OS toast's `notification:navigate` IPC (`useNotifications`):

```ts
import { navigateToNotificationAction } from '@/lib/notificationNavigation';
navigateToNotificationAction(router, notification.actionUrl); // no-ops on null/undefined
```

It settles two things that must not be allowed to drift apart between surfaces:

- **An external action URL opens in the system browser**, never `router.push` — pushing an external URL navigates the Electron window itself off the app. `window.open` is correct inside Electron: `setWindowOpenHandler` turns it into `shell.openExternal` and denies the popup.
- **What counts as external is decided by `classifyNotificationAction`** in [`notificationActionUrl.ts`](../src/lib/notificationActionUrl.ts), **not** a `startsWith('http')` check. That check was the original implementation and it was wrong: an admin who typed `www.example.com` into the create dialog's external-URL field stored exactly that, the check missed it, and every surface `router.push`ed it — navigating the Electron window to a nonexistent route that 404s instead of opening the browser. The rule is now *an internal route is a path starting with `/`*; a scheme-less host (`example.com/x`) is external and gets `https://` prepended, `//host` is external, and an unsafe scheme (`javascript:`, `file:`, `data:`) resolves to **no action at all** rather than being pushed or handed to the shell.
- **The same classifier normalises on write.** `POST /api/admin/notifications` stores the canonical form, so a value in Firestore is unambiguous regardless of which surface later reads it, and the create dialog uses it to preview and validate the field (an unusable external URL blocks submit). Defence in depth — the read-side classification stands on its own, which is what fixes notifications that were *already* stored badly.
- **A relative one arms [`NavigationWatchdog`](../src/components/NavigationWatchdog.tsx)** via its exported `watchNavigation(to, source)`. The watchdog's own listener only sees anchor clicks; a `router.push` gives it nothing to observe, so without this call an action URL is the one navigation it cannot rescue — and the worst one to lose, because clicking the notification is also what dismisses it. Rescues from this path are tagged `source: notification-action` in Sentry. `watchNavigation` only schedules a check (4s) and no-ops when there is no transition to watch, so calling it is never a navigation of its own.

Any new surface that renders notifications must use this helper rather than re-implementing the branch.

---

## Notification Events → Factory Functions

Every row below is **automated** — fired by a handler on an event, never sent by hand. `Recipients` is the authority on fan-out.

| Event | Factory | Recipients | Sent by |
|---|---|---|---|
| New user — welcome message | `notifications.welcomeToTeam(firstName)` | the new user | `services/userService.ts` |
| New user — admin alert | `notifications.adminNewUserAlert()` | **every uid in `groups/admin.members`** (do not hardcode an admin uid) | `services/userService.ts` |
| CR submitted | `notifications.crCreated(creatorName, stageName)` | every uid in `groups/OFAM.members` | `campaign-tracking/create` |
| CR rejected | `notifications.crRejected(editorName, cr, stageName)` | the entry's `createdBy` | `campaign-tracking/[id]` |
| CR completed | `notifications.crCompleted(cr, stageName)` | `groups/OFAM.members` | `campaign-tracking/[id]` **and** `campaign-tracking/[id]/creator-complete` |
| CR/campaign transferred **by its owner** | `notifications.crTransferred(transferrerName, creatorName, actionUrl)` | the receiving uid | `campaign-tracking/[id]/transfer` |
| CR/campaign transferred **by someone else** (manager) | `notifications.crTransferredOnBehalf(previousOwnerName, creatorName, actionUrl)` | the receiving uid | `campaign-tracking/[id]/transfer` |
| Leave approved | `notifications.leaveApproved(leaveLabel, dateStr)` | the requesting user | `shifts/leave/[leaveId]/approve` |
| Leave denied | `notifications.leaveDenied(leaveLabel, dateStr)` | the requesting user | `shifts/leave/[leaveId]/approve` |
| Dispute assigned | `notifications.disputeAssigned(createdByName)` | `assignedTo` (skipped when `'No One'`) | `disputes` (POST) |
| Dispute — CA approved | `notifications.disputeCaApproved(assignedToName)` | the dispute's `createdBy` | `disputes/[disputeId]/ca-approval` |
| Dispute — CA rejected | `notifications.disputeCaRejected(assignedToName, reason?)` | the dispute's `createdBy` | `disputes/[disputeId]/ca-approval` |
| Dispute — admin approved | `notifications.disputeAdminApproved()` | the dispute's `createdBy` | `disputes/[disputeId]/admin-approval` |
| Dispute — admin rejected | `notifications.disputeAdminRejected(reason?)` | the dispute's `createdBy` | `disputes/[disputeId]/admin-approval` |
| Content request completed | `notifications.contentPlanCompleted(stageName, contentSummary)` | `groups/OFAM.members` | `content-planning/[id]/creator-complete` |
| Model application received | `notifications.modelSubmissionReceived(applicantName, location)` | every user whose `permittedPageIds` contains `apps-model-submissions` | `model-submissions/submit` |
| Desktop app updated | `notifications.releaseNote(version)` | each user as they reach `APP_UPDATE.releaseNote.version` | `user/app-version` |
| OF media cache hit its size threshold | `notifications.ofMediaCacheCritical(sizeLabel, periodLabel)` | **one named maintainer** — see below | `cron/onlyfans-media-usage` |
| OF video renditions on an unrecognised host | `notifications.ofVideoSourceHostUnrecognised(host)` | **one named maintainer** — see below | `onlyfans/chats/[chatId]/messages` (via `after()`) |

### The two OF Manager alerts — one recipient, once ever

These two are operational diagnostics, not workflow events, and they break the "iterate `groups/admin.members`, never hardcode a uid" rule on purpose. That rule exists to stop a notification **meant for all admins** silently reaching only the one whose id someone typed. These are the opposite: they name a Cloud Storage prefix and a regex constant, and they are addressed to the person who maintains that subsystem. Broadcasting them would be noise for everyone who cannot act.

The uid is a single named constant, `OPS_ALERT_RECIPIENT_UID` in [`src/lib/services/onlyfansOpsAlerts.ts`](../src/lib/services/onlyfansOpsAlerts.ts), with exactly one definition. **Change it there when ownership moves** — nothing else refers to it.

`sendOpsAlertOnce(key, content)` is what makes them once-ever, with two guards that fail differently:

- a **latch document** (`onlyfans-meta/ops-alerts`, already denied to every client by the existing rule, so no rules change was needed) survives lambdas, deploys, and the recipient dismissing the notification;
- a **deterministic doc id** (`{uid}__ops-{key}`) means two instances reading the latch in the same instant write one document rather than two.

Both conditions persist until a human fixes them and neither can un-fire, so a repeat would restate a fact the reader already has. They are catalogued on the Automated tab regardless — an admin should be able to see that they exist.

### Release notes ("what's new") — gated on the installed build

The one notification whose recipient list is decided by **what version of the desktop app someone is running**, not by an action they took. It exists so a release can announce itself only to people who can actually use it.

**It is deliberately absent from the Automated tab** — the single sanctioned exception to cross-cutting rule 15. That tab records what the system sends *on an ongoing basis*; a release note is once-off and self-disarming, so listing it would describe standing behaviour that does not exist. The exception is noted in `automatedNotifications.ts` itself so nobody "fixes" it.

- **The gate is `APP_UPDATE.releaseNote` in [`src/lib/appUpdateConfig.ts`](../src/lib/appUpdateConfig.ts)** — `{ version }`, or `null` (the default between releases, meaning nobody is notified). It sits in the update config on purpose: that file is already the per-release gate of record, and this is its mirror image — `mac`/`win` target people who have **not** updated, `releaseNote` targets people who **have**.
- **Not per-platform.** The update *prompt* is, because it asks people to do work; a note just says what changed. Where a release lands differently on the two platforms, the copy says so — the current one covers the timer widget as a single feature with two surfaces (menu bar on Mac, HUD on Windows).
- **The copy is `notifications.releaseNote(version)`** and, unlike every other factory, it is **rewritten per release** — it describes one specific build. Bumping `releaseNote.version` without rewriting the message ships the previous release's copy, which is the only real failure mode here. Same commit, always.
- **Delivered once per user, ever.** `users/{uid}.releaseNoteNotifiedVersion` records what they have been told about; the notification also uses a deterministic doc id (`{uid}__release-{version}`) so two app starts racing cannot produce two.
- **Trigger: `POST /api/user/app-version`**, driven by [`AppVersionReporter`](../src/components/AppVersionReporter.tsx) on app start. That component posts for **two** reasons — the reported build changed, *or* a note is owed for the build already reported. The second is not redundant: a user who updated **before** the note was armed has already reported that version, so a change-only trigger would never fire for them again.
- **The client's opinion is never trusted.** `releaseNoteAppliesTo()` is re-evaluated server-side against the version that request just reported, so nobody can ask for a note about a build they are not on.
- **Safe to arm in the same push as the code**, unlike `latestVersion` — cross-cutting rule 14's two-push order does not apply to this field. It can only fire for a build that already reports the target version, and nobody is on that build before the release exists.

## The admin notifications page

`/admin-portal/notifications` has two tabs:

- **Sent** — history of manual admin broadcasts (`notifications-batches`), click a row for per-recipient read/dismiss state and to unsend. Batches that were also pushed to Telegram carry a "Telegram" chip next to the title.
- **Automated** — a **read-only** catalogue of the table above, grouped by category, from `src/lib/automatedNotifications.ts`. Expanding an entry shows the message template (interpolated values render as `{token}` chips), what fires it, who receives it, the `actionUrl`, and the source route. An entry with `telegramEnabled: true` carries the same "Telegram" chip as the Sent tab. Nothing on this tab is sendable, editable or unsendable — it exists so admins can see what the system sends on its own.

  **A separate Creators section sits below the categories**, from `AUTOMATED_CREATOR_NOTIFICATIONS` — see [Creator notifications](#creator-notifications-telegram-only) below.

## Creator notifications (Telegram only)

Creators have no in-app notification surface — no `notifications/{docId}` documents, no tray. Four automated events notify them anyway, entirely over Telegram:

| Event | Factory (`telegramMessages.*`) | Recipient | Sent by |
|---|---|---|---|
| Custom request approved (Awaiting Approval → In Progress, `type: 'CR'`) | `creatorNewCustomRequest(fanName, totalAmount)` | The creator | `campaign-tracking/[id]` (PATCH) |
| Item request approved (same transition, `type: 'Item'`) | `creatorNewItemRequest(fanName, totalAmount)` | The creator | `campaign-tracking/[id]` (PATCH) |
| Call approved (same transition, `type: 'Call'`) | `creatorNewScheduledCall(callType, fanName, date, totalAmount)` | The creator | `campaign-tracking/[id]` (PATCH) |
| Content request created | `creatorNewContentRequest()` | The creator | `content-planning` (POST) |

- **Guarded to the genuine approval transition.** The three campaign-tracking events fire only when `prevStatus === 'Awaiting Approval' && newStatus === 'In Progress'` **and** the entry's `type` is `CR`/`Item`/`Call` — never on the BFE/Hubby/VIP campaign types (created directly `In Progress` as a sentinel, never "approved") and never on the unarchive action (also a move into `In Progress`, but not a new request the creator hasn't seen).
- **Delivery is one recipient at a time**, via `sendTelegramToCreator(creatorUid, html)` in `telegramService.ts` — `resolveCreatorChatId` reads `creators/{uid}.telegram.chatId` directly. This is deliberately **not** `resolveChatIds`/`sendTelegramNotification`, which resolve against the `users` collection only (see [telegram.md](telegram.md)).
- **Never throws**, same as every other Telegram send here — a creator who has not linked Telegram (or any Telegram outage) must not fail the staff action that triggered the message.
- **Catalogued despite RULE 1's "bot copy is not catalogued"** — see [telegram.md](telegram.md#rule-1--bot-copy-lives-in-notificationcontentts) for why this is a deliberate, narrow carve-out.

## Telegram alerts

A second delivery channel, **additive to the in-app notification, never a replacement** — two paths use it.

**Manual admin sends.** The Create Notification dialog has an "Also send as a Telegram alert" checkbox; unchecked, the send behaves exactly as it always did **for employee recipients**. Creator recipients are unaffected by the checkbox — see below.

- **Delivery lives in [`src/lib/services/telegramService.ts`](../src/lib/services/telegramService.ts)** and is **server-only**: `TELEGRAM_BOT_TOKEN` must never reach the client. Nothing in `src/components` or `src/hooks` may import it.
- **Order matters.** `POST /api/admin/notifications` commits the Firestore batch **first**, then attempts Telegram. `sendTelegramNotification` never throws — it returns `{ sent, failed, skipped, error }`, the route echoes it as `telegram` on the response, and the dialog toasts a *warning* on a partial failure. A Telegram outage must never lose an in-app notification that is already written.
- **Copy is still the caller's.** The service formats (`<b>Title</b>`, blank line, message) and escapes `& < >` for HTML parse mode. It does not author text — rule 1 is unchanged.
- **`sentViaTelegram: boolean` is written on the batch doc** (`admin_notification_batches`) and shown as a chip on the Sent tab. It is `true` whenever the checkbox was checked **or** any creator was a recipient — Telegram genuinely gets used either way. Nothing queries it, so it is exempted from indexing in `firestore.indexes.json` (rule 9).

### Creator recipients in a manual send

The Create Notification dialog's recipient picker also lists every creator individually, plus an "All Creators" pseudo-group (not a real `groups/{id}` doc — expanded server-side from the `creators` collection, filtering archived, the same way a real group expands from `members`). Creator uids never enter `allRecipientUids` (the set that drives `notifications` doc writes) — they go through the separate `creatorIds`/`allCreators` body fields, get no in-app notification, and are sent via `sendTelegramNotificationToCreators` **unconditionally**, regardless of the "Also send as a Telegram alert" checkbox: Telegram is not an *additional* channel for a creator, it is their only one. The route merges the employee-Telegram result and the creator-Telegram result into one `telegram` object before responding, so the client shows a single outcome. See [telegram.md](telegram.md) for the delivery mechanics and [creator notifications](#creator-notifications-telegram-only) above for the parallel automated case.

The recipient list is a narrow, `admin-notifications`-gated projection (`GET /api/admin/notifications/creators`, `uid` + `stageName` only) — deliberately not `/api/admin/creators`, which requires the separate `admin-creator-management` permission and returns far more than a recipient picker needs.

The Sent tab's recipients dialog only ever reads `notifications` docs (in-app only), so a creator recipient never appears in its per-row read/dismiss table; it shows the gap as "+N creators notified via Telegram" instead, computed from `batch.recipientCount` minus the fetched row count.

**Automated notifications.** Every event in the table above **except Onboarding and OF Manager** also calls `sendTelegramNotification` with the same recipients and the same `NotificationContent`, right after the in-app batch commits — same order-matters rule, same never-throws contract. The Automated tab marks each wired entry with a Telegram chip (`AutomatedNotification.telegramEnabled`). Onboarding is excluded because a user who has never used the app has nothing to have linked yet; OF Manager's two alerts are excluded because they already have one named recipient and no fan-out to widen.

**`actionUrl` handling is shared by both paths**, in `resolveActionLine()` inside `telegramService.ts`:
- An **external** URL (per `classifyNotificationAction`, [`notificationActionUrl.ts`](../src/lib/notificationActionUrl.ts)) is linked directly: `<a href="…">Open link</a>`.
- An **internal** app route is *not* linked — `src/middleware.ts` rewrites non-Electron page traffic to `/desktop-only`, so a link to an in-app page opened from a phone is a dead end — but it is not silently dropped either. It is resolved against `PAGES` in [`definitions.ts`](../src/lib/definitions.ts) and named instead: `View on Bluu Backend > Disputes`. A route with no matching `PageDef` resolves to nothing (should not happen — every `actionUrl` this app produces is one of `PAGES`' hrefs).

### Recipient resolution

`resolveChatIds(uids)` maps recipient uids onto the chat ids on their user docs, in a single batched `getAll` with a field mask — one read per recipient, no N+1, and only `telegram.chatId` comes back (cross-cutting rule 9). Users who have not linked Telegram simply drop out; **that is the opt-out**, and it is why "Disconnect" in App Settings genuinely stops delivery rather than just hiding a badge.

There is deliberately **no `TG_BOT_TEST_ID` fallback any more.** It existed while nobody had linked an account, and it sent every Telegram-flagged broadcast to one test chat. Keeping it after real linking would mean a send whose recipients happen to be unlinked lands in that chat instead of nowhere — misdelivery dressed up as success. An unresolvable send returns `skipped`, and the in-app notification still goes out.

Env vars (server-only, no `NEXT_PUBLIC_` prefix): `TELEGRAM_BOT_TOKEN`, plus `TELEGRAM_WEBHOOK_SECRET` for the bot webhook. Missing the token → the send is `skipped`.

Account linking, the bot webhook and the creator Mini App are all documented in [telegram.md](telegram.md). **Bot copy (`telegramMessages.*`) also lives in `notificationContent.ts`** — rule 1 is about copy, not storage — but it is **not** catalogued in `automatedNotifications.ts`: rule 15 governs in-app notifications, and a bot message on the Automated tab would misdescribe what that tab is.

## Adding a new notification event

1. Add a factory function to `src/lib/notificationContent.ts`.
2. Call `addNotificationToBatch(batch, uid, notifications.yourNew(...))` in the relevant handler; `await batch.commit()`.
3. For admin fan-out, iterate `groups/admin.members` — **never hardcode a uid**.
4. Immediately after the commit, call `await sendTelegramNotification(uids, content)` with the same recipients and the same content object — unless the event is Onboarding or an OF Manager diagnostic, which stay in-app only (see "Automated notifications" under Telegram alerts, above).
5. Add an entry to `AUTOMATED_NOTIFICATIONS` in `src/lib/automatedNotifications.ts` (call your factory with `{token}` placeholders — **never retype the copy** — and set `telegramEnabled: true` if you did step 4) and a row to the table above, so the Automated tab and these docs stay complete.

A creator-facing event (no in-app tray) is different: add the copy to `telegramMessages.*` instead, send with `sendTelegramToCreator`, and add the entry to `AUTOMATED_CREATOR_NOTIFICATIONS` — see [Creator notifications](#creator-notifications-telegram-only) above.
