# Prompt Library — sharing & access upgrade (working plan)

Read first: `documentation/prompt-library.md` (*Authorization*, *Sharing a prompt*, *Read/write budget*), `documentation/resources.md` (group-grant precedent), DESIGN.md, then `craft-floor.md` before any UI edit.

## Decisions (confirmed with user, 2026-11-13)
1. **The organisation owns every prompt.** There is no individual owner. Admins are the implicit owner of all prompts, existing and future. Whoever creates a prompt is just its first **editor**.
2. **Existing prompts → admins only**, with edit access. No migration write is needed: org ownership is implicit, and a missing `access` field means no grants.
3. **Admins see and edit everything as a fallback.** Their everyday view still shows only what was shared with them; an admin-only **Show all prompts** switch reveals the rest.
4. **Editors manage sharing:** they add or remove people and groups, change roles, and turn the public link on or off. Viewers only read and copy.
5. **Home: one board** with an `All · Created by me · Shared with me` filter, not a separate section.
6. The public link (`/p/[shareId]` and the `prompt-shares` index) is kept unchanged and becomes one row of the sharing model.

## Roles
| Role | Who | Can |
|---|---|---|
| `admin` (implicit owner) | `token.admin` claim or `admin` group (same test as resources) | everything, incl. hard delete; sees all prompts |
| `edit` | user or group grant; the creator at create time | content, versions, metadata, archive, **sharing**, public link |
| `view` | user or group grant (**default** for new grants) | read, history, copy text |
| none | — | the prompt does not exist for them (404, never 403) |

Union of user + group grants, highest wins. One pure resolver: `src/lib/promptAccess.ts` → `roleFor(prompt, { uid, groups, isAdmin })`.

## Data model (head doc `prompt-library/{id}`)
| Field | Notes |
|---|---|
| `access.users` | `{ [uid]: { role: 'view'\|'edit', grantedBy, grantedAt } }` |
| `access.groups` | `{ [groupId]: { role, grantedBy, grantedAt } }` — ids match `users.groups` |
| `share` | **Unchanged.** Present means the prompt is public. |

- On create: `access.users[creatorUid] = { role: 'edit', … }`.
- Exempt `access` from indexing (rule 9). Filtering stays in memory over the one cached `.get()`; no composite index, no Firestore rules change (the collection stays deny-all).
- `grantedBy`/`grantedAt` exist because editors can re-share: the dialog shows who added whom, which is the only check on access quietly spreading.

## Server
1. `getPromptLibraryFor(viewer)`: filter the 60s global cache per caller and attach `myRole` to each prompt. For admins, also return the prompts outside their grants, flagged `viaAdmin: true`, so the Show-all switch is client-side with no refetch.
2. Route guards (the page permission stays as the outer gate):
   - GET list → filtered.
   - GET versions → `view+`.
   - POST/PATCH version, PATCH meta, archive → `edit+`.
   - share POST/DELETE → `edit+`.
   - DELETE → admin claim (unchanged).
   - Unseen prompt → 404.
3. **`PUT /api/prompt-library/[id]/access`** (`edit+`): body is the delta `{ add, update, remove }`, merged in a transaction, so two editors don't overwrite each other (lesson from the Sharing page, known issue #4). Validate:
   - uids: active, unarchived **employees**; one `getAll`; never a creator or training-candidate id.
   - group ids: real groups.
   - roles: in the enum.
   - Returns the new `access` so the client patches state rather than refetching.
4. **People/group directory for the picker**: reuse an existing endpoint that projects `{uid, displayName, photoURL}` of active, unarchived staff, plus group ids and names. Check before adding one; if adding, cache it with `private, max-age` + `Vary: Authorization` (rule 9i).
5. Projection (rule 9i): viewers get `myRole` and no `access` map. Editors and admins get `access` plus the resolved names they need to render the dialog.
6. Keep the old `/share` routes working: renderers that are weeks old (rule 9c) still call them. The server filter protects old renderers automatically.

## UX brief (Operate mode, inside the established console world, no new visual language)

**Job.** Staff keep a working set of prompts. They need to (a) find the ones that are theirs or were handed to them, and (b) hand a prompt to the right colleagues or groups in seconds, with confidence about who can change it.

