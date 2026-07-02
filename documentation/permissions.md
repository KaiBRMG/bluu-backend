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

## Rules for new pages

- Add the page to `src/lib/definitions.ts` (that's what makes it exist).
- Gate its route with `checkPageAccess(token.uid, '<pageId>')` (tier 2) unless it's general reference data (tier 1) or auth-graph/account-state (tier 3).
- The sidebar renders from `users/{uid}.permittedPageIds` — no extra client wiring needed once resolution runs.
