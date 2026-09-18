# Fast Origin Transfer — remediation plan

**Prompt**: Implement Phase 1. Ensure you make safe changes, with riskier changes checked properly first. Do not make assumptions -- read relevant documentation first. Errors should be minimised.

**Status of this document.** Fixes 1–3 of the audit are **implemented** (see "Already shipped" below). This file is the plan for fixes 4–10, in the order they should be done. The measurement, the root-cause analysis and the standing rule that came out of this work live in [`CLAUDE.md`](CLAUDE.md) — the "Known Issues: Vercel Fast Origin Transfer" section and cross-cutting **rule 9i**. Read those first; this file assumes them and does not repeat them.

**The one-line version.** Fast Origin Transfer is this project's most expensive Vercel metric, and the cause is not load. Production telemetry (24h, 2026-09-18) showed **60,922 middleware invocations, 61,354 Data Cache reads and only 4,924 function invocations** across roughly **8 open windows** — about **7,600 page requests per window per day**, ~5 a minute, continuously, while nobody was clicking. The top three paths were pages, not APIs.

---

## Already shipped (fixes 1–3)

| # | Change | Files |
|---|---|---|
| 1 | **`prefetch={false}` on every sidebar link.** Next prefetches all in-viewport `<Link>`s; the sidebar renders every page a user can reach, so the default prefetched ~25 routes per shell mount — and `AppLayout` remounts on every navigation, so it did that again on every click. | [`Sidebar.tsx`](src/components/Sidebar.tsx) (4 links) |
| 2 | **Middleware no longer runs on RSC requests.** The matcher became an object with `missing: [{ type: 'header', key: 'RSC' }]`. It was running on all ~61k requests/day to compare one user-agent string, and middleware is billed on both request and response. Safe because an RSC request can only come from a client whose document request already passed through the gate, and because the middleware is a UX gate, not an authorization boundary (rule 10 unaffected). | [`middleware.ts`](src/middleware.ts) |
| 3 | **`/api/announcements` is no longer a poll.** `AnnouncementCard` keyed its load effect on `[userData]`, an `onSnapshot` object; `POST /api/user/presence` stamps `lastActiveAt` every 10 minutes, so the effect refired on that cadence — ~1,165 calls/day against a config that cannot change without a deploy. Now latched per-uid; the clock-out re-arm still calls `load()` directly. | [`AnnouncementCard.tsx`](src/components/announcements/AnnouncementCard.tsx) |

**Verify these before starting anything below.** Give it 24–48h and re-read the usage chart. The expected shape is a large fall in Edge Requests and middleware invocations, and a smaller but real fall in FOT. If the numbers do not move, stop and re-measure rather than continuing down this list — everything below is sized against the assumption that the prefetch treadmill was the driver.

```
# The three groupings that produced the original diagnosis, for the re-read:
#   runtime logs, production, 24h, group_by source        → middleware / cache / function
#   runtime logs, production, 24h, group_by statusCode    → 304 vs 200 split
#   runtime logs, production, 24h, group_by requestPath   → pages vs APIs
```

---

## Phase 1 — finish the cheap work ✅ DONE (2026-09-18)

### Fix 4 · `Cache-Control` on cohort-static routes ✅

**Problem.** 149 of 155 API routes sent no `Cache-Control` at all, so every call was an unconditional origin round trip.

**The plan's suggested header was unsound and was not used.** `private, s-maxage=300, stale-while-revalidate=3600` cannot work: `private` is the directive that forbids a *shared* cache from storing the response, and `s-maxage`/`stale-while-revalidate` are directives only a shared cache reads. The two cancel out — the combination caches nowhere. Vercel's docs confirm the shape they publish for authenticated content is `private` + the **browser** cache, not `s-maxage`. So on a `withAuth` route the only real lever is `private, max-age=…` plus `Vary: Authorization`.

Checking each of the three against what the code actually does also showed that **two of them must not be cached at all**, for reasons already written into their own header comments:

