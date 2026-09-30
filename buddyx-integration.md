# BuddyX API — Integration Assessment

What the BuddyX Public API ([`buddyxapi.yaml`](buddyxapi.yaml)) can give Bluu Backend: data that replaces or strengthens what we have today, and data that could expand the system.

**Status:** assessment only. Nothing is built. The API has **not** been called — everything here is read from the spec, and anything marked *unverified* needs a real payload or an answer from BuddyX.

---

## Background: what the current system needs

Chat-agent salary is derived from `ca-sales` ([ca-salary.md](documentation/ca-salary.md)). Today each sale is one row of the CRM's `.xlsx` export, uploaded at CA Admin and parsed by [`salesImport.ts`](src/lib/salary/salesImport.ts). The required columns ([`salaryConstants.ts`](src/lib/salary/salaryConstants.ts)) are:

`Date & time Africa/Harare` · `Employee` · `Email` · `Creator` · `Fan` · `Fan ID` · `Earnings` · `Gross revenue` · `Net revenue` · `Type` — plus optional `Status` (`Complete` / `Reverse`), `Rule` and `Assigned by`.

The salary engine sums only `signedGross`, and a reversal is counted as a negative sale.

---

## 1. Data that maps onto the current system

### The sales rows

Two paginated list endpoints together replace the export:

- `GET /v1/public/team-reports/ppv-revenue` — one row per unlocked PPV.
- `GET /v1/public/team-reports/tips` — one row per tip, with the chatter it was assigned to (or `null`).

| Current field | BuddyX source |
|---|---|
| Sale id | `id` on each row. Could replace the SHA-1 hash we use to avoid double-counting on re-import — *if the id is stable (unverified)*. |
| Time | `unlockDate` (PPV), `datePurchase` (tips). ISO timestamps; `toDayKey` can take them directly. |
| Agent | `chatterId` / `chatterName`. `/team-members` maps them to `email`. |
| Creator | `modelId` / `modelHandle` |
| Fan ID | `fanId` |
| Gross / Net | `revenue` (PPV) / `amount` (tips), each `{ gross, net }` |
| Type | Implicit: `ppv-revenue` = PPV unlocks; `tips.type` = `tips_messages` / `tips_posts` |

### Identity mapping (fixes two known problems)

- **Agents.** `GET /v1/public/team-members` returns `id`, `name`, `email`, `status`, `timeZone`. Map each chatter to a user once and store a `buddyxChatterId` on the user. `SALES_EMAIL_MAP` and `buildUserResolver` can then be deleted — the exit path [ca-salary.md §13](documentation/ca-salary.md) already describes.
- **Creators.** `GET /v1/public/creators` returns `id` (the OnlyFans userid), `handle`, `customName`. Storing that id on each creator doc fixes [ca-salary.md §11c](documentation/ca-salary.md), where sales are joined to shifts by a typed creator *name*. It also settles the open sub-account question in §2 of that spoke: each OF account has its own `modelId`, so a sub-account's revenue can never be reported under its parent.

### Gaps to settle before building

1. **No reversal / refund status anywhere in the spec.** The engine depends on reversals being negative. If a refunded PPV simply disappears from `ppv-revenue`, a sync that only adds or updates rows will keep paying commission on it forever. The sync would have to re-fetch whole windows and delete rows no longer returned. **Ask BuddyX how refunds and chargebacks appear. This is the blocker** — without it the API cannot safely replace the `.xlsx` for payroll.
2. **`Rule` and `Assigned by` have no equivalent.** The closest thing is unassigned tips (`chatterId: null`, filterable with `onlyUnassigned=true`). Someone still has to decide who gets those, which fits the existing Sale Disputes flow.
3. **No fan name** — only `fanId`. The link-fans endpoints return `fanName`, but only for fans who came in through a tracking or free-trial link.
4. **Other revenue types.** Only PPV and tips are attributed to a chatter. If the old export's `Type` column also carried paid posts, streams, etc., confirm whether those are included in `ppv-revenue`.
5. **Rounding.** The spec warns that summing per-row `net` drifts by up to ±$0.005 a row. Today we store each row's net as given. Anything that totals net should total gross and derive `net = round2(Σ gross × 0.8)` once.

### Reconciliation (replaces the dry-run preview)

`GET /v1/public/team-reports/overview` returns exact server-side per-chatter `revenue` and `tips` totals. Checking our summed rows against it after every sync is a stronger guard than the current skip report, because it catches rows that went missing silently.

---

## 2. Existing subsystems it could strengthen

