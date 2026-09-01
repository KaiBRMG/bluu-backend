# Growth Tracking

> The `smm-growth-tracking` page: daily follower history for the managed Facebook pages and X accounts, collected by a nightly Apify scrape and seeded from two months of hand-collected spreadsheets. Replaces a Google Sheet two people were filling in by hand.

## RULE 0 — this subsystem has no relationship to `twitterx-accounts`

Not a shared id, not a join, not a lookup, not a shared normalizer. The accounts tracked here are chosen and managed independently, and [`src/lib/growth/platform.ts`](../src/lib/growth/platform.ts) is deliberately a **separate** identity module from [`src/lib/smm/linkUtils.ts`](../src/lib/smm/linkUtils.ts) — the two answer different questions (`normalizePostLink` identifies a *tweet*; `parseProfileUrl` identifies an *account*). Integrating the two is explicitly deferred; do not pre-empt it by wiring a reference between them.

## RULE 1 — cost is the governing constraint

| Actor | Unit price | Nightly volume | Nightly |
|---|---|---|---|
| `apify/facebook-pages-scraper` | $0.010 / page | 5 pages | $0.050 |
| `apidojo/twitter-user-scraper` | $0.004 / profile URL | 7 profiles | $0.028 |

**≈ $0.078/night, ≈ $2.35/month** at the seed list, linear per account added. Four things hold that line, and each is easy to undo by accident:

1. **The X actor takes `twitterHandles` only.** `getFollowers` / `getFollowing` / `getRetweeters` are the **$0.016-per-query** paths. They are passed explicitly `false` in [`runTwitterScrape`](../src/lib/services/growthTrackingService.ts) as an assertion, not because `false` is the default — "tidying away" those three lines is how a $2/month job silently becomes a $400/month one.
2. **`maxItems` is pinned to the batch size.** The hard ceiling on what one run can bill.
3. **One run per platform per night**, batching every account. Never one run per account.
4. **`MAX_TRACKED_ACCOUNTS` (60) is a circuit breaker.** Past it the cron logs loudly and scrapes nothing, and the add route refuses with an explanation. Raise it deliberately, with the bill in mind — never to clear an error.

**Never call the Apify API by hand** to explore a payload or verify a field name — the same rule as 9b for the OnlyFans provider. Use the actor pages, or ask the user for a payload; write the parse defensively instead (`num()` / `str()` in the service already probe for string-vs-number).

Both actors return extra fields **inside the same billed result**, so these cost nothing additional and are stored and shown: Facebook `likes` / `rating` / `ratingCount`; X `following` / `statusesCount` / `mediaCount` / `favouritesCount` / `isBlueVerified`. Anything needing a *separate* query is out of scope.

## Dependencies / Interacting Files

| Layer | Location |
|---|---|
| Page | `src/app/(main)/smm-portal/growth-tracking/page.tsx` |
| Components | `src/components/growth/*` |
| Cron | `src/app/api/cron/growth-tracking/route.ts` + the entry in `src/vercel.json` |
| API routes | `src/app/api/smm/growth/{accounts,accounts/[id],series}` |
| Service | `src/lib/services/growthTrackingService.ts` (**the only module that calls Apify**) |
| Pure logic | `src/lib/growth/{platform,metrics}.ts` |
| Client hook | `src/hooks/useGrowthTracking.ts` |
| Types | `src/types/firestore.ts` (`GrowthAccount`, `GrowthSeries`, `GrowthSnapshot`) |
| Import script | `src/scripts/import-growth-tracking.js` (`--dry-run`, `--wipe`) |

Registered in `src/lib/definitions.ts` as `smm-growth-tracking` under the `smm-portal` teamspace. **Invisible until an admin shares it** — see [permissions.md](permissions.md). `APIFY_API_KEY` and `CRON_SECRET` must be set in Vercel.

## Firestore

| Path | Purpose |
|---|---|
| `growth-accounts/{platform}_{handleNormalized}` | A tracked account. `isActive` (false = stopped, history kept), `latest`/`previous` denormalized readings, `lastScrapeAt`/`lastScrapeStatus`/`lastScrapeError` |
| `growth-accounts/{id}/series/{YYYY}` | `days: { 'YYYY-MM-DD': { followers, …extras } }` — **one document per account per year** |

