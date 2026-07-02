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
| API: `src/app/api/notifications/*` | `create`, `dismiss`, `mark-read` |
| API: `src/app/api/admin/notifications/*` | admin send + `[batchId]/recipients` |

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

| Event | Factory |
|---|---|
| New user — complete onboarding | `notifications.onboardingActionRequired()` |
| New user — welcome message | `notifications.welcomeToTeam(firstName)` |
| New user — admin alert | `notifications.adminNewUserAlert()` — **fans out to every uid in `groups/admin.members`** (do not hardcode an admin uid) |
| CR submitted | `notifications.crCreated(creatorName, stageName)` |
| CR rejected | `notifications.crRejected(editorName, cr, stageName)` |
| CR completed | `notifications.crCompleted(cr, stageName)` |
| CR/campaign transferred | `notifications.crTransferred(transferrerName, creatorName, actionUrl)` — sent to recipient by `/api/campaign-tracking/[id]/transfer` |
| Leave approved | `notifications.leaveApproved(leaveLabel, dateStr)` |
| Leave denied | `notifications.leaveDenied(leaveLabel, dateStr)` |
| Dispute assigned | `notifications.disputeAssigned(createdByName)` |
| Dispute — admin approved | `notifications.disputeAdminApproved()` |
| Dispute — admin rejected | `notifications.disputeAdminRejected(reason?)` |
| Dispute — CA approved | `notifications.disputeCaApproved(assignedToName)` |
| Dispute — CA rejected | `notifications.disputeCaRejected(assignedToName, reason?)` |

## Adding a new notification event

1. Add a factory function to `src/lib/notificationContent.ts`.
2. Call `addNotificationToBatch(batch, uid, notifications.yourNew(...))` in the relevant handler; `await batch.commit()`.
3. For admin fan-out, iterate `groups/admin.members` — **never hardcode a uid**.
