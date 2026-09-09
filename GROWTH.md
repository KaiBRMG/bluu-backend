# Post-Level Analytics for Growth Tracking — design (pre-implementation)

> Extends `smm-growth-tracking` from account follower history to **individual X post
> analytics**. This file is the design of record for that pass. It supersedes the
> earlier draft wholesale; §10 records what was cut and why.
>
> Read [growth-tracking.md](documentation/growth-tracking.md) first — this design is
> deliberately shaped to that subsystem's existing rules, not alongside them.

---

## 0. Verdict on the previous draft

The earlier draft was written against an assumed billing model, and the assumption was
wrong in the one place that matters: it treated **the request** as the billed unit
("the base cost is $0.25/1000 tweets, so the full capacity of a request should be
used"). It is not. `kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest`
bills **per returned result**. Filling a request to 1,000 tweets does not amortise
anything — it buys 1,000 tweets and charges for 1,000 tweets.

Everything downstream of that assumption inverted:

| Draft claim | Reality |
|---|---|
| "Bulk lookups use the request's full capacity" | Over-fetching is pure cost. Batch to clear the **per-call minimum**, then stop. |
| Logarithmic decay measured in **hours** (12 refreshes in day one) | ~$7–28/month at a modest roster — **3–12× the entire current scraping bill of $2.35/month**. The ladder is the right idea; the rungs are 10–20× too dense. |
| "Force Sync" per card, 15-minute client cooldown | The most expensive control in the design: a 1-tweet call bills the ~20-result minimum, and a client-side cooldown is not a cooldown (cross-cutting rule 10). |
| Client-side number rolling for a "live" feel | Fabricates readings on a page whose governing rule is *nothing may invent a value*. Cut entirely — §10. |

**The design is feasible.** The actor supports everything the UI needs. But the
cost-control mechanism has to move: it is not scheduling frequency, it is **call
shape** — which of the actor's two entry points is used, and how many items go in each.

Corrected, the whole feature lands at **≈ $1.05–1.60/month** (§3) — and may be close to
cost-neutral, because it can retire part of the existing follower scrape (§4).

---

## 1. What the actor actually is

Sourced from the actor's store page and input schema only — **never from a live API
call** (cross-cutting rule 9d, and the actor's own zero-result behaviour makes
exploratory calls doubly expensive).

**Billing.** Per returned result. The store page advertises **$0.18/1,000 tweets**; the
README says **$0.25/1,000**. Plan every number in this document at the pessimistic
**$0.00025/tweet** and treat any discount as headroom.

**Two entry points, and the difference between them is the whole design:**

| Call shape | Input | Bills | Use for |
|---|---|---|---|
| **Search** | `searchTerms: ["from:handle"]`, `queryType: "Latest"` | `maxItems` per term, floor **20** | **Discovery** — finding posts that exist |
| **ID lookup** | `tweetIDs: [...]` | one result per resolvable ID | **Refresh** — re-reading engagement on posts already known |

`tweetIDs` overrides every other filter when set — including, on the documented
wording, `maxItems`. That is what makes refresh cheap: you pay for exactly the posts you
asked about, with no search minimum attached to the shape of the query.

**Per-result payload — all of it inside the one billed result, so all of it is free:**
`id`, `url`, `text`, `createdAt`, `lang`, `likeCount`, `retweetCount`, `replyCount`,
`quoteCount`, `viewCount`, `bookmarkCount`, `isReply`/`inReplyToId`/`conversationId`,
`isRetweet`/`isQuote`, `media`/`extendedEntities`/card data, and an **author object
carrying `followers`**, `userName`, `name`, `isBlueVerified`, `profilePicture`.

**Documented constraints that shape the design:**

1. **`maxItems` has a minimum of 20**, and it "defines the minimum number of items to
   return, **not a strict limit**" — results may exceed it. **It is a floor, not a
   ceiling.** This is the opposite of `apidojo/twitter-user-scraper`, where
   growth-tracking.md RULE 1.2 leans on `maxItems` as the hard billing cap. That rule
   does not transfer to this actor, and assuming it does is how this feature overspends.
   Cap the bill by **input size** instead: number of search terms, number of IDs.
2. **Zero-result responses are filled with mock data** and still billed, explicitly to
   cover the vendor's infrastructure floor. A failed lookup therefore returns
   *plausible-looking rows*. See RULE 3 — this is a data-integrity hazard before it is a
   cost one.
3. **Pagination is unreliable**; a query returns roughly 20 tweets. The vendor's own
   workaround is narrower time windows, not deeper paging.
4. `since`/`until` are unreliable — use `since_time`/`until_time` (UNIX seconds) or
   `since_id`/`max_id`.
5. Free Apify plans are volume-restricted. **Confirm the workspace's plan before
   implementation** (§11).

---

## 2. Architecture: discovery and refresh are different jobs

The single most important structural decision. The draft conflated them.

**Discovery — one search run per night, batching every opted-in account.**

```
searchTerms:             ["from:acct1", "from:acct2", …]   // one term per opted-in account
queryType:               "Latest"
maxItems:                20                                 // the floor; cannot go lower
include:nativeretweets:  false                              // assertion, not a default
```

One run, `N × ~20` results. This *simultaneously* discovers new posts and delivers a
fresh engagement reading for the newest ~20 posts of every account — the reading is
inside the same billed result. **An account posting ≤ 20/day needs no separate refresh
call for anything in its recent window.**

**Refresh — one ID batch per night for everything that has fallen out of that window.**

```
tweetIDs: [ …the stalest tracked posts, at least 20 of them… ]
```

**Never send a batch smaller than 20.** If only six posts are due, pad the batch with
the next-stalest tracked posts up to 20 — the floor is billed either way, so take the
data. Conversely, never pad *past* what is due: every extra ID is $0.00025 spent on a
number nobody needed.

**Everything else in the feature is one of those two calls.** Manual sync, the "track
this URL" box, the high-volume second pass — all of them route into the same two
batched shapes. There is no third call shape and no per-item request anywhere in the
system.

---

## 3. The cadence ladder, re-rung

The draft's ladder was in hours; the corrected ladder is in days. Modelled at **7
opted-in accounts × ~5 posts/day**, 30-day tracking window (~1,050 live posts at steady
state).

| Age | Draft | Cost/mo | **This design** | Cost/mo |
|---|---|---|---|---|
| 0–24h | every 2h (12×/day) | $3.15 | Nightly discovery + **one** extra ID batch/day | $0.79 |
| 1–7d | every 12h (2×/day) | $3.15 | Nightly, free inside the discovery window | $0.00 |
| 7–30d | weekly | $0.86 | **One** final reading at day 7, then frozen | $0.26 |
| 30d+ | stop | — | Frozen; manual sync only | — |
| **Total** | | **≈ $7.16/mo** | | **≈ $1.05/mo** |

The assumptions are load-bearing and should be re-run against the real roster before
building: $0.00025/result, 7 accounts, 5 posts/day/account. At 20 posts/day the draft
becomes ~$28/month; this design becomes ~$2.90.

**Why day-7-then-freeze rather than a weekly trickle to day 30.** An X post's engagement
is functionally settled inside a week; readings 8–30 buy a flat line for $0.86/month. If
a longer tail is ever wanted, buy it as **one** dated reading at day 30 rather than four
weekly ones — the chart between two known points is drawn by `connectNulls` anyway,
which is already how this subsystem renders sparse history.

**Intraday resolution is optional and priced separately.** One extra ID batch per day,
covering only the genuinely fresh posts (~35 IDs), is $0.26/month. Two is $0.53.
Anything hourly is not affordable at this roster and must not be offered in the UI as
though it were.

---

## 4. The free follower reading (worth designing around)

Every tweet result carries `author.followers`. A search result therefore delivers a
follower count at **$0.00025**, against the **$0.004** the existing nightly
`apidojo/twitter-user-scraper` pays per profile.

For any X account with post tracking on, the nightly discovery run *already contains*
tonight's follower number. Dropping that handle from the profile scrape saves
$0.004/night each — $0.84/month across the seed's 7 X accounts, which is most of this
feature's running cost.

**Do not implement this in the first pass.** Two things must be confirmed first:

- **Is `author.followers` inside a search result live, or a cached/denormalised value?**
  A stale-by-hours follower count silently corrupts the follower series, which is this
  subsystem's primary dataset and carries two months of hand-collected history.
- **What happens on a night an account posts nothing?** The `from:` query returns older
  posts (fine — the author block still rides along), but if it returns *nothing*, the
  mock-data behaviour (§1.2) means the "follower count" received is fabricated.

Verify by running both sources in parallel for a week and diffing, then cut over. Never
cut over on the strength of one matching night.

---

## 5. Rules (mirroring growth-tracking.md RULE 1)

These belong in the new service's header comment and in growth-tracking.md when the
feature lands.

**RULE 1 — `maxItems` does not cap this actor's bill.** It is a floor of 20 that results
may exceed. The bill is capped by **input size**: `searchTerms.length` and
`tweetIDs.length`. Any code treating `maxItems` as a safety ceiling is wrong, and will
look correct right up until it is expensive.

**RULE 2 — two call shapes, both batched, one run each per night.** Search for
discovery, `tweetIDs` for refresh. Never one call per post; never one call per account.
Never a batch under 20 items; never a batch padded past what is due.

**RULE 3 — every returned item must be reconciled against what was requested, and
unmatched items discarded.** Zero-result responses come back as *mock data* and are
billed. An unvalidated parse will therefore write invented engagement numbers into
Firestore, on a page whose stated principle is that nothing may invent a value. Match
`item.id` against the requested `tweetIDs` and `item.author.userName` against the
requested handles; anything else is dropped and logged, not stored. A post that fails to
resolve keeps its previous reading and is stamped `failed` — exactly as a failed account
does today.

**RULE 4 — manual sync is server-enforced and batched.** A client-side cooldown is not a
cooldown (cross-cutting rule 10). Store `lastManualSyncAt` server-side, 429 past the
window, and have a manual sync fetch **that post plus the 19 stalest tracked posts** —
the floor is billed regardless, so spend it on data.

**RULE 5 — circuit breakers, plural.** `MAX_TRACKED_POSTS` mirroring
`MAX_TRACKED_ACCOUNTS`, **plus** a rolling 30-day spend counter in Firestore that halts
the cron and logs loudly when it crosses a ceiling. An account-count breaker alone is
insufficient here: post volume drives this bill, and post volume is not under our
control — an account going viral and posting 60 times a day is a cost event nobody
authorised.

**RULE 6 — RULE 0 of growth-tracking.md still holds.** The tweet-ID/URL parser for the
"track this post" box goes in `src/lib/growth/`. Do **not** import `normalizePostLink`
from `src/lib/smm/linkUtils.ts`, however identical the job looks — that coupling is
explicitly deferred, and this feature is not the place to pre-empt it.

**RULE 7 — never call the Apify API by hand** (cross-cutting rule 9d). Doubly so here:
an exploratory call that returns nothing still bills, and returns mock data that could
be mistaken for a real payload.

---

## 6. Firestore shape

Mirrors the `series/{YYYY}` decision in growth-tracking.md — day-keyed maps, one
document per account per period, so a full view is a bounded number of reads regardless
of how deep the history gets (cross-cutting rule 9).

| Path | Purpose |
|---|---|
| `growth-accounts/{id}` | + `trackPosts: boolean`, `lastPostScrapeAt` / `lastPostScrapeStatus` / `lastPostScrapeError` |
| `growth-accounts/{id}/posts/{YYYY-MM}` | `posts: { <tweetId>: { excerpt, createdAt, url, media, latest, previous, snapshots: { 'YYYY-MM-DD': {…} } } }` |
| `growth-posts/{tweetId}` | Ad-hoc posts tracked by URL whose author is not a tracked account |

**Both new paths must be index-exempt** (`"indexes": []` in `firestore.indexes.json`)
and denied in `firestore.rules` — the subcollection match is explicit; rules do not
cascade. **Both are user-notified changes requiring `firebase deploy --only
firestore:indexes` and `--only firestore:rules`** (cross-cutting rule 1).

**The 1 MB document ceiling is a real constraint here, unlike on the follower series.** A
month document holding 150 posts × ~30 daily snapshots plus full tweet text runs
~400 KB — fine, but not comfortably so, and a high-volume account breaks it. Two
mitigations, both cheap to build in from the start:

- Store a **truncated excerpt** (≤ 200 chars), not full tweet text. The card does not
  render more than that, and `url` links to the real thing.
- Have the writer **split to a per-post document** when a month document crosses a size
  threshold. Detect it at write time; do not discover it in production when a write
  starts failing.

Snapshots store `null`, never `0`, for a metric the actor omitted — `viewCount` in
particular is not reliably present. A zero draws a cliff to the axis; a null draws a
gap, which is the truth. This is the same rule the historical importer already follows
for blank spreadsheet cells.

---

## 7. UI

The draft's layout was invented in isolation. This page already has a visual language —
greyscale field with one Action Blue highlight, table-as-legend, segmented controls
inked in-component — and DESIGN.md plus cross-cutting rule 13 constrain what may be
used. Match it.

**Tabs become three: Overview · Posts · Manage Accounts.** Names in the app's register;
"Command Center" and "War Room" are not.

**Manage Accounts** gains a **Track posts** toggle per account, alongside the existing
active/stopped control. Off by default. The row shows what tracking that account costs
per month at its current posting rate — this feature's whole discipline is that the
person turning it on can see the price.

**Posts tab is a table, not a masonry grid:**

- Same construction as `GrowthLeaderboard` — real `<table>` semantics, sortable headers,
  and the interactive element being the **post excerpt inside the first cell**, not
  `role="button"` on the `<tr>` (which overrides the row role, orphans the cells, and
  whose focus ring is never painted under the `border-collapse: collapse` Tailwind's
  preflight sets). That lesson is already paid for; don't re-learn it.
- Columns: excerpt · author · posted · likes · reposts · replies · views · a
  **`<Sparkline>`** of total engagement. Reuse
  [`src/components/growth/Sparkline.tsx`](src/components/growth/Sparkline.tsx) — it
  already draws a dashed hairline for a single point rather than a flat line implying a
  measurement.
- A masonry grid of ~1,000 cards is a scroll wall with no sort, no comparison and no
  keyboard path. Cards lose to a table here on every axis except novelty.
- Row click opens a detail sheet built like `AccountDetailSheet` — full engagement
  chart, per-metric series, and the reading log including failures.

**Track a post by URL** — a single input, matching the account-add flow: **all or
nothing**. A URL the actor cannot resolve **writes nothing** and reports why. A typo
that becomes a document bills every night forever while showing an empty chart, which is
precisely the failure the account-add route was built to prevent.

**Freshness is stated, never simulated.** An "as of 00:12" stamp plus a measured
velocity (`+240 likes/day since the last reading`) — a derived statistic, honestly
labelled, not an animated counter. Colour-code freshness against the **actual nightly
cadence** by reusing `isStale` / `STALE_AFTER_HOURS`; the draft's "green if < 1 hour"
would be green approximately never and would read as a permanent fault.

---

## 8. Backfill: there is none

Like followers, engagement counts are only ever readable as *today's* value. A post
added to tracking on day 10 has no history for days 0–9, and no amount of money buys it
back. Two consequences, both already established patterns here:

- A newly tracked post reads **"First reading tonight"**, not an empty chart.
- Deleting tracked history is irreversible, and the confirm must say so — exactly as the
  account delete does.

It also means **turning tracking on is the cheap decision and leaving it off is the
expensive one.** If an account is plausibly interesting, tracking it from now costs
~$0.15/month; deciding in November that October was wanted is impossible at any price.
Worth saying out loud in the Manage tab.

---

## 9. High-volume accounts

Discovery returns ~20 posts per query and pagination is unreliable, so an account
posting more than ~20/day cannot be fully discovered by one nightly query — posts will
be missed, and *silently* is the problem, not *missed*.

- **Detect it:** if a discovery query returns 20 results and the oldest is younger than
  24h, the window was saturated. Flag the account in the Manage tab as **"posts faster
  than one nightly read can see"**.
- **Fix it per-account, not globally:** a second discovery run for flagged accounts
  only, windowed with `since_time`. Cost is one more ~20-result term per flagged account
  per run — $0.15/month each. Do not raise the cadence for the whole roster to fix one
  account.
- **Do not attempt deep pagination.** The vendor documents it as unreliable, and an
  unreliable paginated fetch is billed exactly like a reliable one.

---

## 10. Cut from the draft, and why

**Client-side number rolling (draft Strategy 2) — cut entirely.** It renders numbers the
system has not measured, then "quietly auto-corrects" them later. That runs directly
against this subsystem's governing rule — *"Gaps are the normal case, and nothing may
invent a value for one"* (`connectNulls`, `deltaFor` returning `null`, the dashed
single-point hairline) — and against DESIGN.md's honesty conventions. Three further
problems, any one disqualifying on an internal decision-making tool:

