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
| Cron | `src/app/api/cron/growth-tracking/route.ts` + the entry in `src/vercel.json` |
| Cron | `src/app/api/cron/growth-posts/route.ts` — the post refresh cycle, `0 */6 * * *` |
| API routes | `src/app/api/smm/growth/{accounts,accounts/[id],series}` |
| API routes | `src/app/api/smm/growth/posts`, `posts/[tweetId]`, `posts/[tweetId]/sync` |
| Service | `src/lib/services/growthTrackingService.ts` (follower scrape; owns the two profile actors) |
| Service | `src/lib/services/growthPostsService.ts` (**the only module that calls the tweet actor**) |
| Pure logic | `src/lib/growth/{platform,metrics,signals,postLink,postMetrics,category}.ts` |
| Client hook | `src/hooks/useGrowthTracking.ts` |
| Client hook | `src/hooks/useGrowthPosts.ts` |
| Types | `src/types/firestore.ts` (`GrowthAccount`, `GrowthSeries`, `GrowthSnapshot`, `GrowthPost`, `GrowthPostSnapshot`, `GrowthSpendLedger`) |
| Import script | `src/scripts/import-growth-tracking.js` (`--dry-run`, `--wipe`) — the hand-collected *history* |
| Import script | `src/scripts/import-growth-accounts.js` (`--dry-run`, `--file=`) — the *roster* + categories |
| Migration (one-off) | `src/scripts/recategorise-facebook.js` (`--dry-run`) — splits the retired `FACEBOOK` category into `GENERAL` / `CREATOR`. Delete once run |

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

**Remove is `isActive: false`, not a delete.** Stopping ends the cost and takes the account off the active roster while keeping every reading, and it is one click to resume. `DELETE` exists but only from the stopped list, behind a confirm that names what it destroys — `recursiveDelete` takes the `series` subtree with it, and the scrapers only ever return *today's* number, so deleted history cannot be re-collected.

**Access is one tier.** `checkGrowthAccess(uid)` = `smm-growth-tracking || smm-admin` for reads *and* writes: anyone holding the page may add and remove (confirmed with the user). Page permission, not the admin JWT claim — these routes touch no part of the auth graph.

## The page

**Three full-width surfaces, one on screen at a time** — Overview, Tracked posts, Manage accounts — **plus one account, which is a side panel over whichever of them is showing.** The three are **page state, not routes** (`View` in `page.tsx`): both hooks already hold their whole payload in memory, so switching costs no Firestore read and returning from a detail is instant, where routes would remount the app shell and re-run both fetches for data that is already there (rule 9). The cost is that a view is not linkable — accepted, because nothing here is shared by URL.

**An account is not a `View` variant**, because it does not replace the page. `openAccountId` is its own state and [`AccountSheet`](../src/components/growth/AccountSheet.tsx) renders outside the view switch — it is reachable from the roster grid *and* from the Signals band, and both of those stay on screen behind it.

**Page state means the page owes what a route would have given.** A `<Link>` navigation resets the scroll, moves focus and re-announces the document; `setView` does none of that — focus falls to `<body>` when the clicked control unmounts, so the next Tab restarts at the top of the app shell and a screen reader is never told the main region was replaced. `page.tsx` therefore focuses the new view's `<h1>` on every view change (`tabIndex={-1}`, removed again on blur) and scrolls to top uniformly. Focusing the heading is also why there is **no** `role="status"` line beside it: moving focus to a heading announces that heading, and a live region would say it twice. Any surface that trades routes for page state inherits this obligation.

**The panel body and the post sheet are `next/dynamic`.** They hold the only two recharts charts in the subsystem — the roster's sparklines are hand-drawn SVG specifically to avoid the library — so a static import made every first paint of the overview parse a chart tree it never renders.

**The dynamic boundary sits *inside* the Sheet, not around it.** `AccountSheet` is static and owns nothing but the `Sheet`; `AccountPanel` is the dynamic import. Put the boundary around the Sheet instead and the first click on a card does nothing visible until the chunk lands — this way the skeleton is panel-shaped and slides in immediately. Its `sr-only` `SheetTitle` is load-bearing: Radix names the dialog from that element, and for the frame or two the skeleton stands in there would otherwise be none. On `PostsTab` the standalone post sheet is still mounted behind a latch (`everOpened`) rather than `openPost !== null`, so its chunk is not fetched until a post is opened and the sheet still keeps its close animation.

