# Notification System

> All notification **content** is centralized in one file; all **writes** go through one batch helper. Follow both rules — copy edits and new events have exactly one correct place each.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/notificationContent.ts` | **ONLY** place notification copy (titles, messages, types, actionUrls) lives. Named factory functions returning `NotificationContent`. |
| `src/lib/middleware/apiHelpers.ts` | `addNotificationToBatch(batch, userId, content)` — writes to Firestore with boilerplate fields |
| `src/hooks/useNotifications.tsx` | Client-side notification stream |
| `src/components/NotificationTray.tsx` | UI surface |
| `src/hooks/useAdminNotifications.ts` | Admin broadcast/announcement management |
| `src/lib/automatedNotifications.ts` | **Display-only catalogue** of every *automated* notification (trigger, recipients, source route). Derives its copy by calling the real factories with `{token}` placeholders — it never retypes a title or message. |
| `src/lib/notificationTypeBadge.ts` | `notificationTypeBadge(type)` — the one badge label/colour map per `NotificationType`, shared by all three admin notification surfaces |
| `src/components/admin/notifications/AutomatedNotificationsList.tsx` | Renders the catalogue on the **Automated** tab of `/admin/notifications` |
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
| CR/campaign transferred | `notifications.crTransferred(transferrerName, creatorName, actionUrl)` | the receiving uid | `campaign-tracking/[id]/transfer` |
| Leave approved | `notifications.leaveApproved(leaveLabel, dateStr)` | the requesting user | `shifts/leave/[leaveId]/approve` |
| Leave denied | `notifications.leaveDenied(leaveLabel, dateStr)` | the requesting user | `shifts/leave/[leaveId]/approve` |
| Dispute assigned | `notifications.disputeAssigned(createdByName)` | `assignedTo` (skipped when `'No One'`) | `disputes` (POST) |
| Dispute — CA approved | `notifications.disputeCaApproved(assignedToName)` | the dispute's `createdBy` | `disputes/[disputeId]/ca-approval` |
| Dispute — CA rejected | `notifications.disputeCaRejected(assignedToName, reason?)` | the dispute's `createdBy` | `disputes/[disputeId]/ca-approval` |
| Dispute — admin approved | `notifications.disputeAdminApproved()` | the dispute's `createdBy` | `disputes/[disputeId]/admin-approval` |
| Dispute — admin rejected | `notifications.disputeAdminRejected(reason?)` | the dispute's `createdBy` | `disputes/[disputeId]/admin-approval` |
| Content request completed | `notifications.contentPlanCompleted(stageName, contentSummary)` | `groups/OFAM.members` | `content-planning/[id]/creator-complete` |
| Model application received | `notifications.modelSubmissionReceived(applicantName, location)` | every user whose `permittedPageIds` contains `apps-model-submissions` | `model-submissions/submit` |

## The admin notifications page

`/admin/notifications` has two tabs:

- **Sent** — history of manual admin broadcasts (`notifications-batches`), click a row for per-recipient read/dismiss state and to unsend.
- **Automated** — a **read-only** catalogue of the table above, grouped by category, from `src/lib/automatedNotifications.ts`. Expanding an entry shows the message template (interpolated values render as `{token}` chips), what fires it, who receives it, the `actionUrl`, and the source route. Nothing on this tab is sendable, editable or unsendable — it exists so admins can see what the system sends on its own.

## Adding a new notification event

1. Add a factory function to `src/lib/notificationContent.ts`.
2. Call `addNotificationToBatch(batch, uid, notifications.yourNew(...))` in the relevant handler; `await batch.commit()`.
3. For admin fan-out, iterate `groups/admin.members` — **never hardcode a uid**.
4. Add an entry to `AUTOMATED_NOTIFICATIONS` in `src/lib/automatedNotifications.ts` (call your factory with `{token}` placeholders — **never retype the copy**) and a row to the table above, so the Automated tab and these docs stay complete.
