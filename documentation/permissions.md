# Permissions System

> Page-level access control: code-defined pages, the Firestore permission map, and denormalized resolution. This is **tier 2** of the three authorization tiers — tiers 1 and 3 and the API-guard mechanics live in [auth.md](auth.md).

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/definitions.ts` | **Code-defined** page list (source of truth for what pages exist) |
| `src/lib/services/pageService.ts` | Page permission resolution (server) |
| `src/lib/services/permissionResolver.ts` | Resolves groups/users → `permittedPageIds` |
| `src/lib/permissionsCache.ts` | Client localStorage cache (no TTL) |
| `src/hooks/usePermissions.ts` | Client permission hook |
| `src/lib/middleware/apiHelpers.ts` | `checkPageAccess(uid, pageId)` |
| `src/app/api/admin/pages/route.ts` | GET permission map (gated by `'sharing'` page permission) |
| `src/app/api/admin/pages/[pageId]/permissions/route.ts` | PUT permission map (**requires admin claim**) |
| `src/app/api/permissions/pages/route.ts` | Page permission read for the client |

## Firestore

- `page-permissions/{pageId}` — maps each page to allowed **groups** and **users**.
- `users/{uid}.permittedPageIds` — **denormalized** resolved access, for fast sidebar rendering.

---

## Model

```
definitions.ts (pages exist here, NOT Firestore)
        │
        ▼
page-permissions/{pageId}  ── groups[] + users[] allowed
        │  resolved by permissionResolver.ts / pageService.ts
        ▼
users/{uid}.permittedPageIds   ── denormalized, read by sidebar + checkPageAccess
```

- **Pages are code-defined** in `src/lib/definitions.ts`, not stored in Firestore.
- `page-permissions/{pageId}` maps each page → allowed groups/users.
- Resolved access is **denormalized** onto `users/{uid}.permittedPageIds` for fast sidebar rendering.
- Client caches permissions in **localStorage** via `permissionsCache.ts` (**no TTL**).

---

## Relationship to the 3 authorization tiers

Page permission is **tier 2** (see [auth.md](auth.md#authorization-tiers-least--most-privileged)). Some actions **cannot** be granted through page sharing and require the `token.admin` JWT claim (tier 3):
- Admin group membership writes
- `isActive` changes
- The page-permission map itself

### The read/write asymmetry (intentional)
- **GET** `/api/admin/pages` — gated by the `'sharing'` **page permission**.
- **PUT** `/api/admin/pages/[pageId]/permissions` — requires the **admin claim**.

**Why:** the permission map is the root of all other authorization decisions. If write were gated only by `'sharing'`, any user with `'sharing'` could grant themselves any other page and chain into account-level changes.

---

## Drift repair: `src/scripts/repair-permissions.js`

`users/{uid}.permittedPageIds` is denormalized, so it can drift from what `page-permissions` actually says. The symptom is always the same: **the Sharing page shows a page as shared, but it is absent from the sidebar** — Sharing reads `page-permissions`, the sidebar reads `permittedPageIds`.

```bash
cd src
node scripts/repair-permissions.js        # dry run — audit only, read-only
node scripts/repair-permissions.js --fix  # batch-write corrections
```

**`--fix` is a wholesale overwrite, not a merge.** It writes `permittedPageIds: expected` over the whole array, so any page the script does not know about is classified `EXTRA` and deleted from every user in one batch. It bumps `permissionsVersion` too, so clients pick the change up immediately via the `users/{uid}` snapshot.

That made it dangerous while it carried a **hardcoded mirror of `PAGES`**. The copy went stale by 8 pages (the whole SMM teamspace, plus `apps-resources`, `apps-ofmanager`, `apps-model-submissions`, `apps-prompt-library`, `admin-resource-management`) and a `--fix` run stripped all 8 from all 24 users. Two guards now prevent a repeat, and **neither may be removed**:

- The page list is **parsed out of `src/lib/definitions.ts` at runtime** (`loadPagesFromDefinitions()`), never restated in the script. It exits non-zero if the file is missing or parses to 0 pages.
- A `page-permissions` doc whose `pageId` the script does not recognise is a **hard abort**, not a warning — that condition means the parsed list is incomplete and `--fix` would delete real grants.

**Adding a page to `definitions.ts` is all that is required** — the script follows automatically. Do not add a page list back into it.

## Universal pages (outside the permission system)

Some pages are org-wide, like Home: **every** authenticated employee reaches them and there is nothing for an admin to grant. Those live in `UNIVERSAL_PAGES` in `src/lib/definitions.ts` and are deliberately **not** in `PAGES`.

Not being in `PAGES` *is* the mechanism, and it cascades everywhere on its own:

| | Effect |
|---|---|
| `page-permissions/{pageId}` | none exists — nothing to resolve |
| `users/{uid}.permittedPageIds` | never contains it |
| `/admin-portal/sharing` | no row (the route returns `pages: PAGES`) |
| Sidebar | rendered from `UNIVERSAL_PAGES` next to Home, unconditionally |
| `AppLayout` route guard | href is added to `ALWAYS_ACCESSIBLE`, or every user would be bounced to `/` |

Current members: **Resources** (`/applications/apps-resources`), moved out of the Apps teamspace on 2026-08-26.

**A page moving in either direction leaves orphans.** Removing one from `PAGES` strands its `page-permissions` doc and every `permittedPageIds` entry — and a stranded `page-permissions` doc makes `repair-permissions.js` **hard-abort**, so the drift-repair tool stops working entirely until it is cleaned up. `src/scripts/remove-retired-pages.js` does that cleanup (dry run by default; it refuses to touch any pageId `definitions.ts` still declares).

Access is still real for a universal page — it is just enforced by the page's own data layer rather than by page permission. Resources filters its contents by group inside `/api/resources`; see [resources.md](resources.md).

## Rules for new pages

- Add the page to `src/lib/definitions.ts` (that's what makes it exist) — `PAGES` for a permissioned page, `UNIVERSAL_PAGES` for an org-wide one.
- Gate its route with `checkPageAccess(token.uid, '<pageId>')` (tier 2) unless it's general reference data (tier 1) or auth-graph/account-state (tier 3).
- The sidebar renders from `users/{uid}.permittedPageIds` — no extra client wiring needed once resolution runs.
