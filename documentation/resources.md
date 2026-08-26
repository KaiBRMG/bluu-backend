# Resources (app-resources collection)

> `/applications/apps-resources` is **one page for reading and for managing** documents in the Firestore `app-resources` collection. What a viewer may do is decided by their group, not by which page they are on. Server-filtered, client-cached.
>
> It is a **universal page** — org-wide like Home, sitting directly under it in the sidebar, with no page permission and no Sharing row.
>
> Historic note: this data originated in a Notion database and was migrated into Firestore. The `notionPageUrl` / `isNotionPage` fields are retained so a row that references a page (rather than an external link) still resolves to a URL. There is no longer any live Notion API dependency.

**There is no `/admin-portal/resource-management` any more.** It was merged into the app page on 2026-08-26 — the management table *is* the Resources page, with the "New" button, the Status filter and the per-row options menu gated by the access matrix below. Do not reintroduce a second surface for this collection.

## Dependencies / Interacting Files

| File | Role |
|---|---|
| `src/types/resource.ts` | Shared `ResourceDocument` / `ResourceIcon` types (client-safe) |
| **`src/lib/resourceAccess.ts`** | **The access matrix — single source of truth, imported by both the API and the UI** |
| `src/lib/services/resourceService.ts` | Server-only Firestore read/write for `app-resources`; 60s in-process cache + `invalidateResourcesCache()` |
| `src/app/api/resources/route.ts` | GET (everything the caller may see) + POST (create) |
| `src/app/api/resources/[id]/route.ts` | PUT (update) + DELETE |
| `src/hooks/useResources.ts` | Client cache (sessionStorage, 5 min, key `bluu_resources_v2`) **+ CRUD + the caller's permissions** |
| `src/hooks/usePinnedResources.ts` | Pinned-resource state (drives the home-page widget) |
| `src/app/(main)/applications/apps-resources/` | The page: `FilterRail`, `ResourceIndex`, `ResourceFormDialog`, `OptionMultiSelect` |

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
| `groups` | string[] | Group ids (`CA`, `SMM`, …) — **must match** `users.groups`. **Also decides who may edit the row** |
| `types` | string[] | Free-form type labels |
| `status` | string | `Active` (shown to readers) or `Unlisted` (**only ever returned to someone with write access to that resource**) |
| `users` | string[] | UIDs granted visibility **in addition to** group access. Grants read only, never write |
| `icon` | `{type:'emoji'\|'url', value}` \| null | |
| `lastEditedTime` | string (ISO) | Set server-side on create/update |
| `createdAt` / `updatedAt` | Timestamp | Audit fields |

---

## The access matrix (`src/lib/resourceAccess.ts`)

```
group   reads                writes
CA      CA                   —
SMM     SMM                  —
OFAM    CA, SMM, OFAM        CA, SMM
admin   everything           everything
```

A group not named in the matrix (`unassigned`, or any group added later) keeps the pre-merge behaviour: it reads its own group's resources and writes nothing. Multi-group users get the **union** of each row.

`resourceAccess.ts` is deliberately **client-safe** — no server-only imports — so the page gates its controls with the identical functions the route authorises with. **The client copy is cosmetic; the server check is the real one.**

### RULE: writes use the strict subset rule

A non-admin may write a resource only when **every** group on it is inside their writable set:

| `groups` on the doc | OFAM |
|---|---|
| `['CA']`, `['SMM']`, `['CA','SMM']` | may edit |
| `['CA','OFAM']` | read-only |
| `['OFAM']`, `['admin']`, `[]` | read-only |

An untagged resource (`groups: []`) is therefore **admin-only** — there is no scope to check it against. That is why the form dialog marks Groups required for a non-admin manager (`groupsRequired`), and why the group picker only ever offers the caller's writable groups.

On an **update the rule is applied twice** — against the stored groups *and* against the incoming ones. Without the second check a manager could re-tag a resource they legitimately hold (`['CA']` → `['CA','OFAM']`) and keep editing it, escalating their own scope one save at a time.

### Read visibility