**Share dialog** (opened from the detail card; the centre of the work):
- Title `Share "{prompt title}"`.
- **Add row**: one `Command` combobox searching people and groups together. Groups are listed first with a Users icon; people use avatars seeded from `displayName` (rule 7). Next to it, a role `Select` defaulting to **Can view**, then an **Add** button. Multi-select: several people/groups can be staged as removable chips before adding.
- **Access list**:
  - First row is locked: **Bluu Rock admins · Owner**, with no control. This is where "the organisation owns this" shows up for the user.
  - Then groups, then people. Each row shows: icon/avatar, name, the line "Added by {name} · {date}", and a role `Select` (Can view / Can edit / divider / Remove).
  - Deactivated or archived users show muted with a "Deactivated" tag and only offer Remove.
- **Public link** section, below a hairline:
  - A `Switch` labelled "Anyone with the link can view".
  - When on: a read-only URL field plus a Copy button.
  - Helper copy: "Opens in any browser without signing in. No names or edit history are included."
- **Behaviour**:
  - Each change saves immediately, row by row, with a toast that offers Undo. This is the same pattern as `/admin-portal/sharing`; there is no Save button.
  - A failed save puts the row back and shows an error toast.
  - Removing yourself, or dropping yourself to view, asks for a lightweight inline confirmation: "You'll lose edit access" / "You'll lose access to this prompt". On confirm the dialog closes and the prompt leaves the board.

**Detail dialog:**
- Footer "Copy link" becomes **Share**, with an avatar stack of up to 3 grantees plus "+n". It is shown only to `edit+` users.
- Viewers get a **View only** chip in the header, and every edit affordance (new version, edit metadata, archive, save-over) is removed rather than disabled. Copying text and browsing history still work.
- A `viaAdmin` prompt shows an **Admin access** chip, so an admin knows they are outside the sharing.

**Home / board:**
- Segmented filter `All · Created by me · Shared with me`. "Shared with me" means visible and not created by me. Counts are shown in each segment.
- Cards for prompts you didn't create get a small owner-less provenance mark: a group icon or avatar showing how you got access, with a tooltip like "Shared with CA (view)".
- The admin-only **Show all prompts** switch sits in the toolbar and is remembered per device in localStorage.
- The Public Prompts rail becomes **Public links**: public prompts you can see. Copying a link from it still issues no request.
- Model pages and search work over the visible set. With Show all on, search includes everything.

**States:**
- Empty, for a new person: "Nothing has been shared with you yet. Prompts you create, and ones colleagues share with you, show up here." with a New prompt button.
- Empty "Shared with me" filter has its own line.
- Picker loading uses a skeleton; picker has no-results text; directory load error has a retry.

**Anti-goals:**
- No new colours or "sharing" palette.
- No public-link-as-hero.
- No confirm modal for ordinary role changes.
- No exposing who has access to view-only users.
- Don't make the admin row look editable.

**Ranges.** 0–30 grants per prompt (groups: ~6 org groups). The directory is a few dozen staff. The library is hundreds of prompts, so filtering in memory is fine.

## Client mechanics
- Bump the cache key `bluu_prompt_library_v2` → `_v3` (shape gains `access`, `myRole`, `viaAdmin`).
- Context gains `updateAccess(id, delta)`, which patches state and cache from the response (no re-read).
- shadcn components only (`Dialog`, `Command`, `Popover`, `Select`, `Switch`, `Badge`, `Avatar`, `Tooltip`, `ToggleGroup` for the filter); icons from tabler/lucide only.

## Notifications (open)
- "{name} shared a prompt with you" (in-app). If built: `notificationContent.ts` + `automatedNotifications.ts` + notifications.md row (rules 5, 15). Group grants would fan out to every member, so coalesce or skip groups.

## Docs (rule 11)
- `documentation/prompt-library.md`: the org-ownership model, roles, schema, Authorization, Sharing, cache key.
- DESIGN.md if the Share dialog becomes a reusable pattern.
- No Firestore rules or index change except the `access` field-override exemption, **which must be flagged to the user with its deploy command**.

## Open decisions (builder must not invent)
1. Should authors of existing prompts get an editor grant on their own prompts, or are those strictly admin-only until re-shared? (Current reading: admin-only, as stated.)
2. Share notification: yes/no; for groups too?
3. Is a group grant live membership (someone joining CA later gains access)? Assumed **yes**: it is resolved at read time.

## Order of work
1. `promptAccess.ts` + types
2. Service filter + route guards + `/access` route + directory source
3. Context + cache bump
4. Share dialog → detail dialog changes → board filter/admin switch/rail
5. Docs + index exemption notice
6. `/simplify` (rule 17)
