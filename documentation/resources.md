# Resources (app-resources collection)

> The `/applications/apps-resources` page lists documents from the Firestore `app-resources` collection. Group- and user-filtered server-side, client-cached. Managed from `/admin/resource-management`.
>
> Historic note: this data originated in a Notion database and was migrated into Firestore. The `notionPageUrl` / `isNotionPage` fields are retained so a row that references a page (rather than an external link) still resolves to a URL. There is no longer any live Notion API dependency.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/types/resource.ts` | Shared `ResourceDocument` / `ResourceIcon` types (client-safe) |
| `src/lib/services/resourceService.ts` | Server-only Firestore read/write for `app-resources`; 60s in-process cache + `invalidateResourcesCache()` |
| `src/app/api/resources/route.ts` | End-user GET — returns Active docs the caller may see (group overlap OR named in `users[]`) |
| `src/app/api/resources/types/route.ts` | End-user GET — distinct `types` across Active docs |
| `src/app/api/admin/resources/route.ts` | Manager GET (all docs) + POST (create) |
| `src/app/api/admin/resources/[id]/route.ts` | Manager PUT (update) + DELETE |
| `src/hooks/useResources.ts` | End-user client cache (sessionStorage, 5 min, key `bluu_resources_v1`) |
| `src/hooks/useAdminResources.ts` | Management client cache + CRUD (key `bluu_admin_resources_v1`) |
| `src/hooks/usePinnedResources.ts` | Pinned-resource state |
| `src/app/(main)/admin/resource-management/` | Management UI (table, filters, search, create/edit dialogs) |

## Firestore

- **Collection:** `app-resources`. All reads/writes go through the Admin SDK in API routes.
- **Rule:** `match /app-resources/{id} { allow read, write: if false; }` — defence-in-depth; no direct client access. (firestore.rules #19)
- No composite indexes required (single unfiltered `.get()` in the service, filtered in memory).

## Document schema

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `url` | string \| null | External link; when null the row is a page reference |
| `isNotionPage` | boolean | True when there is no external `url` |
| `notionPageUrl` | string | Fallback link for page-reference rows |
| `groups` | string[] | Group ids (`CA`, `SMM`, …) — **must match** `users.groups` |
| `types` | string[] | Free-form type labels |
| `status` | string | `Active` (shown to users) or `Unlisted` (hidden) |
| `users` | string[] | UIDs granted visibility **in addition to** group access |
| `icon` | `{type:'emoji'\|'url', value}` \| null | |
| `lastEditedTime` | string (ISO) | Set server-side on create/update |
| `createdAt` / `updatedAt` | Timestamp | Audit fields |

## Access filtering (server-side in `/api/resources`)

- Only `status === 'Active'` docs are returned.
- A doc is visible if any of its `groups` overlap the caller's `users.groups` **or** the caller's uid is in the doc's `users[]`.
- **Admins** (`token.admin === true` or `admin` group) **bypass** the filter.
- The page is gated by the sidebar `apps-resources` page permission, so no per-page `permittedPageIds` check runs inside the route.

## Management (`/admin/resource-management`)

- Gated by the `admin-resource-management` page permission (also allowed for `token.admin`).
- The three admin API routes all re-check that permission server-side.
- Any write busts the service cache (`invalidateResourcesCache()`) and the client caches (`bluu_admin_resources_v1`, `bluu_resources_v1`, `bluu_resources_types_v1`).
- Group/type/user dropdown options are sourced from `useBasicUsers` (groups + users) and the distinct `types` already present on documents.

## Client cache

`useResources.ts` — sessionStorage, 5-min TTL, key `bluu_resources_v1`. See the caching pattern in [data-layer.md](data-layer.md#client-side-data-hooks-srchooks).
