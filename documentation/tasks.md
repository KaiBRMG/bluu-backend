# Tasks (`tasks` collection)

> `/applications/apps-tasks` — every employee's own to-do list and standing roles, which admins can also see and manage for everyone. A **universal page** (org-wide, no page permission, no Sharing row, sits directly under Resources in the sidebar), so the data layer is the whole authorization story.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/types/task.ts` | Shared client-safe types, the two status vocabularies, length limits |
| **`src/lib/taskAccess.ts`** | **The access rules and status vocabulary — single source of truth, imported by the API and the UI.** The UI copy is cosmetic; the server is the gate |
| `src/lib/services/taskService.ts` | Server-only reads/writes (update and delete are transactions), `parseTaskWrite` validation, `getBlockingTasks`, `attachCreatorNames` |
| `src/app/api/tasks/route.ts` | GET (own, or all for an admin) · POST |
| `src/app/api/tasks/[id]/route.ts` | PUT · DELETE |
| `src/app/api/tasks/blocking/route.ts` | GET — the caller's outstanding clock-out-blocking tasks |
| `src/hooks/useTasks.ts` | Client state: sessionStorage cache (60 s, **keyed by uid**), a manual `refresh()`, optimistic status, patches state from each write's response |
| `src/hooks/useClockOutGuard.tsx` | The clock-out prompt — see below |
| `src/app/(main)/applications/apps-tasks/` | The page: `TaskRow` (+ `StatusPill`), `TaskDialog` |
| `src/components/rich-text/RichPromptEditor.tsx` | The body editor, **shared with the Prompt Library** (moved here from its route folder) |
| `src/components/facets/Facet.tsx` | Facet-rail primitives shared with Resources |

## Firestore

- **Collection:** `tasks`. Admin SDK only; rule `allow read, write: if false`.
- Every field except `assigneeUid` and `blocksClockOut` (the two queried) is **exempt from indexing** (`firestore.indexes.json`, rule 9). Non-admin reads are a single-field `where('assigneeUid','==',uid)` with no `orderBy` (sorted in memory), so **no composite index** — and the clock-out check adds a second equality filter (`blocksClockOut`), which needs none either.
- **Delete cascade:** deleting a user removes the tasks assigned *to* them. Tasks they *assigned to others* survive; the creator then renders as a deleted user.

| Field | Notes |
|---|---|
| `title` ≤200 · `text` ≤20,000 · `textHtml` | `text` is **derived server-side** from sanitised `textHtml` (`htmlToPlainText`) — a client-sent `text` is never read. `textHtml` is null for a plain body |
| `kind` | `once-off` or `role` (ongoing) |
| `status` | once-off: To do / In progress / Blocked / Done · role: Active / Paused / Ended. A kind change remaps the status (`remapStatus`) |
| `assigneeUid` / `createdBy` | One assignee. `createdBy !== assigneeUid` ⇒ **admin-assigned** |
| `dueDate` | `YYYY-MM-DD` string, once-off only (a calendar date, not an instant). Overdue is computed in the viewer's zone |
| `blocksClockOut` | Admin-set flag — see below |
| `completedAt` | Stamped on entering Done, cleared on leaving |

## Access

```
                          admin        assignee           anyone else
see                       every task   their own          — (404)
create                    for anyone   for themselves     —
edit own task             yes          yes                —
edit an ASSIGNED task     yes          status only        —
delete own task           yes          yes                —
delete an ASSIGNED task   yes          no                 —
reassign / blocksClockOut yes          no                 —
```

- The rules are `authorizeTaskUpdate` / `authorizeTaskDelete` in `taskAccess.ts`, run on the **live stored document inside the write's own transaction**. An assignee who sends any key besides `status` for an admin-assigned task gets a **403**, not a silent strip. A non-admin sending `assigneeUid` or `blocksClockOut` gets a 403.
- A task the caller cannot read answers **404**, so ids cannot be probed.
- An admin may only assign to an **active, unarchived** user (`isAssignable`).
- **No Cache-Control caching on the list** (`no-store`): the page patches its own state after each write, and a browser-cached list would hand a refetch the pre-write copy.
- The body is sanitised on write and again on read (`promptHtml.ts`). Highlights are the Prompt Library's palette (DESIGN §2).

## Home widget

`TasksHomeWidget` (`src/components/tasks/`) sits in the home page's middle column under Time Tracking, for every user. It shows **your own** outstanding once-off tasks (soonest due first, overdue leading, capped at five with "+N more") and your **Active** roles as greyscale chips — always the viewer's own, even for an admin, whose `useTasks` also carries everyone's. The one action is a check-off button that sets the task **Done** (optimistic, with an Undo toast); the row is otherwise a link to the Tasks page. It gates boot with `useBootPhase('home-tasks')` (rule 8).

## Opening a task

An existing task **always opens read-only**. **Edit** appears only where `canEditTask` allows (an admin, or the assignee of a task they made themselves); an admin-assigned task never offers it to its assignee. Creating opens straight into the form. While reading, the status select is live and saves as it changes, so moving a task along never needs Edit. Cancel leaves edit mode (with a discard confirm if dirty); Escape / the X close the dialog through the same guard.

## The clock-out prompt (`blocksClockOut`)

An admin can mark a task or role **"Ask before they clock out"**. While it is **outstanding** — a once-off not Done, or a role that is Active (`isOutstanding`) — pressing **Clock Out** shows the assignee the outstanding items with **Cancel · Clock Out Anyway · Go to Tasks** (Go to Tasks is the focused default).

- **A nudge, never a lock.** Clock Out Anyway is always there, and every failure of the check (offline, 4s timeout, 500) **clocks the user out as normal** — a person must never be unable to end a shift because Tasks hiccuped.
- **It lives at the button, not in `stopTracking`.** The soft clock-outs (app close, sign-out, the pre-update install) end a session with nobody at the keyboard and must stay unconditional ([time-tracking.md](time-tracking.md)). Both Clock Out buttons — Home's widget and the Time Tracking page — go through `useClockOutGuard`; any new Clock Out button must too.
- `GET /api/tasks/blocking` is `no-store` and returns **nothing for admins**; that exemption lives only there.
- An Active **role** that is flagged will prompt at *every* clock-out until an admin pauses or ends it.
- Rule 9c: it is read over HTTP, so a long-running renderer gains the prompt on its next reload.

## Notification

`notifications.taskAssigned` — only when an admin creates a task for, or reassigns one to, **someone else**. Not for a user's own tasks, not for edits. Catalogued under **Tasks** in `automatedNotifications.ts`.

## Deliberate omissions

No version history (saving overwrites). Delete asks for confirmation rather than offering Undo — re-creating an assigned task would change its id and creator. No reordering, comments or sub-tasks.