| Subsystem | BuddyX data | Use |
|---|---|---|
| **Time tracking / wage** | `onlineMs` per chatter from `team-reports/overview` (counted once when online under several creators at the same time) | Compare CRM online time with clocked-in hours. Wages are paid on hours, so this is the strongest new check: "clocked in 8h, online in the CRM 3h" becomes a line in the payroll attention band. |
| **Shifts / coverage** | Team-member flags `allCreatorAccess`, `onlyShiftAccess`, `needsShiftApproval` | There is no shifts endpoint, but restricted members are visible. With `modelId` on creators, sales can be checked against the accounts on the agent's shift ("sold on a creator not on their shift"). |
| **Sale Disputes** | `GET /v1/public/fan-conversation` — the full two-way thread for one creator + one fan, with who sent each message | Evidence for a dispute: the reviewer sees the conversation that produced the sale. History starts **2026-06-10**. |
| **CA Admin Overview** | `GET /v1/public/creators/earnings-breakdown` — per creator: revenue split into messages / subscriptions / tips, `newSubs`, `massMessages`, `revShare`, `revShareAmount` | The leaderboard only sees chatter-attributed sales today. This adds subscription revenue and each creator's total, so you can see what share of a creator's income the chat team produces. |
| **Campaigns & custom requests** (BFE / Hubby / VIP) | `fan-conversation` + `ppv-revenue` filtered by `fanId` | A campaign entry is for one specific fan. The conversation shows whether the content was delivered and at what price; `ppv-revenue` shows whether it was paid for — an automatic Paid/Delivered status with revenue attached. **Snag:** `campaign-tracking` stores a `profileLink`, not the fan's OF userid, so the id would need parsing from the link or recording by the agent. |
| **Growth Tracking** | Tracking links: `countTransitions` (clicks), `countSubscribers`, `cost`, `metrics.revenue`. Free-trial links: `claimCounts`, `metrics.revenue`, `stackersCount` | Closes the loop from social post → click → subscriber → revenue. If SMM gives each Twitter account its own tracking link, Growth Tracking can show revenue and ROI, not just followers. |

---

## 3. New capabilities

- **Chatter performance dashboard** from `team-reports/overview`: unlock rate, PPV rate, fans chatted, total messages, and median / p75 first-reply time. Revenue ÷ `onlineMs` gives revenue per online hour. Could support bonus tiers alongside the commission ratchet.
- **Reply-time alerts.** `p75ResponseTimeMs` exists to catch "fast on average, but a quarter of fans are left waiting". Fits the existing 5-minute CA notification cron.
- **Message QA / compliance.** `GET /v1/public/messages` supports text search and `unsentOnly`, and records who unsent each message — keyword audits (off-platform payment requests, banned phrases) and an unsent-message trail. `GET /v1/public/mass-messages` adds price, sender and unsent data for broadcasts.
- **Fan value / whale tracking.** `GET /v1/public/subscribers` gives each subscription event (new / returning / trial, whether it came from a free trial, whether the subscriber is a creator). Link fans carry `totalSpent` before and after joining. Enough for fan lifetime value and "top spenders per creator" lists for agents.
- **Promo ROI.** Cost vs revenue per link, and a check on "stackers" (fans claiming several free-trial links).
- **Rev-share payouts.** `revShareAmount` is what each creator is owed for a period. Nothing in the codebase uses rev share today, so this would be entirely new — a creator earnings statement. Sensitive: admin-only unless it is deliberately exposed in the Telegram creator portal.

---

## Constraints that shape any build

- **No webhooks — polling only.** 120 req/min per key; the two aggregate endpoints (`earnings-breakdown`, `team-reports/overview`) are 30 req/min and count against both limits. Lists are cursor-paginated, max 200 rows a page. That points to a Vercel cron (where scheduled work already lives) walking windows sequentially, honouring `Retry-After` on a 429.
- **Inactive creators disappear.** A creator whose BuddyX extension has not reported for 7 days returns `MODEL_INACTIVE` on per-model endpoints and is silently left out of `earnings-breakdown`. This must surface as a visible warning — like unmapped emails do today — or that creator's agents look like they had zero days.
- **App-only activity.** Messages, mass messages and conversations only cover activity sent through the BuddyX app.
- **Keys.** Max 3 active keys per manager account. The key is a server-only secret (cross-cutting rule 10): env var, never written to `users/{uid}` or sent to the renderer.
- **Don't explore it by hand.** Nothing says calls are billed, but treat it like the OnlyFans and Apify APIs (rules 9b / 9d): work from the spec, and ask for a real payload for anything it doesn't answer. One exploratory loop can exhaust a rate-limit window.

---

## Open questions for BuddyX

1. How do refunds, chargebacks and reversed PPVs appear? Do rows disappear, change, or get a status?
2. Is the row `id` on `ppv-revenue` and `tips` stable across calls?
3. Does `ppv-revenue` include paid posts, streams or other paid content, or only PPV messages?
4. How far back does `ppv-revenue` / `tips` history go (for backfilling finalised months)?
5. Can a tip's `chatterId` change after the fact (e.g. reassigned in the dashboard)? If so, how far back must a sync re-read?