1. Engagement velocity **decays sharply**; linear extrapolation across a nightly gap
   overshoots badly, and the correction lands as a visible drop that reads as data loss.
2. A screenshotted, quoted or reported number would be fabricated, with nothing on
   screen distinguishing it from a measured one.
3. It makes the cheapest cadence *look* like the most expensive one, destroying the only
   feedback loop pushing anyone to keep the cadence cheap.

Replaced by §7's stated freshness and measured velocity — more useful, cheaper to build,
and true.

**Per-card Force Sync with a client cooldown — replaced** by RULE 4's server-enforced,
batched manual sync.

**"Use the full capacity of a request" (draft Strategy 3) — inverted.** The instinct to
batch was right; the reason was wrong. Batch to clear the 20-result floor, not to fill a
notional request capacity that does not exist.

**Masonry card grid — replaced** by the table in §7.

**Hourly decay ladder — re-rung** in days, per §3.

---

## 11. Open questions — answer before implementation

1. **Apify plan tier.** The actor restricts volume on free plans. Which plan is
   `APIFY_API_KEY` on, and does the effective rate land at $0.18 or $0.25/1,000?
2. **Does `tweetIDs` bypass the `maxItems` floor?** The schema says `tweetIDs` overrides
   all other filters; whether "all" includes `maxItems` decides whether a 6-ID refresh
   bills 6 or 20. This design already assumes the pessimistic 20 (RULE 2's padding
   rule), so nothing breaks either way — but confirming it is worth one careful call at
   implementation time, batched with real work rather than run as an exploratory probe.
