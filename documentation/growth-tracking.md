# Growth Tracking

> The `smm-growth-tracking` page: daily follower history for the managed Facebook pages and X accounts, collected by a nightly Apify scrape and seeded from two months of hand-collected spreadsheets. Replaces a Google Sheet two people were filling in by hand.

## RULE 0 — this subsystem has no relationship to `twitterx-accounts`

Not a shared id, not a join, not a lookup, not a shared normalizer. The accounts tracked here are chosen and managed independently, and [`src/lib/growth/platform.ts`](../src/lib/growth/platform.ts) is deliberately a **separate** identity module from [`src/lib/smm/linkUtils.ts`](../src/lib/smm/linkUtils.ts) — the two answer different questions (`normalizePostLink` identifies a *tweet*; `parseProfileUrl` identifies an *account*). Integrating the two is explicitly deferred; do not pre-empt it by wiring a reference between them.

## RULE 1 — cost is the governing constraint

| Actor | Unit price | Nightly volume | Nightly |
|---|---|---|---|
| `apify/facebook-pages-scraper` | $0.010 / page | 5 pages | $0.050 |
| `apidojo/twitter-user-scraper` | $0.004 / profile URL | 7 profiles | $0.028 |
| `kaitoeasyapi/twitter-x-data-tweet-scraper-…-cheapest` | **$0.00025 / result** | see [post analytics](#post-analytics) | ~$0.03–0.10 |

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
| Cron | `src/app/api/cron/growth-posts/route.ts` — the post refresh cycle, `0 */6 * * *` |
| API routes | `src/app/api/smm/growth/{accounts,accounts/[id],series}` |
| API routes | `src/app/api/smm/growth/posts`, `posts/[tweetId]`, `posts/[tweetId]/sync` |
| Service | `src/lib/services/growthTrackingService.ts` (follower scrape; owns the two profile actors) |
| Service | `src/lib/services/growthPostsService.ts` (**the only module that calls the tweet actor**) |
| Pure logic | `src/lib/growth/{platform,metrics,postLink,postMetrics}.ts` |
| Client hook | `src/hooks/useGrowthTracking.ts` |
| Client hook | `src/hooks/useGrowthPosts.ts` |
| Types | `src/types/firestore.ts` (`GrowthAccount`, `GrowthSeries`, `GrowthSnapshot`, `GrowthPost`, `GrowthPostSnapshot`, `GrowthSpendLedger`) |
| Import script | `src/scripts/import-growth-tracking.js` (`--dry-run`, `--wipe`) |

Registered in `src/lib/definitions.ts` as `smm-growth-tracking` under the `smm-portal` teamspace. **Invisible until an admin shares it** — see [permissions.md](permissions.md). `APIFY_API_KEY` and `CRON_SECRET` must be set in Vercel.

## Firestore

| Path | Purpose |
|---|---|
| `growth-accounts/{platform}_{handleNormalized}` | A tracked account. `isActive` (false = stopped, history kept), `latest`/`previous` denormalized readings, `lastScrapeAt`/`lastScrapeStatus`/`lastScrapeError` |
| `growth-accounts/{id}/series/{YYYY}` | `days: { 'YYYY-MM-DD': { followers, …extras } }` — **one document per account per year** |
| `growth-posts/{tweetId}` | One tracked X post: metadata, `latest`/`previous`, and `history: { 'YYYY-MM-DDTHH:mm': {…} }` — readings live **on the document**, no subcollection |
| `growth-spend/{YYYY-MM}` | The rolling cost ledger the refresh breaker reads: `results`, `usd`, `runs` |

Both denied in `firestore.rules` (the subcollection match is explicit — rules don't cascade).

**The document id is deterministic** (`facebook_adamtwinkx`), which is what makes the duplicate check a single `get()` instead of a query and the importer idempotent for free. It is built from `parseProfileUrl` output, so **changing that function changes the identity of every account** — history would be written under ids the app never looks up, and the import would silently appear to do nothing.

**An account is named by its `handle` and nothing else.** There is no display name: every surface renders the handle, sorting is by handle, and the avatar fallback is seeded from it. DESIGN.md's Avatar Seed Rule names `displayName` because that is the field on a `users` doc; what it protects is that one account hashes to one colour everywhere, and here the handle is the stable identity. Consequently `PATCH` accepts **only `isActive`** — platform, handle and profile URL are the document id, so changing one would orphan the history rather than move it. Documents created before this may still carry a stray `displayName` field; nothing reads it.

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
- **Idempotent**, and a re-run **never clobbers** an `isActive` flag changed in the UI since — only the history is authoritative. `--wipe` `recursiveDelete`s every account first.
- It carries a **hand-copied mirror of `parseProfileUrl`** (a `.js` script cannot import the TS module). **Keep the two in lockstep.**

Current seed: 453 readings across 12 accounts, 2026-07-03 → 2026-08-31 (Facebook 50 readings each; X 29 each, its section only starting 29 July).

---

## Post analytics

> Individual X post engagement, layered on top of the follower scrape without
> touching it. The follower job keeps its own actors, its own cadence and its own
> cost line; nothing below changes what it does or what it spends.

**The main entry point is a pasted link.** Someone drops an X post URL into the
Posts tab and that post is tracked from that moment. The per-account **Track
posts** toggle is the secondary path: it turns on a nightly discovery pass that
finds that account's newest posts and starts tracking them automatically.

### RULE 1 — `maxItems` does NOT cap this actor's bill

`kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest` bills **per
returned result** ($0.25/1,000 — the store page advertises $0.18; plan on the
worse). Its `maxItems` has a **minimum of 20** and "defines the minimum number of
items to return, not a strict limit" — results may exceed it.

**This is the exact opposite of `apidojo/twitter-user-scraper`**, where RULE 1.2
above leans on `maxItems` as the hard billing ceiling. Do not carry that
assumption across; it is the single most likely way this feature overspends. The
bill here is capped by **input size** — `searchTerms.length` and
`tweetIDs.length` — and by the three breakers below.

### RULE 2 — two call shapes, and the difference between them is the design

| Shape | Input | Bills | Job |
|---|---|---|---|
| **Search** | `searchTerms: ["from:handle", …]`, `queryType: "Latest"` | 20 per term | **Discovery** — finding posts that exist |
| **Id lookup** | `tweetIDs: [...]` | one per id, floor 20 | **Refresh** — re-reading known posts |

The load-bearing consequence: **a discovery result is also a full reading.** The
engagement numbers ride inside the same billed result as the post text, so a post
inside an account's newest-20 window is refreshed by the discovery pass **for
free** and must never also be sent to the id batch. Recording any reading
advances `nextRefreshAt`, which is what makes that automatic — and the cron
excludes ids discovery just touched.

### RULE 3 — never send a batch under 20, never pad past what is due

The 20-result floor is billed whatever the batch size, so a 6-id refresh costs
exactly what a 20-id refresh costs. Every short batch is therefore **padded with
the stalest tracked posts** — the extra readings are free, and declining them
saves nothing. `stalestPostsForPadding` is that rule; it is why adding a post or
hitting Sync also refreshes nineteen others.

The converse is equally binding: never pad *past* what is due. Every id beyond
the floor is real money spent on a number nobody asked for.

### RULE 4 — zero-result runs return MOCK DATA and are still billed

The vendor documents this: a run that finds nothing is filled with plausible
placeholder rows to cover their infrastructure floor. **Every returned item is
reconciled against what was requested** — by id for a lookup, by author handle
for a discovery — and anything unmatched is dropped and logged, never stored.

Without that reconciliation this feature writes invented engagement numbers into
Firestore, on a page whose governing rule is that nothing may invent a value. It
is a data-integrity hazard before it is a cost one.

### RULE 5 — the manual sync cooldown is server-side

`lastManualSyncAt` on the post document, enforced in
`POST /api/smm/growth/posts/[tweetId]/sync`, 429 with the remaining wait. A
client-side timer is a suggestion anyone can skip from a devtools console, and
every skip spends money (cross-cutting rule 10).

### RULE 6 — three circuit breakers, because one is not enough

| Breaker | Bounds | Where |
|---|---|---|
| `MAX_TRACKED_POSTS` (300) | the roster | add route **and** discovery creation |
| `MAX_REFRESH_PER_RUN` (200) | one cycle | `selectPostsForRefresh` |
| `MONTHLY_SPEND_CEILING_USD` (15) | **the money** | `growth-spend/{YYYY-MM}`, checked first in every spending path |

The ledger is the only one that catches volume nobody chose: post *volume*, not
post count, drives this bill, and a tracked account going viral passes every
count-based check while multiplying it.

### RULE 7 — the post-link parser stays independent of SMM

`src/lib/growth/postLink.ts` duplicates what `normalizePostLink` in
`src/lib/smm/linkUtils.ts` does. **That duplication is the point** — RULE 0 above
forbids a relationship between the two subsystems, and a shared normalizer is
exactly such a relationship: the SMM one could then never change without
silently re-identifying every tracked post here.

### The refresh ladder

`REFRESH_TIERS` in `postMetrics.ts` — **this ladder is the bill.** Cost is per
reading, so halving an interval doubles the spend for that band.

| Post age | Re-read every | State |
|---|---|---|
| < 24h | 6h | `live` |
| < 3d | 12h | `hourly` |
| < 7d | 24h | `daily` |
| < 30d | 7d | `weekly` |
| ≥ 30d | never | `frozen` |

About **15 readings ≈ $0.004 over a post's whole life.** A frozen post's
`nextRefreshAt` is a year-9999 sentinel, **not `null`** — a null sorts before
every timestamp in Firestore, so it would make frozen posts the first thing every
"what is due?" query returned.

The cron fires every 6 hours but **spends only what the ladder says**: a run with
nothing due makes no scraper call at all. Changing the cron schedule changes
latency, not cost.

### Follower counts from a post payload

Every tweet result carries `author.followers` free, and the refresh cycle runs
four times a day against a profile scrape that runs once. For a tracked X account
with tracked posts, that is the **fresher** number at no additional cost, so
`applyAuthorFollowers` writes it through to `growth-accounts/{id}.latest` and to
that day’s entry in the follower series.

**The profile scrape is NOT replaced, and must not be.** It is the only
guaranteed daily reading — it covers Facebook, X accounts with post tracking off,
accounts that posted nothing, and nights the tweet actor fails. Making it
conditional on post tracking would mean one bad tweet run leaves a permanent hole
in a series that cannot be re-collected, to save $0.028/night. Keep both.

**Within a day, the last write wins.** A day’s recorded figure for such an
account therefore becomes the final refresh of that day rather than the 00:00
profile reading — a fuller day of growth, and internally consistent per account,
which is all a day-over-day delta needs. `previous` still shifts only on a real
day change, exactly as `recordSnapshots` does it.

Three guards, because this writes into the subsystem’s primary dataset:

1. **Only tracked X accounts.** A handle with no `growth-accounts` document is
   skipped — an ad-hoc pasted post from a stranger’s account never creates one.
2. **`FOLLOWER_SANITY_MULTIPLE` (10×).** Deliberately loose: it catches a bad
   parse or a mock-data row that slipped the handle reconciliation, not real
   growth. An account doubling overnight passes; one reporting ten times or a
   tenth of yesterday did not grow, it broke. A rejected value is logged and
   skipped, and the profile scrape still supplies that day’s number — so the
   failure mode is “no fresher than before”, never a corrupted series.
3. **Every reading is stamped `src`** — `'profile'` or `'post'` — on both `latest`
   and the series day entry. Set at the point each scraper builds its snapshot.
   **This is load-bearing**: Firestore’s `merge` deep-merges maps, so a field one
   path never sets is a field it never clears; without the profile scrape
   stamping `'profile'`, a single post-derived write would leave `src: 'post'` on
   that account forever. Absent on the two months of hand-collected history,
   which predate both feeds.

It is written in a **second batch**, committed after the engagement readings and
wrapped in its own try/catch: those readings are already paid for and must not be
rolled back by a failure on the follower side. It also keeps either batch clear
of the 500-write ceiling however large a refresh cycle grows.

### High-volume accounts

A search returns ~20 posts and the vendor documents pagination as unreliable, so
an account posting more than ~20/day cannot be fully seen by one daily discovery
— and *silently* missing posts is the problem, not missing them. The cron detects
it (`isWindowSaturated`: a full window whose oldest post is under a day old) and
stamps `postsWindowSaturated` on the account for the manage tab to surface. Fix
it per-account; do not raise the cadence for the whole roster.

### Gaps, failures and backfill

Identical to the follower rules, for the same reasons:

- **There is no backfill.** Engagement is only ever readable as its value *now*,
  so a post tracked from day 10 has nothing for days 0–9 and no amount of money
  buys it back. A newly tracked post reads "first reading" rather than showing an
  empty chart.
- **A failed read keeps the previous numbers** and stamps `lastReadStatus:
  'failed'`. A missed reading is a gap, which is true; a zero would draw a cliff
  to the axis and read as engagement collapsing.
- **A metric the scraper omitted is absent, never 0.** X reports `viewCount` and
  `bookmarkCount` inconsistently.
- **A failed post still advances `nextRefreshAt`**, so one deleted post cannot
  pin the batch and be re-requested on every single run.
- **Stop ≠ delete.** `isActive: false` drops a post out of the refresh queue and
  keeps every reading; `DELETE` is permanent and reachable only from the stopped
  list behind a confirm that says so.

### The Posts tab

A third tab on the same page (`Followers · Posts · Manage Accounts`), not a
separate route — one permission, one page, and the account toggle that arms post
tracking already lives next door.

**Pasting a link is the primary verb, so it is a permanent bar, not a dialog.**
Someone arrives here holding a link. The add fires a live scraper call, so it
takes 10–30s and says so; a link the actor cannot resolve writes nothing.

**How it feels live without inventing anything.** Readings land every 6/12/24
hours, so nothing here can honestly claim to be current. Exactly two things
animate, and both are true:

1. **The countdown to the next reading** (`RefreshCountdown`). `nextRefreshAt` is
   a timestamp the server already committed to, so counting down to it stays
   true with no new information. It is the page's pulse — in the status strip for
   the roster, and in the sheet for one post.
2. **The gap between two measured readings** (`AnimatedCount`). When a sync
   lands, the number tweens from the previous *observed* value to the new
   *observed* value. Both endpoints were measured.

Everything else is stated: an "as of" stamp per row, a measured `+240/day` rate
with the window it was measured over in its title, and a refresh log in the sheet
listing every moment something was actually read.

**Permanently banned: extrapolating a counter forward from a velocity** so
numbers tick while nothing is being read. Engagement velocity decays sharply, so
the projection overshoots and the next real reading lands as a visible drop — a
page that appears to lose data — and it would make a screenshot of a fabricated
number indistinguishable from a measured one.

**Both tickers write to the DOM, not to React state.** A 1 Hz `setState` is
precisely CLAUDE.md's navigation known-issue #2 (a per-second update anywhere in
the tree preempts pending transitions per-root). `useSlowTick` — the one that
*is* state, for relative-time strings — runs at 30s.

**The month's spend sits in the status strip**, beside the data rather than in a
settings page, because the discipline this feature runs on is that whoever turns
tracking on can see the price.

The table is `GrowthLeaderboard`'s construction and the sheet is
`AccountDetailSheet`'s, down to the reasons: real `<table>` semantics, the
interactive element being the excerpt *inside* the first cell (not
`role="button"` on the `<tr>`, which orphans the cells and whose focus ring is
never painted under `border-collapse: collapse`), and one metric selector
re-keying the number column, the rate column and the sparkline together rather
than eight columns of numbers nobody can scan.

**Manage Accounts** gains a `Switch` per **X** account. Facebook rows show a dash
rather than a disabled switch — post tracking is a capability that platform does
not have here, not a permission the user lacks, and a greyed control would
suggest it could be turned on. `postsWindowSaturated` renders as an amber warning
beside the switch.

### Deployment notes

- **`0 */6 * * *` is a third Vercel cron.** The Hobby plan allows two, daily
  only. On Hobby this must become `0 0 * * *` (a one-line change) — the ladder is
  driven by `nextRefreshAt`, not by the schedule, so it degrades to daily
  readings rather than breaking.
- Firestore **rules** (`growth-posts`, `growth-spend`, both denied) and
  **indexes** (one composite on `isActive`+`nextRefreshAt`, plus field exemptions
  for every map/array/free-text field) both changed — see the deploy commands in
  cross-cutting rule 1.
