# Notion Resources Integration

> The `/applications/apps-resources` page lists documents from a single Notion database. Server-cached, group-filtered, client-cached.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/lib/services/notionService.ts` | Wraps `@notionhq/client`; `getActiveDocuments()`, `getDocumentTypes()` |
| `src/app/api/resources/route.ts` | Returns documents (applies group filter) |
| `src/app/api/resources/types/route.ts` | Returns document types |
| `src/hooks/useResources.ts` | Client cache (sessionStorage, 5 min, key `bluu_resources_v1`) |
| `src/hooks/usePinnedResources.ts` | Pinned-resource state |

## Environment (server-only — never expose to client)

```
NOTION_TOKEN
NOTION_DATABASE_ID
```

---

## Service layer (`notionService.ts`)

Two `unstable_cache`-wrapped exports, both sharing cache tag `notion-resources`:

| Export | Revalidate |
|---|---|
| `getActiveDocuments()` | 5 min |
| `getDocumentTypes()` | 1 hr |

- **RULE:** If a future write path needs to bust both at once, call `revalidateTag('notion-resources')`.

## Expected Notion schema

| Property | Type | Notes |
|---|---|---|
| `Name` | title | |
| `URL` | url (optional) | if empty, the Notion page URL is used |
| `Groups` | multi-select | values **must match** `users.groups` |
| `Type` | multi-select | |
| `Status` | status | only `Active` rows returned; `Unlisted` filtered out at the service |
| `Last Edited Time` | Notion built-in | |

## Group filtering (server-side in `/api/resources`)

- A doc is visible if any of its `Groups` overlap with the caller's `users.groups`.
- **Admins** (`token.admin === true`) **bypass** this filter.
- The page is gated by the standard sidebar `apps-resources` page permission, so **no per-page `permittedPageIds` check runs inside the route**.

## Client cache

`useResources.ts` mirrors the `useCreators` pattern — sessionStorage, 5-min TTL, key `bluu_resources_v1`. See the caching pattern in [data-layer.md](data-layer.md#client-side-data-hooks-srchooks).