- An **Active** resource is visible if any of its `groups` overlap the caller's **readable** set (matrix row, not raw group membership — this is what gives OFAM its CA/SMM reach) **or** the caller's uid is in the doc's `users[]`.
- **RULE: write access is the only thing that reveals an `Unlisted` resource** (`canSeeUnlistedResource`). Read access never does — not group overlap, not an explicit `users[]` grant. So an OFAM user sees Unlisted CA/SMM resources (they manage those) but **not** Unlisted OFAM ones (they only read those). This is how the old management view's status filter survives the merge, and why a manager's `/api/resources` payload differs from a reader's — hence the `bluu_resources_v2` cache-key bump.
- **Admins** (`token.admin === true` or `admin` group) bypass all filtering, at every status.
- **The page has no page permission at all.** As of 2026-08-26 it is a *universal page* (`UNIVERSAL_PAGES` in `definitions.ts`) — org-wide like Home, rendered in the sidebar directly under Home, with no `page-permissions` doc and no row on `/admin-portal/sharing`. See [permissions.md](permissions.md#universal-pages-outside-the-permission-system).
- That makes the group filtering above **the whole authorization story**: every authenticated employee can open the page, and what they see inside it is decided entirely by `/api/resources`. Any future route serving this collection must filter for itself — there is no page gate upstream to lean on.

**`filterVisibleResources` runs on both sides.** The server call is the real gate; `useResources` re-applies it to whatever came back — including a **cache hit** — because `bluu_resources_v2` is not namespaced by uid and nothing clears sessionStorage on logout. Without the second pass, a second user signing in to the same tab could read the first one's Unlisted rows straight out of the cache. The client pass is gated on the user-doc snapshot having *finished loading* (not on `userData` being non-null): filtering against an empty identity would blank the list, and waiting on a doc that resolves to nothing would hang `useBootPhase('home-resources')` forever.

### Showing `Unlisted` without a Status column

Status is **not a column** — it is a property of a handful of rows, not a dimension of the list, and readers can never see a non-Active row anyway. A manager gets the signal inline on the name instead: **muted text plus an `EyeOff` icon** labelled *"Unlisted — hidden from everyone who cannot manage it"*. The Status **facet** in the filter rail stays (managers only); it is the thing that makes Unlisted rows findable in bulk.

---

## The page shape (redesigned 2026-08-26)

The surface was rebuilt as a **faceted index**, replacing a seven-column table under two rows of colour-hashed filter pills. The functionality, the access matrix and every user flow are unchanged; what changed is the shape. Three decisions are load-bearing — treat them as the contract, not as styling:

1. **`FilterRail` carries counts, and the counts are faceted.** Each facet is counted against every *other* active filter, so the number beside a type is how many rows clicking it produces. Computed in `page.tsx` via `matches(doc, filters, …)` called with one facet cleared. If you add a facet, count it the same way — a count that ignores the other filters is a lie that leads users into empty lists. The rail is a permanent column at `lg` and up (the Electron window always is) and folds into a `Popover` below it.
2. **`ResourceIndex` sorts pinned-first, then A–Z, with letter section rails.** Not by `lastEditedTime` — this is a link directory, and a known name is found by position. This is also what makes the pin meaningful: pinning **promotes a row into the Pinned section** rather than lighting an icon in a column. Letter rails are suppressed while a search is running (`grouped={false}`), and in that mode the row shows an inline pin mark instead, because the section is not there to carry the state.
3. **Colour is gone from types.** `typeColors.ts` hashed each free-form type string to one of ten hues — decoration, and a direct violation of DESIGN §2's Semantic-Only Rule. Types are greyscale chips; the rail is the type navigator. **Do not reintroduce a per-type palette.** The only saturated pixels on the page are the Action Blue pin/selection/focus and the Action Blue Deep primary buttons, both inked in-component because shadcn's `--primary` resolves to near-white in this theme.

Row mechanics worth knowing before editing `ResourceIndex`: the whole row is one link (the name and the URL used to be two targets for one destination); the meta line shows the link's **host**, not a truncated URL; and the type chips and the pin/copy/manage cluster **crossfade in the same lane** on `:hover` *and* `:focus-within` — dropping the focus half makes the actions keyboard-unreachable.

---

## API

| Route | Who |
|---|---|
| `GET /api/resources` | Any authenticated employee; the response is filtered per the matrix |
| `POST /api/resources` | Caller must be able to write every group in the payload |
| `PUT /api/resources/[id]` | Caller must be able to write the stored groups **and** the incoming ones |
| `DELETE /api/resources/[id]` | Caller must be able to write the stored groups |

`updateResource` / `deleteResource` take an **`authorize` predicate** and run it against the live document inside the same read they already did — so the check never runs on the 60s service cache, and a write costs no extra Firestore read.

There is no `/api/admin/resources/*` and no `/api/resources/types`. Types are derived client-side in `useResources` from the documents the caller can see, which is both cheaper (one round trip instead of two) and more correct (the filter offers only types that are actually present in their list).

## Client cache

`useResources.ts` — sessionStorage, 5-min TTL, key `bluu_resources_v2`. Every write calls `refresh()`, which invalidates the key and refetches, so the list always reflects what the server stored. See the caching pattern in [data-layer.md](data-layer.md#client-side-data-hooks-srchooks).

`useBasicUsers(enabled)` takes an **`enabled` flag** here: the user/group lists feed only the management dialog, so readers never pay for that fetch.