| Route | Shipped | Why |
|---|---|---|
| [`/api/permissions/pages`](src/app/api/permissions/pages/route.ts) | **`private, max-age=60` + `Vary: Authorization`** | The only real win of the three. `AppLayout` mounts per page, so `usePermissions` re-fetches this on **every navigation** — the 60s window collapses that burst. Zero new staleness: `permissionsCache.ts` already serves the same payload from localStorage for **4 hours**, and a permission *change* never arrives on this route — it is pushed down the `users/{uid}` snapshot as `permittedPageIds`. `Vary` is load-bearing: the browser cache keys on URL alone and `clearPermissionsCache()` clears localStorage on sign-out, not the HTTP cache. Only the 200 carries it; 404/500 stay uncached. |
| [`/api/app-update`](src/app/api/app-update/route.ts) | **`no-store` (unchanged) + documented** | Already correct. A `compulsory` entry decides whether a user can open the app; a cached "no update" strands the fleet on a broken build and a cached stale one blocks users against a pulled release. `fetchAppUpdateConfig` sends `cache: 'no-store'` client-side for the same reason. Comment now says "do not add a cache header to this route" so a future sweep does not undo it. |
| [`/api/announcements`](src/app/api/announcements/route.ts) | **`no-store` added + documented** | Sent no header at all. Cannot be shared-cached (cohort match + this user's dismissals — rule 10), and caching it defeats its only purpose (rule 9c: a week-old renderer must learn an announcement was armed). Volume is gone anyway after fix 3 — a few calls per session, not a poll. The header is now a defence against an intermediary, not a perf change. |

**Also done:** [`/api/admin/pages`](src/app/api/admin/pages/route.ts) gained a cacheability note while being touched for fix 5 — it is the live authorization map an admin is editing, so it is uncacheable and `useAdminData`'s own 5-minute in-memory TTL is the right layer.

### Fix 5 · Drop the dead payload on the admin data hook ✅

**Chose "stop fetching", not "render them"** — the plan says do one or the other, and the blast-radius confirm is a feature, not an optimization.

Verified unused before removing: `getAllGroups()` has five callers so the **service was left alone** and the projection was done in the route; `PermissionTable`'s own local `AdminGroup` already omitted `members`; `photoURL` was declared optional in both sharing components and no `Avatar` is rendered anywhere in that folder; `UserDetailContent`, the only other consumer, destructures just `pagePermissions` and `updatePermission`.

- [`admin/pages/route.ts`](src/app/api/admin/pages/route.ts) — `groups` projected to `{id, name, level}` (was whole docs: `members`, `description`, `isDefault`, `createdAt`); `photoURL` dropped from the users `.select()`.
- [`useAdminData.ts`](src/hooks/useAdminData.ts) — `AdminUser.photoURL` and `AdminGroup.members` removed; the types now mirror the projection exactly.
- `PermissionTable.tsx`, `EffectivePermissionsPreview.tsx` — dead `photoURL?: string` removed.

**Left for later, deliberately:** `memberCount: number` as the blast-radius input. Item 8 in CLAUDE.md now records that as the open half.

**Verification.** `tsc --noEmit` clean; `next build` clean; `eslint` clean on all seven touched files (one pre-existing unused-import warning in `permissions/pages/route.ts`, confirmed present before the change by stashing).

**Not done — the opportunistic sweep.** Rule 9i's "a route touched for any other reason gets a header or a comment" stands for the remaining ~147.

---

## Phase 2 — the bytes

### Fix 6 · Stop relaying screenshots through a Vercel Function ⭐

**This is the largest byte-volume win available, and it is independent of everything else in this document.**

**Problem.** `POST /api/time-tracking/screenshots/upload` runs **874×/day**. Each request body is *N* full-resolution PNGs encoded as base64 inside a JSON payload — base64 is a flat 33% inflation — and the function's entire job is to decode them and hand the buffer to Cloud Storage. Every one of those megabytes is billed as incoming Fast Origin Transfer to move bytes that never needed to touch Vercel.

**Do.** Invert it to a signed-slot upload. **The pattern already exists in this repo and should be copied, not reinvented:** [`/api/onlyfans/media/upload-url`](src/app/api/onlyfans/media/upload-url/route.ts) signs a write slot, the renderer PUTs straight to the bucket, and [`/api/onlyfans/media/upload`](src/app/api/onlyfans/media/upload/route.ts) then acts on the object by path.

1. `POST /api/time-tracking/screenshots/upload-url` → authorize (`withAuth` + the existing `enableScreenshots` check), derive the storage path server-side, return *N* signed PUT URLs.
2. The renderer PUTs each capture directly to Cloud Storage.
3. `POST /api/time-tracking/screenshots/commit` → re-derive and validate the paths against this caller's own prefix (the OF route's "the path is re-derived, never trusted" check is the model), then write the Firestore docs and call `updateActivityPercent`.