The layout was rebuilt on 2026-09-09 from a supplied reference design. Its **structure** was adopted wholesale — stat row, Signals band, a grid of account cards, an account detail with post tracking inside it (full-page then; a side panel since — see [the account panel](#the-account-panel)). Its **skin** was not: the reference carried a second typeface (Space Grotesk + Manrope), its own oklch palette, a gradient wash with a pulsing dot, and brand-coloured platform tiles. Each of those is a named rule in [DESIGN.md](../DESIGN.md) — the One-Family Rule, the Semantic-Only Rule, "nothing that asks to be watched", and this subsystem's own greyscale platform marks — so the page renders in the house voice throughout. **This is not a divergence surface; do not reintroduce the reference's chrome.**

### The overview

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

**A panel with two levels, not a page.** It was a full-width page for exactly one reason — `PostsTable` is five columns wide with three sortable headers, and that does not fit a panel. [`PostStrip`](../src/components/growth/PostStrip.tsx) removed the reason, and the panel bought back what a page cannot give: the roster stays on screen behind it, so opening an account is a peek rather than a departure, and moving between accounts does not bounce through an overview you never left. `sm:max-w-2xl`, wider than the post sheet's `max-w-xl`, because this one carries a chart, a control deck *and* a list.

**Clicking a post drills to level two in the same panel — it does not open a second sheet.** Two stacked Radix dialogs would mean two overlays darkening the canvas twice, two focus traps, and an `Esc` that only closes the top one, paid for a panel entirely hidden behind the one in front of it. [`PostDetailSheet.tsx`](../src/components/growth/PostDetailSheet.tsx) therefore exports **two** things: `PostDetailBody` (the contents) and `PostDetailSheet` (the `Sheet` wrapper `PostsTab` still uses). `onBack` is what tells the body which it is — present, it grows a back control and a delete returns to the account; absent, it is the whole panel and a delete closes it. **Never fork the body into a second copy for the nested case**; the two would drift and one of them would end up describing behaviour the system no longer has.

**`account === null` is both the close signal and the reset.** The panel content unmounts with it — the same construction `PostDetailSheet` already used — which is what makes reopening an account always start at the account level instead of wherever the previous visit was abandoned. No effect, no latch, no key juggling.

**Order is an argument about priority, and controls win.** Controls → followers → tracked posts → folded-away facts. The page version had it backwards: its only two decisions (post discovery, and pasting a link) sat at the very bottom, below a table, which put the surface's actions behind its longest read. The one exception to the order is a failed read, which sits directly under the header — it is the only thing that explains why the chart below it has a flat tail, and folding it away would leave stale numbers looking current.

**The range control belongs to the panel, not to the roster.** One account is on this axis, so the window that suits it has nothing to do with the window the grid behind it is showing. It seeds from the page's range and diverges from there; nothing is written back. The follower axis is scaled to the data rather than zero-based — only one account is on it, so the scale can simply be its own.

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

**At panel width they are strips, not a table.** [`PostStrip`](../src/components/growth/PostStrip.tsx)
is deliberately built on `AccountCard`'s construction — a post inside an account
is the same kind of object one level down: a headline number, a rate, and a shape
over time. It **drops** what the card only needed because it sat in a grid: the
author avatar (every post here has the same author, so a column of identical
faces states nothing) and the stacked two-line layout. It **gains** a magnitude
bar — a translucent Action Blue wash widened against the best post *in that list*,
the house ranking idiom, which answers "which of these worked" before a number is
read. A post the scraper has never reported the selected metric for gets **no bar
at all** (`share: null`), never a zero-width one: those would look identical, and
inventing a value for a gap is banned everywhere else in this subsystem.

**The whole strip is the button**, the same call as `AccountCard` and for the same
reason — nothing else is interactive inside it. The table makes the opposite call
only because `role="button"` on a `<tr>` orphans its cells; there is no `<tr>` here.

**The table's three sortable headers become one two-option control** — Top ·
Newest. Those are the two questions anyone asks of an account's posts ("what
worked", "what is happening now"); the table's ascending/descending on three keys
is six orders for a list that is usually under twenty rows. The metric toggle
still re-keys the figure, the rate, the sparkline **and now the bar** together,
rather than eight columns of numbers nobody can scan.

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

**Manage accounts** shows the switch per **X** account. Facebook rows show a dash
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
