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

- **An `http(s)://` action URL opens in the system browser**, never `router.push` — pushing an absolute external URL navigates the Electron window itself off the app.
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

- **Sent** — history of manual admin broadcasts (`notifications-batches`), click a row for per-recipient read/dismiss state and to unsend.
- **Automated** — a **read-only** catalogue of the table above, grouped by category, from `src/lib/automatedNotifications.ts`. Expanding an entry shows the message template (interpolated values render as `{token}` chips), what fires it, who receives it, the `actionUrl`, and the source route. Nothing on this tab is sendable, editable or unsendable — it exists so admins can see what the system sends on its own.

## Adding a new notification event

1. Add a factory function to `src/lib/notificationContent.ts`.
2. Call `addNotificationToBatch(batch, uid, notifications.yourNew(...))` in the relevant handler; `await batch.commit()`.
3. For admin fan-out, iterate `groups/admin.members` — **never hardcode a uid**.
4. Add an entry to `AUTOMATED_NOTIFICATIONS` in `src/lib/automatedNotifications.ts` (call your factory with `{token}` placeholders — **never retype the copy**) and a row to the table above, so the Automated tab and these docs stay complete.