**Carry these across from the current implementation, they are load-bearing:**
- The `enableScreenshots` gate must stay on the *slot-signing* call, not only on commit — signing first and checking later hands out write capability to a user who has screenshots disabled.
- The path must remain server-derived (`screenshots/{uid}/{date}/{ts}_{i}.png`). Never accept a client-supplied path.
- Signed URLs get a short TTL (the OF route uses 10 min) and are single-use in practice.
- `captureGroup` must still tie the *N* screens of one capture together, and `screenIndex` must survive — the thumbnail Cloud Function and the timesheet UI both read them.
- Failure handling in [`TimeTrackingContext.tsx:1057`](src/contexts/TimeTrackingContext.tsx) distinguishes `capture-failed` from `capture-upload-failed`, and the macOS TCC repair hangs off the first one. A direct PUT introduces a *third* failure mode (slot signed, PUT rejected) that must map to `capture-upload-failed`, not to `capture-failed`, or it will fire spurious `tccutil reset`s.

**Then, separately:** capture WebP or JPEG rather than PNG. A screenshot is a photographic-ish raster and PNG is the worst possible choice for it — this is an independent multi-× saving on Cloud Storage cost and on the thumbnail function's work, and it stacks with the above. Requires an `electron/` change, so it is subject to **rule 14's two-push release dance**; the signed-URL work above is renderer + API only and ships as a plain Vercel deploy.

**Expected effect.** The screenshot contribution to FOT goes to approximately zero (only the small JSON of the sign and commit calls remains).

### Fix 7 · Raise `staleTimes.dynamic`

**Problem.** It is set to `30` in [`next.config.ts`](src/next.config.ts). That value was chosen to fix the navigation hang — it is the pre-Next-15 default, not a tuned number. At 30s, a prefetched entry expires and any link still in the viewport is re-prefetched, which is the idle drip.

**Do.** Raise to `300`. Note that **fix 1 already removed most of the exposure** — with `prefetch={false}` on the sidebar there are far fewer in-viewport links to re-prefetch — so do this *after* measuring fix 1, and expect a smaller delta than the original audit implied.

**Cost.** Back/forward may show data up to 5 minutes old. Nothing here depends on that: every page loads its own data client-side on mount. **Do not lower it below 30** under any circumstances — that is what caused the navigation hang documented in CLAUDE.md.

### Fix 8 · Collapse the two config-gate endpoints

**Problem.** `/api/announcements` and `/api/app-update` are the same shape — a per-cohort config gate, read over HTTP because of rule 9c — fetched independently by two components.

**Do.** One `/api/client-config` returning both, CDN-cached per cohort (fix 4 applies to it). Halves the round trips and gives rule 9c a single documented home.

**Lower priority than it looks** now that fix 3 has stopped the announcements poll — this is now tens of calls a day, not thousands. Do it for the tidiness, not the bill.

---

## Phase 3 — architectural

### Fix 9 · Hoist `AppLayout` into `(main)/layout.tsx` ⭐

**This is the one that matters most, and it was already on the books for a different reason.**

**Problem.** `AppLayout` is imported by ~27 page files instead of living in the layout, so every navigation renders a complete fresh `SidebarProvider` + `Sidebar` + `TopBar` + `usePermissions` tree on top of the destination page. It is issue 1 in the "sidebar navigation hangs" known-issues table in CLAUDE.md, where it is described as "the single biggest available navigation speed-up". This audit added the second justification: the remount is what re-issued the sidebar's entire prefetch burst on every click.