Both denied in `firestore.rules` (the subcollection match is explicit — rules don't cascade).

**The document id is deterministic** (`facebook_adamtwinkx`), which is what makes the duplicate check a single `get()` instead of a query and the importer idempotent for free. It is built from `parseProfileUrl` output, so **changing that function changes the identity of every account** — history would be written under ids the app never looks up, and the import would silently appear to do nothing.

### Why a day-keyed map and not a document per day

A full page load is **one collection query plus one `adminDb.getAll()`** — about 24 reads at the seed list, and *flat* as history deepens because a year is a single document. A document per day would be thousands of reads for the same chart (rule 9).

The cost of that choice is paid in `firestore.indexes.json`: **`series.days` is index-exempt** (`"indexes": []`), along with `growth-accounts.latest` and `.previous`. Without the exemption Firestore writes one index entry per recorded calendar day, per write, forever, on documents nothing ever queries. **Deploy with `firebase deploy --only firestore:indexes`.**

## The nightly job

`GET /api/cron/growth-tracking`, scheduled `0 0 * * *` in `src/vercel.json`. Vercel Cron rather than a Cloud Function so it can import the service, the parser and the shared types instead of carrying a second copy in `functions/index.js`.

- `maxDuration = 300`. The actors take 10–30s; `run-sync-get-dataset-items` blocks and returns the items in one call, so there is no polling or run-id bookkeeping.
- `CRON_SECRET` bearer, **fail-closed** when unset. Read via `headers()` — with `cacheComponents` on, a route touching no request-scoped API prerenders and every invocation would receive the build-time 404. Same reasoning as `/api/cron/onlyfans-media-usage`.
- **`Promise.allSettled`, not `all`.** A Facebook outage must not discard X readings already paid for.
- **A failed account keeps its old `latest`.** A night with no reading is a *gap*, which is true; overwriting with 0 would draw a collapse that never happened. A run can also succeed while omitting individual accounts (renamed, private, deleted) — those are stamped `failed` with a reason the manage tab shows.

## Adding an account

`POST /api/smm/growth/accounts` fires **one immediate single-account scrape** (~$0.01) and is all-or-nothing: a URL the actor cannot resolve **writes nothing**. That matters because a typo would otherwise become a document that fails, and bills, every night forever while showing an empty chart. The same scrape doubles as day zero.

**Remove is `isActive: false`, not a delete.** Stopping ends the cost and takes the account off the active roster while keeping every reading, and it is one click to resume. `DELETE` exists but only from the stopped list, behind a confirm that names what it destroys — `recursiveDelete` takes the `series` subtree with it, and the scrapers only ever return *today's* number, so deleted history cannot be re-collected.

**Access is one tier.** `checkGrowthAccess(uid)` = `smm-growth-tracking || smm-admin` for reads *and* writes: anyone holding the page may add and remove (confirmed with the user). Page permission, not the admin JWT claim — these routes touch no part of the auth graph.

## The page

Two tabs: **Overview** and **Manage Accounts**.

**The design problem is scale.** TwinkUniversity sits near 684k followers and Connor near 13k. On a shared linear axis eleven of twelve accounts are a flat line along the bottom, and the chart silently answers "who is biggest". So the default mode is **indexed growth** — every account re-based to 0% at the range start — with **Net change** and **Followers** as the other two. Default range is 30 days.

**The chart is a greyscale field with one highlighted trace.** Twelve coloured lines would be a rainbow on a greyscale console (the "don't map an open-ended label onto N hues" Don't in [DESIGN.md](../DESIGN.md#6-dos-and-donts)) and would degrade further as the roster grows. Every account draws faint white; the account under the cursor — hovered in the chart *or in the leaderboard*, which is therefore also the legend — lifts to Action Blue. Hue marks the current selection and nothing else.

**Gaps are the normal case, and nothing may invent a value for one.** The imported months skip most weekends and a scrape can fail, so: `connectNulls` on every line, `deltaFor` returns `change: null` (rendered `—`) until there are two readings, and a sparkline with one point draws a dashed hairline rather than a flat line implying a measurement. A freshly added account reads "First reading tonight".

**The keyboard travels through the account name, not the row.** A leaderboard row opens a detail sheet, but the button is the name inside the first cell — `role="button"` on a `<tr>` overrides `row` and orphans its cells, taking the sortable headers' column associations with them. It is also where the focus ring lives: a `box-shadow` ring on a `<tr>` is never painted under `border-collapse: collapse`, which Tailwind's preflight sets on every table. The row keeps its own click handler for the mouse.

**Selection in the two segmented controls is inked in-component** (`SEGMENT_ITEM_CLASS` in `growthUi.tsx`). shadcn's `outline` toggle variant paints hover *and* the on-state with `bg-accent` — indistinguishable from each other and ~1.5:1 against the card, under the 3:1 floor for a state indicator — so chart mode and date range take the same filled Action Blue Deep as the page's filter chips. Both controls sit **above** the summary tiles, because they filter the tiles, the chart and the table alike.

**Staleness is roster-wide, not per account** — one page going private is a per-account failure the manage tab reports; *nothing* read for 36h means the job itself stopped, which is the only thing worth a banner. `STALE_AFTER_HOURS` is 36 rather than 24 so one late run does not cry wolf.

## The historical import

`src/scripts/import-growth-tracking.js` reads the two sheets in the repo root and creates both the twelve account documents and their history. Run `--dry-run` first; it prints a reading count and date span per account.

- **The day columns sit at a different offset in each file.** JULY has `1st` at index 4; AUGUST has an extra carry-over column and puts it at 5. Columns are located by **matching the ordinal strings in row 1**, never by a fixed offset. Column 3 is the row label; column 1 is a sheet-computed `GROWTH` summary and is not data.
- **Facebook rows are `<Name> (Followers)`; Twitter rows are a bare handle** whose value *is* the follower count.
- **`TwinkUniversity` appears twice** — an empty Facebook page row and the real Twitter row. Rows are matched inside their platform section (delimited by the `FACEBOOK` / `INSTAGRAM` / `TWITTER` markers in column 0), not by label alone.
- **Blanks and literal zeros are skipped, never written as 0.** They mean "not recorded"; a zero would draw a cliff to the axis.
- **The Facebook `(Engagement)` rows are not imported.** The Apify actor cannot produce that metric, so the series would stop dead the day automation took over and appear to show engagement collapsing. Followers is the only metric that survives the handover.
- **Idempotent**, and a re-run **never clobbers** a `displayName` or `isActive` changed in the UI since — only the history is authoritative. `--wipe` `recursiveDelete`s every account first.
- It carries a **hand-copied mirror of `parseProfileUrl`** (a `.js` script cannot import the TS module). **Keep the two in lockstep.**

Current seed: 453 readings across 12 accounts, 2026-07-03 → 2026-08-31 (Facebook 50 readings each; X 29 each, its section only starting 29 July).
