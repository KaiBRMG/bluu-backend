# Growth Tracking

> The `smm-growth-tracking` page: daily follower history for the managed Facebook pages and X accounts, collected by a nightly Apify scrape and seeded from two months of hand-collected spreadsheets. Replaces a Google Sheet two people were filling in by hand.

## RULE 0 — this subsystem has no relationship to `twitterx-accounts`

Not a shared id, not a join, not a lookup, not a shared normalizer. The accounts tracked here are chosen and managed independently, and [`src/lib/growth/platform.ts`](../src/lib/growth/platform.ts) is deliberately a **separate** identity module from [`src/lib/smm/linkUtils.ts`](../src/lib/smm/linkUtils.ts) — the two answer different questions (`normalizePostLink` identifies a *tweet*; `parseProfileUrl` identifies an *account*). Integrating the two is explicitly deferred; do not pre-empt it by wiring a reference between them.

## RULE 1 — cost is the governing constraint

| Actor | Unit price | Nightly volume | Nightly |
|---|---|---|---|
| `apify/facebook-pages-scraper` | $0.010 / page | 12 pages | $0.120 |
| `apidojo/twitter-user-scraper` | $0.004 / profile URL | 60 profiles | $0.240 |
| `kaitoeasyapi/twitter-x-data-tweet-scraper-…-cheapest` | **$0.00025 / result** | see [post analytics](#post-analytics) | ~$0.03–0.10 |

**Those unit prices are planning figures, not the invoice** — what Apify actually charged is read from its own billing records and shown in **Manage accounts → Usage**; see [usage & real cost](#usage--real-cost--what-apify-actually-billed). Check the measured number before trusting the table above.

**≈ $0.36/night, ≈ $10.90/month** at the full managed roster (72 accounts, imported 2026-09-09 — see [the roster import](#the-roster-import)), linear per account added. It was ≈ $0.078/night at the original twelve-account seed list. Four things hold that line, and each is easy to undo by accident:

1. **The X actor takes `twitterHandles` only.** `getFollowers` / `getFollowing` / `getRetweeters` are the **$0.016-per-query** paths. They are passed explicitly `false` in [`runTwitterScrape`](../src/lib/services/growthTrackingService.ts) as an assertion, not because `false` is the default — "tidying away" those three lines is how a $2/month job silently becomes a $400/month one.
2. **`maxItems` is pinned to the batch size.** The hard ceiling on what one run can bill.
3. **One run per platform per night**, batching every account. Never one run per account.
4. **`MAX_TRACKED_ACCOUNTS` (100) is a circuit breaker.** Past it the cron logs loudly and scrapes nothing, and the add route refuses with an explanation. Raise it deliberately, with the bill in mind — never to clear an error. It was 60; it moved to 100 for the 72-account roster import, with the ~5× bill above accepted as part of that change, and the headroom is for hand-added accounts rather than for another bulk import.

**Never call the Apify API by hand** to explore a payload or verify a field name — the same rule as 9b for the OnlyFans provider. Use the actor pages, or ask the user for a payload; write the parse defensively instead (`num()` / `str()` in the service already probe for string-vs-number).

Both actors return extra fields **inside the same billed result**, so these cost nothing additional and are stored and shown: Facebook `likes` / `rating` / `ratingCount`; X `following` / `statusesCount` / `mediaCount` / `favouritesCount` / `isBlueVerified`. Anything needing a *separate* query is out of scope.

**The platform's own account id rides along too** and is stored as `platformAccountId`. `apidojo/twitter-user-scraper` reports the X rest id as `id`; the Facebook actor's page id is read from whichever of `pageId`/`facebookId`/`id` it populates. **Neither spelling has been verified against a live payload** — checking would mean calling the API, which rule 9d forbids — so `pickId` probes the plausible keys, the value is optional everywhere downstream, and a night that omits it leaves the stored id alone rather than blanking it. It is written only on a successful scrape, so an account imported in bulk has `null` until its first reading.

## Dependencies / Interacting Files

| Layer | Location |
|---|---|
| Page | `src/app/(main)/smm-portal/growth-tracking/page.tsx` |
| Components | `src/components/growth/*` |
| Client hook | `src/hooks/useApifyUsage.ts` (fetches only while the Usage dialog is open) |
| Cron | `src/app/api/cron/growth-tracking/route.ts` + the entry in `src/vercel.json` |
| Cron | `src/app/api/cron/growth-posts/route.ts` — the post refresh cycle, `0 */6 * * *` |
| API routes | `src/app/api/smm/growth/{accounts,accounts/[id],accounts/[id]/refresh,series}` |
| API routes | `src/app/api/smm/growth/posts`, `posts/[tweetId]`, `posts/[tweetId]/sync` |
| API routes | `src/app/api/smm/growth/usage` — the measured-cost report behind the **Usage** dialog |
| Service | `src/lib/services/growthTrackingService.ts` (follower scrape; owns the two profile actors) |
| Service | `src/lib/services/growthPostsService.ts` (**the only module that calls the tweet actor**) |
| Service | `src/lib/services/apifyUsageService.ts` (**measured** cost — reads Apify's own billing records; never runs an actor) |
| Pure logic | `src/lib/growth/{platform,metrics,signals,postLink,postMetrics,category}.ts` |
| Client hook | `src/hooks/useGrowthTracking.ts` |
| Client hook | `src/hooks/useGrowthPosts.ts` |
| Types | `src/types/firestore.ts` (`GrowthAccount`, `GrowthSeries`, `GrowthSnapshot`, `GrowthPost`, `GrowthPostSnapshot`, `GrowthSpendLedger`, `ApifyUsageReport`) |
| Import script | `src/scripts/import-growth-tracking.js` (`--dry-run`, `--wipe`) — the hand-collected *history* |
| Import script | `src/scripts/import-growth-accounts.js` (`--dry-run`, `--file=`) — the *roster* + categories |
| Migration (one-off) | `src/scripts/recategorise-facebook.js` (`--dry-run`) — splits the retired `FACEBOOK` category into `GENERAL` / `CREATOR`. Delete once run |

Registered in `src/lib/definitions.ts` as `smm-growth-tracking` under the `smm-portal` teamspace. **Invisible until an admin shares it** — see [permissions.md](permissions.md). `APIFY_API_KEY` and `CRON_SECRET` must be set in Vercel.

## Firestore

| Path | Purpose |
|---|---|
| `growth-accounts/{platform}_{handleNormalized}` | A tracked account. `isActive` (false = stopped, history kept), `latest`/`previous` denormalized readings, `lastScrapeAt`/`lastScrapeStatus`/`lastScrapeError`, `lastManualRefreshAt` (the manual-refresh cooldown gate; index-exempted) |
| `growth-accounts/{id}/series/{YYYY}` | `days: { 'YYYY-MM-DD': { followers, …extras } }` — **one document per account per year** |
| `growth-posts/{tweetId}` | One tracked X post: metadata, `latest`/`previous`, and `history: { 'YYYY-MM-DDTHH:mm': {…} }` — readings live **on the document**, no subcollection |
| `growth-spend/{YYYY-MM}` | The rolling cost ledger the refresh breaker reads. `results`/`usd`/`runs` are our own **estimate**, incremented as we spend; `actualUsd`/`actualTotalUsd`/`actualRuns` are what **Apify billed**, written back by `apifyUsageService` |
| `apify-usage/{YYYY-MM}` | A month's measured spend, read from Apify: per-actor and per-day totals plus the last 60 runs. Index-exempt — fetched by id only |
| `apify-actors/{actId}` | Immutable `actId` → `username/name` mapping, so a run row can be named without a lookup every time |

Both denied in `firestore.rules` (the subcollection match is explicit — rules don't cascade).

**The document id is deterministic** (`facebook_adamtwinkx`), which is what makes the duplicate check a single `get()` instead of a query and the importer idempotent for free. It is built from `parseProfileUrl` output, so **changing that function changes the identity of every account** — history would be written under ids the app never looks up, and the import would silently appear to do nothing.

**A `category` is a label, not identity.** Each account carries one of a **closed** set, declared with its colour triad in [`src/lib/growth/category.ts`](../src/lib/growth/category.ts), or `null` for an unfiled account. Because it is not part of the document id, it can be corrected freely (the manage view has a per-row picker, and re-running the roster import re-files in bulk) without orphaning a single reading. The vocabulary being closed is the whole justification for colouring it: DESIGN.md bans hashing an open-ended label onto N hues, and permits exactly this case.

**The vocabulary is scoped to the platform**, and `CATEGORIES_BY_PLATFORM` — not `GROWTH_CATEGORIES` — is the real one:

| Platform | May be filed under |
|---|---|
| X | `TWXNK` · `BONUS` · `CREATOR` · `SFW REPOST` |
| Facebook | `GENERAL` · `CREATOR` |

`GROWTH_CATEGORIES` is only their **union**. Use it to render chips for values already present in the data (the overview's filter row counts what the roster actually uses) or to check a stored value is still known; **never offer it as a picker**, or a Facebook page gets an X grouping in its menu.

**`CREATOR` is deliberately shared by both platforms.** A creator's X account and that same creator's Facebook page are one grouping seen twice, so filtering by `CREATOR` returns both. Splitting it into an `FB CREATOR` would put one grouping behind two chips and make "how are the creators doing" a question you have to ask twice.

**Two normalisers, and the difference is the direction of travel.** `normalizeCategory` is platform-blind and is what `serializeGrowthAccount` applies on the way *out* of Firestore — the question there is "is this still a category the app knows", and rejecting a value for being wrong *for its platform* would blank a filed account instead of showing the misfiling. `normalizeCategoryFor(platform, …)` is the **write** path, used by `POST /api/smm/growth/accounts` and the `PATCH` route (which must therefore read the document *before* validating, to know the platform). A picker that only offers the right options is an affordance, not a validation.

**Retired: `FACEBOOK`.** Until 2026-09-09 every Facebook page sat in a single `FACEBOOK` category — a "category" that only restated the platform mark already on the row. It is out of the vocabulary, so any document still holding it reads as **unfiled** rather than as a sixth colour, which is a state the manage view can fix. The one-off [`src/scripts/recategorise-facebook.js`](../src/scripts/recategorise-facebook.js) (`--dry-run` first) re-files every Facebook page as `GENERAL`, or `CREATOR` for the handles listed in `CREATOR_HANDLES`. It writes **only** `category`, is idempotent, and should be deleted once it has run.

**An account is named by its `handle` and nothing else.** There is no display name: every surface renders the handle, sorting is by handle, and the avatar fallback is seeded from it. DESIGN.md's Avatar Seed Rule names `displayName` because that is the field on a `users` doc; what it protects is that one account hashes to one colour everywhere, and here the handle is the stable identity. Consequently `PATCH` accepts only `isActive`, `trackPosts` and `category` — platform, handle and profile URL are the document id, so changing one would orphan the history rather than move it. Documents created before this may still carry a stray `displayName` field; nothing reads it.

### Why a day-keyed map and not a document per day

A full page load is **one collection query plus one `adminDb.getAll()`** — about 24 reads at the seed list, and *flat* as history deepens because a year is a single document. A document per day would be thousands of reads for the same chart (rule 9).

The cost of that choice is paid in `firestore.indexes.json`: **`series.days` is index-exempt** (`"indexes": []`), along with `growth-accounts.latest`, `.previous`, `.category` and `.platformAccountId` — the last two are filtered in the client, never queried. Without the exemption Firestore writes one index entry per recorded calendar day, per write, forever, on documents nothing ever queries. **Deploy with `firebase deploy --only firestore:indexes`.**

## The nightly job

`GET /api/cron/growth-tracking`, scheduled `0 0 * * *` in `src/vercel.json`. Vercel Cron rather than a Cloud Function so it can import the service, the parser and the shared types instead of carrying a second copy in `functions/index.js`.

- `maxDuration = 300`. The actors take 10–30s; `run-sync-get-dataset-items` blocks and returns the items in one call, so there is no polling or run-id bookkeeping.
- `CRON_SECRET` bearer, **fail-closed** when unset. Read via `headers()` — with `cacheComponents` on, a route touching no request-scoped API prerenders and every invocation would receive the build-time 404. Same reasoning as `/api/cron/onlyfans-media-usage`.
- **`Promise.allSettled`, not `all`.** A Facebook outage must not discard X readings already paid for.
- **A failed account keeps its old `latest`.** A night with no reading is a *gap*, which is true; overwriting with 0 would draw a collapse that never happened. A run can also succeed while omitting individual accounts (renamed, private, deleted) — those are stamped `failed` with a reason the manage tab shows.

## Adding an account

`POST /api/smm/growth/accounts` fires **one immediate single-account scrape** (~$0.01) and is all-or-nothing: a URL the actor cannot resolve **writes nothing**. That matters because a typo would otherwise become a document that fails, and bills, every night forever while showing an empty chart. The same scrape doubles as day zero.

### Refreshing one account by hand

`POST /api/smm/growth/accounts/[id]/refresh` — **the only control in the subsystem that spends on two bills in one click.** One profile-actor run for followers (~$0.004 X / ~$0.010 Facebook) *and* one tweet-actor run for that account's tracked posts (a floor of 20 billed results, ~$0.005). Roughly 1.5¢ a click against a subsystem that runs at ~$11/month. Five things hold that line:

1. **The cooldown is server-side.** `lastManualRefreshAt` on the account document, 15 minutes, the same window as a post's `MANUAL_SYNC_COOLDOWN_MS` so nobody has to learn two waits. The constant lives in [`metrics.ts`](../src/lib/growth/metrics.ts) (pure, so the button can render its own disabled state without importing `firebase-admin`) and the service re-exports it — exactly the arrangement `MANUAL_SYNC_COOLDOWN_MS` already uses. A timer in the renderer is a suggestion anyone can skip from a console, and every skip is two actor runs.
2. **The stamp lands whether or not anything resolved.** The actors ran; the call was billed. A failure that left the cooldown unset would be a free retry loop over a paid API.
3. **A stopped account is refused, 409.** Stopping *is* the instruction to stop spending — the whole difference between stopping and deleting — so a button that spent anyway would quietly undo the one thing the user asked for. Disabled in the UI **and** refused by the route; a disabled button is an affordance, not a rule (rule 10).
4. **The post call is padded to the floor, never sent under it.** An account with three posts asks for those three plus the seventeen stalest on the roster, which get a free reading. `MAX_REFRESH_PER_RUN` caps the other end so an account with hundreds of tracked posts cannot turn one click into a hundred-result bill.
5. **Only the requested posts are stamped**, never the padding. A padded post got a reading it did not ask for; locking its own button for fifteen minutes because of that would charge it for someone else's call.

**The two calls run concurrently and settle independently.** Different actors, different collections, nothing shared — so `Promise.allSettled` keeps the wall clock at the slower of the two rather than their sum (hence `maxDuration = 120`, headroom for one call and not for two in series). It also makes partial success first-class: followers can land while the post read fails, or the reverse, and the response says which. A single try/catch would have discarded the half that worked.

**The spend ceiling stops the posts, not the followers.** `checkSpendCeiling` guards the tweet actor's monthly ledger specifically; the profile actors are a different bill with no ledger. A month that has hit its post ceiling still refreshes followers and says why the posts were skipped — refusing the whole request would withhold something the ceiling was never protecting.

**An account's posts are found by `accountId` OR author handle**, the same union the panel filters on, via two equality queries on the automatic single-field indexes ([`listPostsForAccount`](../src/lib/services/growthPostsService.ts)). `listGrowthPosts` would have read every post on the roster to find a dozen (rule 9).

**Remove is `isActive: false`, not a delete.** Stopping ends the cost and takes the account off the active roster while keeping every reading, and it is one click to resume. `DELETE` exists but only from the stopped list, behind a confirm that names what it destroys — `recursiveDelete` takes the `series` subtree with it, and the scrapers only ever return *today's* number, so deleted history cannot be re-collected.

**Stopping cascades to the account's posts. Resuming does not.** Stopping is the instruction to stop spending, and an account's posts are a line on the *same* bill — so `PATCH` sets `isActive: false` on every one of them ([`stopPostsForAccount`](../src/lib/services/growthPostsService.ts)) on the true → false edge only, and returns `postsStopped` so the UI can state the number instead of guessing it. It is a batched write over the same `accountId` OR handle union as above, and posts already stopped are skipped — writing `false` over `false` is a billed write that changes nothing (rule 9). The asymmetry is deliberate: resuming an account buys one cheap follower read, while resuming twenty posts would restart twenty billed refreshes nobody asked for, so posts come back one at a time from the account panel that still lists them. **This is the one cascade — `DELETE` still never touches posts** (see the route comment: their engagement history is exactly as unrecoverable as the follower history).

**Both surfaces that stop an account share one handler** (`handleSetTracking` in `page.tsx`), because what stopping costs is the thing the user is deciding about, and two surfaces stopping an account by different amounts is the drift this subsystem's shared `useTrackPosts` already guards against elsewhere. It is also the third seam between the two independent hooks: the posts payload is refetched only when `postsStopped > 0`.

**Access is one tier.** `checkGrowthAccess(uid)` = `smm-growth-tracking || smm-admin` for reads *and* writes: anyone holding the page may add and remove (confirmed with the user). Page permission, not the admin JWT claim — these routes touch no part of the auth graph.

## The page

**Three full-width surfaces, one on screen at a time** — Overview, Tracked posts, Manage accounts — **plus one account, which is a side panel over whichever of them is showing.** The three are **page state, not routes** (`View` in `page.tsx`): both hooks already hold their whole payload in memory, so switching costs no Firestore read and returning from a detail is instant, where routes would remount the app shell and re-run both fetches for data that is already there (rule 9). The cost is that a view is not linkable — accepted, because nothing here is shared by URL.

**An account is not a `View` variant**, because it does not replace the page. `openAccountId` is its own state and [`AccountSheet`](../src/components/growth/AccountSheet.tsx) renders outside the view switch — it is reachable from the roster grid *and* from the Signals band, and both of those stay on screen behind it.

**Page state means the page owes what a route would have given.** A `<Link>` navigation resets the scroll, moves focus and re-announces the document; `setView` does none of that — focus falls to `<body>` when the clicked control unmounts, so the next Tab restarts at the top of the app shell and a screen reader is never told the main region was replaced. `page.tsx` therefore focuses the new view's `<h1>` on every view change (`tabIndex={-1}`, removed again on blur) and scrolls to top uniformly. Focusing the heading is also why there is **no** `role="status"` line beside it: moving focus to a heading announces that heading, and a live region would say it twice. Any surface that trades routes for page state inherits this obligation.

**The panel body and the post sheet are `next/dynamic`.** They hold the only two recharts charts in the subsystem — the roster's sparklines are hand-drawn SVG specifically to avoid the library — so a static import made every first paint of the overview parse a chart tree it never renders.

**The dynamic boundary sits *inside* the Sheet, not around it.** `AccountSheet` is static and owns nothing but the `Sheet`; `AccountPanel` is the dynamic import. Put the boundary around the Sheet instead and the first click on a card does nothing visible until the chunk lands — this way the skeleton is panel-shaped and slides in immediately. Its `sr-only` `SheetTitle` is load-bearing: Radix names the dialog from that element, and for the frame or two the skeleton stands in there would otherwise be none. On `PostsTab` the standalone post sheet is still mounted behind a latch (`everOpened`) rather than `openPost !== null`, so its chunk is not fetched until a post is opened and the sheet still keeps its close animation.

The layout was rebuilt on 2026-09-09 from a supplied reference design. Its **structure** was adopted wholesale — stat row, Signals band, a grid of account cards, an account detail with post tracking inside it (full-page then; a side panel since — see [the account panel](#the-account-panel)). Its **skin** was not: the reference carried a second typeface (Space Grotesk + Manrope), its own oklch palette, a gradient wash with a pulsing dot, and brand-coloured platform tiles. Each of those is a named rule in [DESIGN.md](../DESIGN.md) — the One-Family Rule, the Semantic-Only Rule, "nothing that asks to be watched", and this subsystem's own greyscale platform marks — so the page renders in the house voice throughout. **This is not a divergence surface; do not reintroduce the reference's chrome.**

### The overview

**The overview is the ACTIVE roster; Manage accounts is the full ledger.** `roster` in `page.tsx` is `accounts.filter(a => a.isActive)`, and the grid, the category chips, the platform facet counts, the four stat tiles, the Signals band and the staleness banner all read from it — so the totals always describe what is on screen. A stopped account leaving the page it is read from every day is the point: leaving its card there made "stop tracking" look like it had not taken. `accountsById` is deliberately built from the **whole** list, because the panel has to keep rendering the account that was just stopped, and has to open for a stopped one reached from Manage accounts.

**A failed read is marked on the card.** A scrape that fails leaves the last good reading in place, so the card's figure and sparkline still look like current data — the failure state was previously invisible on the one surface the roster is actually read from, and visible only in the manage table and in the account panel. `ScrapeFailedBadge` (red, `CircleAlertIcon`, "Read failed") sits in the card's top-right, stacked above the spike badge when both apply, since a spike is computed from history and can be true on the same night a read failed. Deliberately **not** the manage table's `TriangleAlertIcon` — that glyph already means "posts faster than one nightly read can see" here, and two warnings separated by hue alone is what the colour rules exist to prevent. It is gated on `isActive`: a stopped account's `lastScrapeStatus` is frozen at whatever it was when tracking was switched off, and rendering that as a live failure reports a job that is not running.

**The design problem is scale, and the grid dissolves it.** TwinkUniversity sits near 684k followers and Connor near 13k. The previous overview drew them on one shared axis and needed a re-basing mode (indexed / net / absolute) to stop the big accounts flattening the small ones into the baseline. Each card now carries **its own** sparkline on **its own** scale, so the problem stops existing rather than being worked around, and cross-account comparison is carried by the ranked figures and the Signals band instead of by seventy overlapping traces. `GrowthChart`, `GrowthLeaderboard`, `GrowthSummary` and the old `AccountDetailSheet` are gone; `MODE_LABEL`, `toChartRows` and `axisDays` went with them. (Today's `AccountSheet` is not that component returning — the old one was three facts and a chart; this one is the full detail, which is why the detour through a full-width page happened at all.) `GROWTH_MODES` and `pointsFor`'s modes stay — every caller asks for `absolute` today, and they are the projection this data needs the moment two accounts share an axis again.

**The four stat tiles are roster-wide and range-independent, on purpose.** X followers · Facebook followers · Biggest Mover · Fastest Growing. Everything else on the page answers "over the window and filter I picked"; these are the standing facts the reader checks *before* choosing a filter, and tiles whose meaning changed with the chips above them would make the same glance mean something different every time. Followers are **not** summed across platforms — an X follower and a Facebook page follower are not the same unit, they are scraped by different actors on different bills, and the roster is managed as two lists.

**The last two tiles name an account rather than counting something**, and they answer two questions that are easy to conflate: **Biggest Mover** is who is *largest* (the denormalized `latest` reading, stopped accounts included — their last reading is still part of the operation's reach, the same rule the totals follow), **Fastest Growing** is who is *moving*, over the fixed seven-day window `signals.ts` owns (active accounts only, because a stopped account's last week is frozen history rather than news — the rule `signalsFor` already applies). Both read `spikePercent`/`latest` rather than re-deriving, so a tile can never disagree with the Signals band about who is growing. Neither follows the range control. Each keeps the Display-step figure on the **metric** and puts the identity in the Meta line beneath — four tiles whose big text were sometimes a handle and sometimes a figure would not scan as a row. Only positive movement qualifies as fastest-growing: on a week when the whole roster slipped, the least-shrinking account renders `—`, not a false headline.

They replaced *Posts tracked* and *Active signals* (2026-09-09). Neither figure was lost: the post count is on the **Tracked posts** button in the page header, and the signal count is stated in the Signals band itself — the tiles were restating what the surfaces below them already said, where an account name is something no other tile carries.

**Colour on a card is rationed to three jobs, each a state**: the delta's direction (green / red, which the sparkline echoes), a spike (orange — the app's *attention needed* hue), and the category dot. The platform mark stays greyscale; brand colour would be decoration. The whole card is the button — there is nothing else interactive inside it, unlike the tables in this subsystem where `role="button"` on a `<tr>` would orphan the cells.

### Signals

**A signal is derived, never stored.** [`src/lib/growth/signals.ts`](../src/lib/growth/signals.ts) reads the same day-keyed series everything else does; no document gained a field and there is nothing to backfill.

- **The window is fixed at seven days** while everything around it follows the range control. The range answers "how did the roster do over the period I care about"; a signal answers "what changed *recently*", and it has to mean the same thing every time it appears or the band becomes a restatement of whichever range happens to be selected.
- **The threshold is a slider on the band, defaulting to 12%.** There is no correct value — a repost farm at +12%/week is ordinary, a 684k page at +12%/week is extraordinary — so rather than pick one and defend it, the page exposes it. It is view state; nothing is written. It lives on the band because the band is the only thing the bar decides the visibility of, so an empty band and an over-full one are both fixed in the same glance. **The band never disappears** — a control whose surface vanishes as you drag it reads as broken — but its orange tint does: with nothing above the bar it drops to the ordinary overlay recipe, because a box that is orange every day of the year is a box people stop reading.
- **Signals ignore the platform/category filter**, deliberately: the band's job is to interrupt with something the reader was *not* already looking at. The grid below it is the filtered view.
- **Only upward movement counts, and stopped accounts are excluded.** A collapse is worth knowing about but is a different alarm with a different hue and a different threshold; folding it in would put "up 20%" and "down 20%" in one undifferentiated row. A stopped account's last week is frozen history, not news.
- A card's spike badge uses the **same** threshold as the band, so the two always agree.

### The account panel

**The panel's body scrolls, not the panel.** `SheetContent` is `overflow-hidden`; the header is `shrink-0` and the body is `min-h-0 flex-1 overflow-y-auto`. When the whole sheet scrolled, two things left with it: the Window control — which scopes every figure below it, and sat ~2,600px above the reader by post 14 — and shadcn's own close button, which is `absolute` inside that box and therefore scrolls with its content. A panel whose argument is "a peek" had no visible exit from its second screenful. `min-h-0` is load-bearing: a flex child's default `min-height: auto` refuses to shrink below its content, so without it the body grows full-height and the sheet scrolls as a whole again.

**Section headings are the section rail, not the eyebrow.** A plain `text-xs font-medium text-zinc-400` label, an `h-px bg-white/[0.07]` rule filling the width, and anything the section states on the same line (a count, a countdown) — the pattern DESIGN.md §5 already defines. The panel previously rendered the uppercase 11px eyebrow five times, which DESIGN.md §3 reserves for sidebar section headers as "a deliberate, single-use brand device, **not a per-section scaffold**" — and which failed at the job anyway, since `space-y-5` gives sections the same gap as the elements inside them, leaving the eye nothing to catch on down a 3,000px column. Heading levels now run `SheetTitle` `<h2>` → `SectionLabel` `<h3>` → the open card's log `<h4>`; they used to skip from a second `<h2>` straight to `<h4>`.

**A panel, not a page.** It was a full-width page for exactly one reason — `PostsTable` is five columns wide with three sortable headers, and that does not fit a panel. A column of [`PostCard`](../src/components/growth/PostCard.tsx)s removed the reason, and the panel bought back what a page cannot give: the roster stays on screen behind it, so opening an account is a peek rather than a departure, and moving between accounts does not bounce through an overview you never left. `sm:max-w-2xl`, wider than the post sheet's `max-w-xl`, because this one carries a chart, a control deck *and* a list.

**A post's detail opens inside its own card. There is no second level and no second sheet.** Both alternatives were built and both are wrong here. A second `Sheet` means two overlays darkening the canvas twice, two focus traps and an `Esc` that only closes the top one. Replacing the panel's contents avoids that and still loses the thing that matters: **the list is the context for every number in it** — with it covered, comparing two posts is a round trip with nothing on screen in between. Expanded in place, the neighbours stay visible and the reading log lands directly under the sparkline it explains. `Accordion type="single" collapsible` keeps one open at a time, so the panel never becomes a page of stacked detail.

**`account === null` is both the close signal and the reset.** The panel content unmounts with it — the same construction `PostDetailSheet` already used — which is what makes reopening an account always start with nothing expanded instead of wherever the previous visit was abandoned. No effect, no latch, no key juggling.

**Posts are ordered newest first, and nothing re-sorts them.** Ranking by engagement is the obvious move and it is wrong: engagement is cumulative, so that list is simply the oldest posts, permanently, while the ones still accumulating — the only ones the next refresh can change — sink out of sight. The timeline is also the order the reader already holds in their head. A post with no publish time sinks either way; it is missing from the timeline, not the oldest thing in it.

**The live line sits above the Controls deck, and is the post card's live line one level up.** Same construction, same grouping: when the number was taken, when the next one is due, and the control that buys one now — together, because they answer one question, and apart they are three unrelated facts scattered down a panel. It sits *outside* the Controls deck for a reason that is not cosmetic: that deck is X-only (post tracking is a capability Facebook does not have here) and a Facebook page still has followers worth refreshing. One placement, every platform. `AccountFacts` lost its "Last reading" line in the same change — a freshness claim in two places is the start of the two drifting apart.

**The price is on screen, not in the tooltip.** The meta line names both halves and counts the posts ("Reads followers and 12 tracked posts. Both are billed."); the `title` carries only what does not fit — that the post read is padded to the 20-result floor, so the longest-waiting posts ride along free. A tooltip reaches neither a keyboard nor a glance, and the discipline this feature runs on is that whoever spends can see what they are spending.

**Order is an argument about priority, and controls win.** Live line → Controls → followers → tracked posts → folded-away facts. The page version had it backwards: its only two decisions (post discovery, and pasting a link) sat at the very bottom, below a table, which put the surface's actions behind its longest read. The one exception to the order is a failed read, which sits directly under the header — it is the only thing that explains why the chart below it has a flat tail, and folding it away would leave stale numbers looking current.

**The Window control belongs to the panel, not to the roster and not to the chart.** One account is on this axis, so the window that suits it has nothing to do with the window the grid behind it is showing. It seeds from the page's range and diverges from there; nothing is written back. The follower axis is scaled to the data rather than zero-based — only one account is on it, so the scale can simply be its own.

**It sits in the header because it scopes the whole panel**: the follower delta and chart, *and* every post card's change figure and sparkline, *and* every row of the open card's breakdown. One picker meaning one thing wherever its effect lands is the reason it sits above all of it. It started inside the Followers section, where it silently changed content further down — the same failure the roster's control layout already avoids.

**It scopes measurement, not membership — and that distinction was learned the hard way.** The first version also cut the list to posts *published* inside the window, which made the control look broken: under a 7-day window every listed post was at most seven days old, so "change over 7 days" was simply its lifetime total. Every tracked post is now always listed, and the window says *how much each one moved lately*. A post with fewer than two readings inside the window renders `—` and a dashed hairline, never a zero — so a **frozen** post reads as unmeasured under a short window rather than as flat, which is the same "never invent a value for a gap" rule the follower chart follows.

**The headline figures are not windowed, deliberately.** The five-metric strip and the engagement total state where a post *stands*, which is not a windowed question — and keeping them unscoped is what leaves a frozen post readable under a window that can measure nothing about it.

**The panel header carries what is true of the *account*, not of the view.** Two controls sit on the chip row, left and right: the **category picker** and **Stop / Resume tracking**. Everything else on the panel describes what is being shown (the window, the refresh, the posts); these two change the account itself, which is why they sit above the rail rather than inside the Controls deck.

- The category was a read-only `CategoryDot`. It became the picker *in place* rather than gaining one beside it — one element for one fact. [`CategorySelect`](../src/components/growth/growthUi.tsx) is shared with the manage table so the two cannot offer different vocabularies; its `dot` prop is the single thing they disagree about, and the reason is written at the definition (this is the only place the account's category colour appears on the panel, so the mark moves inside the trigger).
- **Stop tracking is `outline`, not `destructive`, and confirms.** Nothing is destroyed, so a red button would misread — but "stop" next to a button that looks destructive is exactly what stops people stopping accounts they should. The dialog states the three true things: the card leaves the overview, *n* tracked posts stop refreshing, and every reading is kept in Manage accounts where it can be resumed. **Resume needs no confirm** — it costs one nightly read and undoes nothing, and without it the panel would be a dead end for the account it had just stopped.
- **The panel takes its own opening focus.** Radix hands it to the first tabbable descendant, which is now the category picker — so every account opened with a focus ring on a control that writes data, and the first Tab started past the header. `AccountSheet` prevents that (`onOpenAutoFocus` + `tabIndex={-1}`) and focuses the panel, which is also what a screen reader should announce.

**Post tracking is inside the account, not a separate tab.** The reference put a "check every 15 min / 1 hour / 1 day" picker in that slot; **there is no such control to expose** — a post's cadence is set by its own age (see [post analytics](#post-analytics)), because engagement can only ever be read as its value right now. What occupies the slot is the one thing that *is* a choice: the `trackPosts` switch, which is a separate line on the bill. It is offered here *and* in the manage table, through the shared [`useTrackPosts`](../src/components/growth/useTrackPosts.ts) hook — the cost wording must not drift between the two. On a Facebook account the deck is not rendered at all, just a quiet line: a bordered box around one sentence is a container pretending there is content in it.

**An account's posts are matched by `accountId` OR author handle.** A post pasted by hand carries no `accountId`, and filing only by that field would hide a manually tracked post from the very page its author lives on.

**Tracked posts survives as its own surface** because it is the only home an orphan has: a pasted link whose author is not on the roster belongs to no account panel. It also carries the monthly spend ledger.

### Shared behaviour

**Gaps are the normal case, and nothing may invent a value for one.** The imported months skip most weekends and a scrape can fail, so: `connectNulls` on the detail chart, `deltaFor` returns `change: null` (rendered `—`) until there are two readings, `spikePercent` returns `null` on the same terms, and a sparkline with one point draws a dashed hairline rather than a flat line implying a measurement. A freshly added account reads "First reading tonight".

**Selection in the segmented controls is inked in-component** (`SEGMENT_ITEM_CLASS` in `growthUi.tsx`). shadcn's `outline` toggle variant paints hover *and* the on-state with `bg-accent` — indistinguishable from each other and ~1.5:1 against the card, under the 3:1 floor for a state indicator — so date range and post metric take the same filled Action Blue Deep as the page's filter chips.

**The range control is N days of *change*, not N readings.** `rangeStart` starts a `7d` window seven days back, so it holds last week's reading *and* today's. That is what makes `1d` usable at all: under the previous "N days including today" reading it would have contained a single reading, and every delta on the page — which requires two — would have rendered `—`, looking broken rather than empty. Options are `1d · 3d · 7d · 30d · 90d · All`; the default is 30d.

**The filter row is one facet, not two.** All accounts · Facebook · X · then the categories, separated by a hairline. Single-select: the roster's categories are already platform-shaped in practice (the Facebook pages are their own category), so two independent rows would mostly produce empty intersections and a second control to reset. Only categories the roster actually uses get a chip — a chip reading "0" is a filter that leads nowhere.

**The category chips carry their category's hue in both states**, where every other chip on the page fills with Action Blue when selected. Deliberate: the colour coding *is* the feature, and a chip that turned blue the moment it was picked would teach a hue and then withdraw it exactly when it is being used. `CATEGORY_TONE` carries a third step for this layout — `dot`, the bare `-400` fill used on the card and signal card where a bordered chip would be the loudest thing in a 250px box. The filter row renders a chip per category **actually present in the roster**, so it needs the union rather than a platform's menu; `GENERAL` takes the neutral step it inherited from the retired `FACEBOOK` value, since "a page that is not a creator's" is the absence of a distinguishing grouping rather than a sixth hue. **The filled step is measured per hue**: white on `green-600` (3.30:1) and `orange-600` (3.54:1) failed AA at the chip's 12px, so CREATOR and BONUS fill at `-700`; purple, blue and zinc pass at `-600`. The table is in `category.ts` — measure any hue added there against white before it ships.

**The search narrows the grid only.** It matches the handle as a substring and `platformAccountId` as a prefix — the id is the one key a renamed account keeps, and it is an opaque number nobody remembers the middle of. The tiles and the Signals band above it stay on the whole roster: they are its summary, and re-computing them per keystroke would rewrite content sitting off-screen above the input.

**Staleness is roster-wide, not per account** — one page going private is a per-account failure the manage view reports; *nothing* read for 36h means the job itself stopped, which is the only thing worth a banner. `STALE_AFTER_HOURS` is 36 rather than 24 so one late run does not cry wolf.

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

## The roster import

`src/scripts/import-growth-accounts.js` loads `accounts.txt` (repo root) — the managed roster, grouped under `Category:` headings — into `growth-accounts`. Run `--dry-run` first; `--file=<path>` reads a different roster. A heading alone is not enough: an account listed under a category **its platform cannot hold** (a Facebook URL under `Category: TWXNK`) is reported and skipped rather than coerced, because guessing which grouping was meant is how a creator's page ends up filed as general. Its `CATEGORIES_BY_PLATFORM` mirror must stay in lockstep with `category.ts`.

- **The label before the URL is ignored.** It is a hand-typed nickname ("💌 TWINKLOAD"); the handle comes from the URL, which is the only authoritative field on the line. An account is named by its handle and nothing else.
- **It never overwrites tracked data.** An account that already exists gets exactly one field written — `category`, merged. `latest`, `previous`, `isActive`, `trackPosts`, the scrape stamps and the whole `series` subtree are untouched. About a dozen accounts in the file already carry two months of hand-collected history, and the scrapers only ever return *today's* number.
- **It never calls Apify.** The single-add route pays for a validating scrape because a typo would otherwise bill every night forever; ~60 billed profile reads to learn what tonight's cron learns for free is not the same trade. New accounts start with `latest: null` ("First reading tonight"), and a handle that does not resolve surfaces as a `failed` status in Manage Accounts after one night.
- **It refuses to exceed `MAX_TRACKED_ACCOUNTS`** and prints the projected nightly/monthly bill for the accounts in the file before writing anything. Past the breaker the cron scrapes *nothing at all*, so importing anyway would stop the whole job.
- **Idempotent**, and re-running after editing a category in the file is the bulk way to re-file. Duplicate lines pointing at one account are reported; the first listing wins.
- It carries a **hand-copied mirror of `parseProfileUrl`/`growthAccountId`** and of `MAX_TRACKED_ACCOUNTS`/`UNIT_COST`/the category list. **Keep them in lockstep.**

Current roster: 72 accounts — 60 X, 12 Facebook (TWXNK 8, BONUS 9, CREATOR 23, SFW REPOST 20, FACEBOOK 12).

---

## Post analytics

> Individual X post engagement, layered on top of the follower scrape without
> touching it. The follower job keeps its own actors, its own cadence and its own
> cost line; nothing below changes what it does or what it spends.

**The main entry point is a pasted link.** Someone drops an X post URL into the
paste bar — on an account's page, or on the roster-wide Tracked posts view — and
that post is tracked from that moment. The per-account **Track
posts** toggle is the secondary path: it turns on a nightly discovery pass that
finds that account's newest posts and starts tracking them automatically.

### What switching Track posts on actually does

It is **not** limited to posts published after the toggle. Discovery runs a
`from:handle` search and takes the account's **~20 most recent posts, whenever
they were published**, dropping replies and retweets. So the toggle is a one-off
catch-up *plus* an ongoing feed.

- Posts **under 30 days old** join the refresh ladder normally.
- Posts **over 30 days old** are frozen straight after their first refresh — one
  data point, no curve. There is no backfill (see below), so that single figure
  is all that post will ever have from before it was tracked.

**The search fires immediately on the toggle**, not on the next cron run.
`PATCH /api/smm/growth/accounts/[id]` calls the same
`discoverPostsForAccounts` the cron does, so flipping the switch shows posts
within the same interaction instead of appearing to do nothing for up to six
hours — the same reasoning as the account-add route, which also scrapes on the
spot. Three things about that path:

- **The toggle is saved first and is never rolled back by a failed search.** The
  intent is "track this account"; a scraper hiccup must not refuse it, and the
  nightly pass retries on its own. The route reports the outcome so the UI can
  say what actually happened rather than claiming success.
- **The spend breaker still applies.** Over the ceiling, the toggle saves and the
  search is skipped with an explanation.
- **It only fires on `false → true`, and only for an active X account.** Toggling
  an already-opted-in account, or switching off, searches nothing.

`discoverPostsForAccounts` is shared between the cron and this route
deliberately: the mock-data reconciliation, the roster breaker and the saturation
check are each load-bearing, and a second copy would drift on all three. The
caller decides *who* is due; the function decides nothing about scheduling.

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

### Where tracked posts are read

Two surfaces, both inside the same page and permission — never a separate route.

**An account's own posts live in that account's panel**, under the follower
chart, matched by `accountId` OR author handle so a hand-pasted post is not
hidden from the very account its author lives on. That is where someone looking
at one account expects them.

**At panel width they are cards, not a table.** [`PostCard`](../src/components/growth/PostCard.tsx)
is `AccountCard` one level down — the same three bands in the same order (identity
block with its state marks pushed right, then the headline figure with its rate
beside it, then a full-width sparkline on its own scale), because a post inside an
account is the same *kind* of object as an account inside the roster and should be
read with the same eye movement. The author avatar is dropped: every post in this
list has the same author, so a column of identical faces states nothing.

**Two bands are deliberately not copied: colour, and what the sparkline draws.**

*Colour.* `AccountCard` tints its delta and its trace green or red because a
follower count genuinely falls. **Cumulative engagement essentially cannot** —
carried over unchanged, every post card would be green every day, and a hue that
never varies encodes nothing. So the post trace stays greyscale and the card's
colour is spent on what does vary: the refresh state (Action Blue while a post is
young enough for its numbers to move), a failed read (red, gated on `isActive`),
and the open state. **Check what a hue distinguishes before copying a card's
palette down a level.**

*The sparkline draws the **rate**, not the running total* —
[`ratePointsFor`](../src/lib/growth/postMetrics.ts), zero-based. The same test
applied to the other half of that vocabulary fails there too: a trace of the
total is a rise that flattens on *every* post that ever worked, and `Sparkline`
normalises to its own min/max, so a post that gained 3 and one that gained 1,600
draw an identical full-height climb. The rate rises while a post spreads and
decays to nothing as it settles, so "is this still moving?" — the one question a
refresh can still change the answer to — is legible at 36px. It is a rate rather
than a raw increment because the ladder's intervals are unequal (6h → 12h → daily
→ weekly); raw increments would draw the weekly reading as a spike when it merely
accumulated over seven times as long. `from` clips the output, not the input, so
the window's first pair still bases on the last reading *before* it.
`VelocityValue` sits at the end of that line stating the current rate — which is
what keeps the mark from being decoration, since it names in words the series the
line is drawing.

**`Sparkline`'s `zeroBased` exists for exactly this and must not become the
default.** Zero is a meaningful floor for a decaying rate; on the follower counts
this mark usually draws, a zero baseline flattens a good month into a straight
line (the whole reason this subsystem scales to data).

**The card carries X's own metric strip, where X puts it.** Replies · reposts · likes · views · bookmarks, with the platform's own glyphs (`MessageCircle`, `Repeat2`, `Heart`, `ChartNoAxesColumnIncreasing`, `Bookmark`), sitting directly under the post the way they do on X. This **replaced a segmented `Total · Likes · Reposts · Replies · Views` picker** above the list: all five fit on one 16px line, and the person reading this panel already knows those glyphs by heart from the platform the data came from — a control that hides four facts to reveal one is a worse deal than the line that shows all five. Each glyph is `aria-hidden` with the metric named in `sr-only` text; a heart means nothing to a screen reader. An unreported metric renders `—`, never `0`, because X reports `views` and `bookmarks` inconsistently and "nobody bookmarked this" is not "X did not say".

`quotes` is the one engagement component **not** on the strip — X does not surface it under a post either — but it keeps its row in the open card's breakdown. `STRIP_METRICS` is exported so the panel builds exactly the five figures the strip renders; it briefly built all six and threw `quotes` away on every card, every window change.

**The strip is a five-column grid, not a flex row.** Under `flex … gap-x-5` each glyph's x-position depended on the digit width of the value before it, so three stacked cards put their five metrics at three different sets of positions and the column could not be read downward at all — which is most of what a strip like this is for. `tabular-nums` aligns digits *inside* one figure and does nothing for this.

**Open is raised above every hover step, and takes the Action Blue edge.** It was not: the trigger's hover wash composites on top of the item's ground, so a rest of `0.025` + a hover of `0.03` rendered ≈`0.054` against an open card's `0.04` — every neighbour the cursor touched was brighter than the one actually open, and both states drew the same `white/[0.12]` border. Open now sits at `bg-white/[0.07]` with `border-action-blue/40`. An open card is the current selection, which is the one job DESIGN.md licenses that hue for, and it is the only cue hover cannot imitate.

**The card is the trigger and the detail is its `AccordionContent`.** The excerpt
stays clamped in the header even while open: repeating the opening line is the
accordion convention, it holds the header at a predictable height instead of
reflowing every card below it on each open, and it keeps the post's own words
selectable *outside* the trigger button, where selecting them does not fight the
click.

**The open card's job is the second column.** It used to be a grid of the same
figures the strip now shows, which made opening a card mostly a restatement. It
is now a real `<table>` — metric · **Now** · **movement over the window** — for
all six metrics with engagement summed under a rule. The strip says where a post
stands; this says what it did lately, per metric, which is the one thing no
amount of space on the collapsed card could hold. Around it: the full text, the
tag row, the live line with **Refresh now**, the reading log (windowed, so it and
the card's sparkline describe the same stretch of time), and
stop/resume/delete.

**No chart in the expansion, on purpose.** The standalone sheet on the roster-wide
view draws one because it is one post, alone, with the width for it. Here the
reading log states every moment a number was actually taken — the same truth in
the form that survives at this size — and a recharts instance per open card in a
scrolling panel is exactly the cost this subsystem hand-draws its sparklines to
avoid. The clock (`useSlowTick`) lives in the detail component rather than the
card for the same reason: `AccordionContent` unmounts when closed, so a twenty-post
list runs **one** timer, not twenty.

**The roster-wide Tracked posts view** (`PostsTab`) survives beside it because it
is the only home an orphan has: a pasted link whose author is not on the roster
belongs to no account panel. It also carries the monthly spend ledger.

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

`PostsTable` — still the roster-wide **Tracked posts** view's reading surface,
where the width exists for it — carries the construction of the follower
leaderboard this subsystem used to have, down to the reasons, which outlived it:
real `<table>` semantics, the
interactive element being the excerpt *inside* the first cell (not
`role="button"` on the `<tr>`, which orphans the cells and whose focus ring is
never painted under `border-collapse: collapse`), and one metric selector
re-keying the number column, the rate column and the sparkline together rather
than eight columns of numbers nobody can scan.

**The `trackPosts` switch appears twice** — in the account panel and in the
manage table — and both go through [`useTrackPosts`](../src/components/growth/useTrackPosts.ts),
which owns the toast copy. It says what was armed rather than confirming
silently, because the discipline this feature runs on is that whoever switches it
on sees what they switched on. Two copies of that wording is how one of them ends
up describing a schedule the system no longer runs.

**The Tracked posts page lists only what is being refreshed.** `activePosts` in `page.tsx` filters `isActive` before the tab sees it, and the `stopped` facet is gone with it — every column on that page describes movement, and a frozen row can only mislead. Nothing is deleted: a stopped post keeps its readings and stays on its **account panel**, which lists an account's posts regardless of state and is therefore the one place a post is resumed. That is also the recovery path for a post stopped by the account cascade above.

**Manage accounts** shows the switch per **X** account. Facebook rows show a dash
rather than a disabled switch — post tracking is a capability that platform does
not have here, not a permission the user lacks, and a greyed control would
suggest it could be turned on. `postsWindowSaturated` renders as an amber warning
beside the switch.

## Usage & real cost — what Apify actually billed

> Every figure above this line is an **estimate**. This section is the measured
> one. Both exist on purpose, and confusing them is the mistake this feature was
> built to end.

### Why the estimate was never the bill

`growth-spend/{YYYY-MM}` counts billed results and multiplies by
`UNIT_COST_PER_RESULT`. That number was wrong in three structural ways, none of
them fixable by correcting the arithmetic:

1. **It only counted the tweet actor.** The nightly Facebook and X profile
   scrapes — the larger half of the bill — were never recorded at all, so the
   figure on Tracked posts was a fraction of a fraction.
2. **The unit price was a guess.** $0.00025 was read off a store page. The store
   page and the invoice do not have to agree, and nothing inside our own code
   could tell.
3. **Apify does not only bill per result.** Platform usage rides on the same run
   — compute units, dataset writes, data transfer, proxy. Two runs returning
   twenty rows each cost different amounts if one of them ground for four
   minutes.

So the estimate was replaced rather than repaired. It is still written, and still
what the breaker falls back on, because it is the only figure that exists the
*instant* a call is made — the measured one arrives minutes later.

### The ground truth is the run list

[`apifyUsageService.ts`](../src/lib/services/apifyUsageService.ts) reads three
endpoints, **all of them free account metadata**:

| Endpoint | Gives |
|---|---|
| `GET /v2/actor-runs` | one row per run, with the real `usageTotalUsd` — per-call granularity, bucketable by calendar month |
| `GET /v2/users/me/usage/monthly` | Apify's own **billing-cycle** total, for context |
| `GET /v2/acts/{actId}` | the `username/name` behind a run's opaque `actId` |

The run list is the report; the monthly endpoint is only context. **They are
different windows and the UI says so** rather than reconciling them: a billing
cycle need not start on the 1st, and a gap between the two is itself information
— it means runs are being started by something other than this app.

### RULE 8 — this does not weaken rule 9d

Cross-cutting rule 9d bans calling the Apify API by hand, and it is unchanged.
What it protects against is **actor runs**, which bill per result. Everything
this module calls is metadata and is free and unmetered. Two consequences:

- **Never add a call to this module that starts a run.** It is the one module in
  the subsystem that talks to Apify without spending anything, and that property
  is why it is allowed to be called from a cron and from a dialog's Refresh
  button without a cooldown.
- **It is still not a licence to `curl` `api.apify.com` yourself.** Use the
  actor pages and the API reference, or ask the user.

### Where the numbers surface

- **Manage accounts → Usage** ([`UsageDialog.tsx`](../src/components/growth/UsageDialog.tsx)):
  a wide centred dialog, month-stepped. Three tiles (billed, runs, against last
  month), Apify's cycle line, a hand-drawn per-day bar row, the per-actor
  breakdown, and a log of the last 60 individual runs with a cost on each. The
  button sits on Manage accounts because that is the page where the bill is
  *incurred* — every switch on it adds or removes a nightly scrape.
- **The month-on-month tile compares like for like.** `comparison.toDateUsd` is
  last month summed *only as far into it as we have got into this one*, and that
  is what the percentage is against; `comparison.totalUsd` (last month complete)
  is shown beside it as the record. Seventeen days of September set against all
  of August reads as a 45% saving nobody made, and a cost surface that cries
  wolf once is never read again. It is computed at sync time from the previous
  month's stored snapshot — one document read, no API call — and is `null` when
  no such snapshot exists, which renders as "no record of last month yet" rather
  than as growth from zero.
- **Tracked posts** shows `actualUsd` when it has been synced and falls back to
  the estimate **labelled `est.`**. The bare unlabelled figure is what let a
  guess be read as the bill.

Three details are load-bearing:

- **The month picker is UTC, and is deliberately not `components/salary/MonthPicker`.**
  That control looks identical and steps months in `Africa/Harare` because a
  salary day does (rule 9f). Runs are bucketed by UTC day, so a picker two hours
  out from the aggregation is a bug that appears once a month at the worst
  moment.
- **Nothing is projected.** A month in progress reads as what it has cost *so
  far*, never extrapolated. This is the surface that replaced a made-up number;
  it must not introduce a different one.
- **A run still going counts as a run at $0**, not as a dropped row, so the run
  count matches the log. Its cost lands on the next sync — which is why a month
  is re-synced rather than frozen the first time it is read.

### The breaker now measures money, not predictions

`ledgerSpendUsd()` is `Math.max(estimate, actualUsd)`, and the ceiling is checked
against that. Neither figure alone is safe: the estimate **under-counts** (it
prices results and ignores the platform usage on the same run), and the measured
one **lags** (it is written by a background sync, so a burst of calls reads as
free until the next one). Taking the larger means neither blind spot passes
spending through.

`actualUsd` is the **tweet actor alone**, because that is what the post-tracking
ceiling governs; `actualTotalUsd` is every actor, because that is what a person
means by "what are we paying". Charging the follower scrape against the post
ceiling would trip a breaker over spending it does not control.

### When it syncs

- Both crons call `syncApifyUsageQuietly()` after their work — free, and
  **non-fatal by construction**: the money is already spent by that point, so a
  failed reconciliation must not turn a successful cycle into a 500 the cron
  retries.
- The route serves a stored snapshot for 15 minutes; Refresh forces a live read.
- A live read that fails falls back to the stored snapshot **with the reason
  shown on screen**. A cost dialog that cannot open because Apify blinked is
  worse than a figure labelled with when it was taken.

### Deployment notes

- **`0 */6 * * *` is a third Vercel cron.** The Hobby plan allows two, daily
  only. On Hobby this must become `0 0 * * *` (a one-line change) — the ladder is
  driven by `nextRefreshAt`, not by the schedule, so it degrades to daily
  readings rather than breaking.
- Firestore **rules** (`growth-posts`, `growth-spend`, both denied) and
  **indexes** (one composite on `isActive`+`nextRefreshAt`, plus field exemptions
  for every map/array/free-text field) both changed — see the deploy commands in
  cross-cutting rule 1.
- **`growth-accounts.lastManualRefreshAt` added a field exemption** when the
  manual account refresh shipped. Nothing queries it (rule 9), so it is
  `"indexes": []` like the other non-queried fields on that collection.
  `firebase deploy --only firestore:indexes`.
- **Usage tracking changed rules and indexes.** `apify-usage` and `apify-actors`
  are both denied to clients (the usage document holds spend for the whole Apify
  account), and every field on them — plus the three new `growth-spend.actual*`
  fields — is exempted, since nothing queries either collection by anything but
  document id. `firebase deploy --only firestore:rules,firestore:indexes`.
- **No new env var.** `APIFY_API_KEY` already had to be set; the usage endpoints
  authenticate with the same token, sent as a `Bearer` header rather than a
  query parameter so it never lands in a log line or an error message.