**Do.** Move it into [`(main)/layout.tsx`](src/app/\(main\)/layout.tsx) so a navigation swaps only the page body.

**Notes.**
- Touches every page file under `(main)/`. Mechanical but wide — it is its own commit, with nothing else in it.
- It also removes the module-scope `savedScrollTop` hack at [`Sidebar.tsx:38`](src/components/Sidebar.tsx#L38), which exists purely to paper over the remount. Delete it in the same change; leaving it behind is a trap for the next reader.
- Mind the ordering against the existing layout: `NavigationWatchdog`, `DeepLinkRouter`, `NavigationProgress` and `CreatorRosterPrefetch` are deliberately *outside* `LazyProviders`, and the comments in `layout.tsx` explain why for each. Do not disturb that arrangement while inserting `AppLayout`.
- The `ALWAYS_ACCESSIBLE` route guard inside `AppLayout` currently runs per page mount. Once hoisted it runs once and then on pathname change — confirm the redirect still fires on a navigation into an inaccessible page, because that is a real authorization-adjacent behaviour (though not the boundary itself; the server checks stand on their own).
- **Even after fix 1, this is worth doing.** `prefetch={false}` stopped the prefetch storm; the remount still costs a full shell render per navigation, which is the hang.

### Fix 10 · Re-evaluate `cacheComponents: true`

**Highest ceiling, highest risk. Do not bundle this with anything else.**

**Problem.** 44 of 50 pages are `"use client"` with no server-side data fetching — their RSC payloads are byte-identical for the life of a deployment. `cacheComponents: true` routes each of those through the Vercel Data Cache, and Data Cache transfer is billed as FOT. That is what the 61,354 `cache` events a day were.

**Do.** Investigate whether those routes can be emitted as fully static output the CDN serves outright, with no Data Cache hop.

**Why this is last.**
- It interacts with `staleTimes` (fix 7), with the navigation hang, and with the `<Suspense>` boundaries in `(main)/layout.tsx` that the comments there describe as required rather than decorative — `NavigationProgress` and `CreatorRosterPrefetch` subscribe to external stores, which Cache Components treats as uncached dynamic data, and prerendering fails outright without a boundary to stream into.
- The prerender manifest already lists 53 static routes, so some of this benefit may already be realised and the remaining Data Cache traffic may be smaller than the raw event count suggests. **Measure what a single page navigation actually costs before rewriting anything.**
- Changing it is a global rendering-behaviour change on an app whose renderer may be weeks old (rule 9c).

---

## Sequencing

```
✅ 1 · sidebar prefetch={false}        shipped
✅ 2 · middleware skips RSC             shipped
✅ 3 · announcements latch              shipped
   ─── measure for 24–48h, re-read the usage chart ───
✅ 4 · Cache-Control on 3 hot routes    shipped (1 cached, 2 documented as uncacheable)
✅ 5 · drop dead admin payload          shipped
   6 · screenshots → signed URL     ⭐  the byte win, independent of all others
   7 · staleTimes 30 → 300              after measuring 1
   8 · merge the two config gates       tidiness now, not bill
   9 · hoist AppLayout              ⭐  fixes the hang AND the spend; own commit
  10 · re-evaluate cacheComponents      experiment, measure first, last
```

**If you only do two more things: 6 and 9.** Fix 6 removes the bytes; fix 9 removes the requests and fixes a user-visible bug that has been open long enough to have its own section in CLAUDE.md.

---

## What not to do

- **Do not lower `staleTimes.dynamic` below 30.** It is what stops the navigation hang.
- **Do not cache a `withAuth` response in a shared cache.** Per-user responses need `private` **and** `Vary: Authorization` — and note that `private` makes `s-maxage` inert, so the browser cache (`max-age`) is the only lever available on such a route. A cost optimization that leaks one employee's data to another is not an optimization (rule 10).
- **Do not remove `NavigationWatchdog`** as part of any of this. It is the only thing that rescues a user already stuck mid-shift, and its Sentry events are the signal for whether fix 9 actually worked.
- **Do not add `prefetch={false}` reflexively to every link in the app.** The rule is about persistent chrome and long lists. A single call-to-action a user is about to click should still prefetch.