3. **Is `viewCount` populated** for these accounts' posts in search results, or only in
   the authenticated author's own view? Decides whether views can be a headline column
   or must be a nullable secondary one.
4. **Is `author.followers` in a search result live?** Gates §4's saving, which is most of
   the feature's running cost.
5. **Roster size and posting rate.** How many of the 7 X accounts get post tracking, and
   how often do they actually post? Every number in §3 moves linearly with both.
6. **Retention.** Do frozen posts stay in the Posts table forever, or drop off after 90
   days? Affects read cost and the month-document ceiling, not scrape cost.

---

## 12. Documentation this change will touch

Part of the change, not a follow-up (cross-cutting rule 11).

- **[growth-tracking.md](documentation/growth-tracking.md)** — RULE 1's cost table gains
  the tweet actor; §5's rules go in verbatim; the Firestore table gains both new paths;
  a new "Post analytics" section covering discovery-vs-refresh.
- **[CLAUDE.md](CLAUDE.md) cross-cutting rule 9d** — currently pins only the profile
  actor's hazards (`getFollowers`/`getFollowing`/`getRetweeters`, `maxItems` as a
  ceiling). It must gain the tweet actor's *different* hazards: `maxItems` is a floor
  here, and zero-result runs bill and return mock data.
- **[DESIGN.md](DESIGN.md)** — only if the Posts table introduces a pattern the design
  system does not already carry. It probably does not; the table is `GrowthLeaderboard`'s
  construction.
- **Firestore rules + indexes** — notify the user with the deploy commands
  (cross-cutting rule 1).
