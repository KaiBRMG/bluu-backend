# SMM Portal

> The Social Media Management teamspace (`smm-portal`): Twitter/X account management, a per-user content schedule (week calendar), and a periodic bonus system with server-calculated payouts. Modeled after the CA Portal.

## Dependencies / Interacting Files

| Layer | Location |
|---|---|
| Pages | `src/app/(main)/smm-portal/{dashboard,admin,xaccounts}/page.tsx` |
| API routes | `src/app/api/smm/**` |
| Service | `src/lib/services/smmService.ts` |
| Pure logic | `src/lib/smm/{bonusCalc,linkUtils,format}.ts` |
| Client hooks | `src/hooks/useSmm{Accounts,Posts,Bonus,Users,Suggestions}.ts`, `src/hooks/useAuthFetch.ts` |
| Components | `src/components/smm/{shared,dashboard,admin,xaccounts}/*` |
| Migration | `src/scripts/backfill-smm-link-normalization.js` (`--dry-run`) — **one-time**, recomputes `postLinkNormalized`/`originalLinkNormalized` on every post and submission after `normalizePostLink` switched to status-id identity. Idempotent; until it runs, link lookups miss pre-existing rows |
| Import script | `src/scripts/import-twitterx-management.js` (`--dry-run` supported; idempotent — an account that already exists is **merged into**, not duplicated: `assigned` is filled in and sheet types are appended) |
| Types/constants | `src/types/firestore.ts` (`Smm*`, `SMM_ACCOUNT_TYPES`, `SMM_NETWORKS`) |

The teamspace + pages are registered in `src/lib/definitions.ts` (`smm-portal`, `smm-admin`, `smm-dashboard`, `smm-xaccounts`); the `SMM` group is in `groupService.ts` / `src/types/firestore.ts`. **Pages are invisible until an admin shares `smm-admin`/`smm-dashboard`/`smm-xaccounts` with the SMM group via the Sharing UI** — see [permissions.md](permissions.md).

---

## Firestore Collections (first subcollections in the repo)

| Path | Purpose |
|---|---|
| `twitterx-accounts/{accountId}` | Twitter/X accounts. `type: string[]` (multi-select), `network` (drives the bonus only when the account is a post's **source**), `tier` (1\|2\|**null**), `isViralBonus: boolean`, `suggestedBy` (uid\|null — earns the $2 share), `assigned` (uid\|null), `status` (active\|inactive), `lastUpdatedTime`/`lastUpdatedBy` stamped on every write |
| `twitterx-content-schedule/{accountId}/posts/{postId}` | Scheduled posts. **Subcollection** — the parent doc is never created. `bonusSubmission: boolean` is flipped to `true` when the post is submitted for a bonus (drives the calendar card's 💰). `isViralCopy`/`originalLink`/`originalLinkNormalized`/`originalAcc` record the copy declaration made at upload time. `postDate` carries a **time of day**, not just a date. No `mediaCode` — it was removed |
| `twitterx-bonus/{roundId}` | A bonus round. `userTotals: map<uid, number>` |
| `twitterx-bonus/{roundId}/submissions/{id}` | Bonus submissions. `isResidual: true` marks an auto-created **3️⃣ share** — filed by the system for its recipient, not submitted by them |
| `twitterx-page-suggestions/{id}` | Viral-page nominations from the Viral Accounts page. `accountName` (handle, derived server-side from `accountLink`), `submittedBy`, `submissionDate`, `isApproved`, `isRejected` — the pending list queries the two booleans |

All access is via Admin SDK API routes; `firestore.rules` denies client read/write on all five (subcollection matches are explicit — rules don't cascade).

**The current round** is the round whose window *contains today* (`getCurrentRoundSnap`: newest round starting on or before now, kept only if it hasn't ended), falling back to the latest round by `roundDateStart` when none is live. Bonus Management's header is a **round picker** over every round; `bonus/current?roundId=` views any of them (uncached — only the default round is cached).

### The tier ⇄ 'Bonus' invariant
`tier` is meaningful only on a **bonus account** (its `type` contains `'Bonus'`), because tier drives nothing but bonus payouts. `resolveTier()` in `smmService.ts` is the single source of truth, applied by both the create and update handlers **against the merged document** (a PATCH may change `type` or `tier` alone):
- type contains `'Bonus'` → a tier (1 or 2) is **required**; a missing one is a 400.
- otherwise → the tier is **forced to null**, not rejected — dropping `'Bonus'` from an existing account must not fail over a tier the admin never touched.

The UI mirrors this with the shared `TierField` (greyed out with *"Only bonus accounts can have a tier, set this in Type"* until 'Bonus' is selected; blocks save when a bonus account has no tier), and the Account Database hides the tier cell entirely on non-bonus rows.

`isViralBonus` is a **different axis** and is often confused with the `'Bonus'` type: `'Bonus'` = this account may *submit* for a bonus; `isViralBonus` = SMMs may *copy viral posts from* this account (it is what the Viral Accounts page lists, and the gate `POST /api/smm/posts` enforces on every copy declaration).

`suggestedBy` is **read-only everywhere in the UI** — it is stamped only by suggestion approval and is deliberately absent from the account PATCH allowlist, so it cannot be reassigned by hand. `AccountDialog` renders it as a **Suggested by** field under the Viral account field in *both* modes (admin edit and dashboard view) for that reason.

### Denormalization (frozen at write time)
- `posts.accountName` — denormalized from the account so calendars/tables render without an account read. On account rename, the PATCH route fans the new name out to the account's posts (chunked batches). Bonus submissions keep their frozen copies by design.
- `posts.postLinkNormalized`, `posts.originalLinkNormalized`, `submissions.postLinkNormalized`/`originalLinkNormalized` — `normalizePostLink()` output (the tweet's status id — see Gotchas), stored so link lookups can use equality queries (Firestore can't suffix-match). **Always** recomputed at every write boundary that sets the link. Changing `normalizePostLink` invalidates every stored value → re-run the backfill script.
- `posts.sourceAcc`/`sourceAccName` — the creator page the content was uploaded from. **Never entered by hand and never editable**: it is *derived* from the viral-copy declaration — the account the original post lives on, looked up from the pasted link by `resolveOriginalAccount()` — so it always equals `originalAcc`. A post that is not a copy has no source (⇒ network `'Other'` ⇒ no network bonus). Posts created before this change may still carry a hand-picked source that differs from `originalAcc`; the submission route handles both.
- `submissions.network`/`sourceAcc`/`sourceAccName`/`tier`/`accountName` — frozen at submission time so later account/post edits never change historical bonuses.

### Indexes (`firestore.indexes.json`)
First `COLLECTION_GROUP` indexes in the repo: `posts (postedBy, postDate)` asc + desc; `fieldOverrides` enable single-field collection-group equality on `posts.postLinkNormalized`, `posts.originalLinkNormalized` and `submissions.originalLinkNormalized`, and a **collection-group range on `posts.postDate`** (asc + desc) for the admin Content Schedule's all-users week query. Per-round submission and per-account post queries are single-equality COLLECTION scope (auto-indexed).

---

## API Routes (all `withAuth` + `checkSmmAccess`)

`checkSmmAccess(uid, 'dashboard'|'admin'|'either'|'viral')` (in `smmService.ts`) gates on `permittedPageIds` — the same mechanism as `checkPageAccess`, NOT the admin JWT claim (these routes only touch SMM data). `isSmmAdmin(uid)` widens ownership checks for admin-page users.

| Route | Gate | Ownership |
|---|---|---|
| `accounts` GET `?scope=mine\|active\|viral\|all[&network=]` | mine/active: either; viral: xaccounts (or admin); all: admin | mine = `assigned==uid` + active; `all&network=` filters one group (single-equality, auto-indexed) for the admin database's lazy load. **`viral` resolves `suggestedByName`/`suggestedByPhotoURL`, not `assignedName`** — that page shows the suggester; `all` resolves both |
| `accounts/resolve` GET `?link=` | either | `{ exists }` or `{ exists, accountName, active, mine }` — `findAccountByHandle` (one `in`, `limit(1)`). Never returns the `assigned` uid. Only powers the schedule dialog's error copy; no authorization decision rests on it |
| `accounts` POST, `accounts/[id]` PATCH/DELETE | admin | DELETE also `recursiveDelete`s the posts subtree |
| `posts` GET `?view=week\|all`, `?accountId=` | dashboard (accountId: either) | own posts; inactive-account posts filtered out server-side |
| `posts` GET `?view=week&scope=all` | admin | **every** user's posts in the range, with `postedByName`/`postedByPhotoURL` resolved — powers the admin **Content Schedule** calendar. Pure `postDate` range on the `posts` collection group — needs the `posts.postDate` **COLLECTION_GROUP** single-field override (collection-group single-field indexes are NOT auto-created) |
| `posts` POST, `posts/[accountId]/[postId]` PATCH/DELETE | either | `postedBy==uid` unless admin-page user; account must be active + assigned. Link rules (POST always, PATCH only when `postLink` changes): handle must match the account, must not equal the original link, must not already exist (**409**) |
| `posts/check-link` GET `?link=[&excludeAccountId=&excludePostId=]` | either | `{ duplicate }` only — one keys-only collection-group equality, `limit(2)`. The live check behind the Post link field; advisory, re-run on write |
| `bonus/current` GET `?scope=me\|all[&roundId=]` | me: dashboard; all: admin | me = own submissions + own total; `all` also returns `rounds` (every round's window) for the picker |
| `bonus/rounds` GET/POST | GET per scope; POST admin | |
| `bonus/rounds/[roundId]/totals` PATCH | admin | absolute payout override |
| `bonus/rounds/[roundId]/submissions/[submissionId]` PATCH/DELETE | admin | applies the totals delta (below) |
| `bonus/eligibility` GET `?link=` | dashboard | advisory — re-checked when the **post is created**. Also returns `handle` + the resolved `account` (`{id,name,network,isViralBonus}` or `null`) so the dialog can show the source and block an unknown **or non-viral** one |
| `bonus/submissions` POST | dashboard | own post; account type must contain 'Bonus' and carry a tier; server computes everything |
| `suggestions` GET | admin | pending viral-page nominations |
| `suggestions` POST | viral | submitter + timestamp + handle all derived server-side |
| `suggestions/[id]` PATCH | admin | approve (flag `isViralBonus`, optionally create the account) / deny |
| `users` GET | admin | non-archived SMM group members |

---

## Bonus system

### Calculation (`src/lib/smm/bonusCalc.ts` — pure, server-only)
`calculateBonus({tier, network, numLikes, postDateMs, submissionDateMs, hasOriginalLink})` → `{bonusAmount, status, sysComments}`.

**The two inputs come from two different accounts** — the single most confusable thing in this subsystem:
- `tier` ← the **page the SMM posted on** (`accountId`). Only bonus accounts are tiered.
- `network` ← the **creator page the content was uploaded from** (`post.sourceAcc`, i.e. the account the copied original lives on). The manual pays the network bonus for uploading *from* the inhouse / X managed / twink lists, so it is a property of the source, not of your page. No recorded source — which now means "not declared as a copy" — ⇒ `'Other'` ⇒ no network bonus.
- `hasOriginalLink` ← the post's stored viral-copy declaration.

Pipeline:
1. **Target bonus**, evaluated highest-first. Tier 1: 35k→$25 / 20k→$10 / 10k→$5; Tier 2: 35k→$15 / 20k→$7 / 10k→$3 (windows 7d12h / 5d12h / 3d12h). No rule matched ⇒ `❌ Late submission`, $0, STOP (no network bonus on late).
2. **Viral halving** if `hasOriginalLink` and qualified — applied BEFORE the network step, so the network add-on is never halved.
3. **Network** (of the *source* creator): Inhouse **+$3**, X Managed **+$1**, Twink **+ half of the _Tier 1_ amount for the threshold that was met** — an addition, and always measured against Tier 1 whatever tier the posting page is ("you will get half of the Tier 1 bonus").

**The +12h on every window is deliberate.** The manual states the targets in whole days ("within 3 days"); the extra half-day is a *filing* grace so a post that hit its target on day 3 can still be submitted the next morning. Confirmed with the user — do not "correct" `TIER_RULES` to bare multiples of a day.

**Likes are measured once, at submission.** A post that passed 10k inside 3 days but is only submitted on day 8 with 35k matches no rule and pays $0 — the engine cannot know what the count was earlier. Inherent to single-snapshot submission.

### The one share paid to another SMM
- **Rule 3️⃣ — page-suggestion share.** A flat `SUGGESTION_SHARE` ($2) to `sourceAccount.suggestedBy` — the SMM whose approved page suggestion added that creator — for every qualifying post another SMM uploads from it. Never paid to the submitter themselves. Written as its own `isResidual: true` submission doc so an admin approves it on its own merits. `suggestedBy` is stamped on the account when a suggestion is **approved**, and the first approved suggestion owns the page (never overwritten).

**Rule 6️⃣ pays no share.** Copying halves the *copier's* bonus and stops there — the owner of the copied page receives nothing. (An earlier build also wrote a residual submission paying them the halved amount; that was removed as it is not in the bonus manual.) `originalAcc` is still recorded on the post and submission for audit, but its account doc is never read at submission time.

> ⚠️ **Rule 2️⃣ currently only fires on a viral copy.** `sourceAcc` is derived *solely* from the copy declaration, so a post scheduled with "No" has no source ⇒ network `'Other'` ⇒ **no network bonus and no 3️⃣ share**, even if its content came from an Inhouse creator. The manual reads 2️⃣ as independent of 6️⃣. This is a **known, accepted divergence** (confirmed with the user) — closing it needs a way for a non-copy post to record the creator page its content came from. Do not treat it as a bug to be quietly patched.

### Scheduling a post is a two-step flow
`CreatePostDialog` (**step one**) → `ViralCopyDialog` (**step two**), orchestrated by the dashboard page.

- **Step one writes nothing.** It collects post link / date+time / caption, validates the link (below), and hands a `PostDraft` up to the page. Its primary button is **Next**, not Schedule.
- **Step one has no account picker either.** Like step two, the handle comes out of the pasted link (`extractAccountHandle` → matched with `linkMatchesHandle`/`accountHandle` against the `accounts` prop, i.e. the caller's own active pages) — client-side, since the caller already holds those docs. A match renders the resolved account inline (check + name + `NetworkBadge`) and unblocks Next; `draft.accountId` is re-derived from the restored link, so it is not form state. The old dropdown-vs-link mismatch error is gone with the dropdown.
- **A miss is ambiguous, so it is disambiguated server-side.** The dialog holds only the caller's *own* accounts, so "no such account" and "someone else's account" are indistinguishable locally — and `assigned: null` pages are common. `useSmmAccountResolve` → `GET /api/smm/accounts/resolve?link=` is fired **only after the local match fails** (debounced, module-cached by handle) and picks one of four lines: **inactive** → ask to reactivate; **exists but not `mine`** → ask to be assigned; **exists, mine and active** (so its `accountLink` disagrees with its `accountName`, or the 5-min account cache predates the assignment) → reload/fix the link; **absent or lookup failed** → "not in the database". Copy only — Next is blocked by the failed local match either way, and `POST` re-checks ownership.
- **Step two creates the post.** "Did you copy another viral post?" — **"No"** schedules an ordinary post; a verified copy schedules one carrying the declaration. Both answers route through `onAnswered`, which calls `POST /api/smm/posts`. On failure the dialog **stays open** (the draft only lives in memory) and toasts.
- **Back** returns to step one with the draft intact — the page holds `draft` in state and `CreatePostDialog` seeds its form from it. The form is mounted only while the dialog is open (`{open && <PostForm/>}`), so state is initialized once per opening instead of being synced by an effect.
- Order matters for the link checks: step one knows the post link but not the original, so **"post link = original link" is caught in step two**, where both are known.

### The viral-copy declaration happens at UPLOAD time
The copy question is part of *scheduling*, not of applying for a bonus. Rationale: the 2-week source rule is only actionable while the SMM can still choose a different source.

- **The account is never typed in.** `extractAccountHandle()` pulls the handle out of the pasted link and `findAccountByHandle()` resolves it against `twitterx-accounts` (three casings in one `in` query — the sheet import is upper-case). That account is *both* the copy's origin and the post's `sourceAcc`, so it is what pays the network bonus; letting the SMM pick it by hand would let them point a post at a better-paying network.
- The dialog runs `bonus/eligibility` (which returns `handle` + the resolved `account`) and shows **"✅ Eligible"**, **"⚠️ Already Used Recently"**, **"⚠️ Account Not Found"**, or **"⚠️ Not a Viral Account"**. Any of the last three **blocks** the copy — the SMM picks another source or answers "No" and schedules an ordinary post. **A handle that isn't in the database is a hard stop**, not a sourceless post.
- **Three gates, in this order:** the handle resolves to an account → that account has `isViralBonus` → the source is older than two weeks. The first two win over the age rule, and "not in the database" is kept distinct from "not a viral account" because the fixes differ (ask an admin to add it vs. contact your team leader).
- **Only a listed Viral Account may be copied from.** Un-ticking `isViralBonus` retires a page for everyone immediately — enforced in `POST /api/smm/posts` (400), mirrored advisorily in `ViralCopyDialog`. Posts already recorded against a retired page keep their source and still pay out.
- `POST /api/smm/posts` **re-runs all three checks** (`checkViralEligibility` + `resolveOriginalAccount` + its `isViralBonus`) and only then stores `isViralCopy`/`originalLink`/`originalAcc`/`sourceAcc`. It takes only `originalLink` from the client — no account id is accepted from the browser at all.
- `findLinkUsage` searches posts by `postLinkNormalized` **and** by `originalLinkNormalized`, plus submissions by `originalLinkNormalized` — a source claimed by another SMM's *upload* counts as used straight away, not only once their bonus is filed.
- The post PATCH allowlist deliberately **excludes** the viral fields **and `sourceAcc`**, so neither the copy nor the network it pays can be changed after the fact. An account move copies the whole doc, so the declaration follows the post.

### Submission flow (`bonus/submissions` POST)
Load post (must be caller's) → load account: **type must contain 'Bonus'** and its tier must be 1 or 2 (else 400 — the dashboard shows the same "not a bonus account" dialog before opening the wizard) → require now within the current round window (else 400) → read the viral-copy declaration **off the post** (never off the request body) → reject a duplicate `postLinkNormalized` in the round → `calculateBonus` → single batch writing the submission plus an optional **3️⃣ share** for `sourceAccount.suggestedBy` (`isResidual: true`, `✅ Qualified`). Only the **source** account doc is read; `originalAcc` is carried as an id. **No `userTotals` write here.**

### Totals invariant (credited on approval only)
`userTotals[uid]` = the sum of that user's **approved** submissions' `bonusAmount` — *unless* an admin manually overrode it via the Earnings Payout cell. Totals move ONLY through:
- **Submission PATCH** — transactional delta `(newApproved ? newAmount : 0) − (oldApproved ? oldAmount : 0)`, covering approve (+), reject/un-approve (−), and bonus edits while approved (±).
- **Submission DELETE** — subtracts the bonus only if it was approved.
- **Totals PATCH** — absolute override (may intentionally diverge).

`adminApproval` is a 3-state enum: `pending` (default) | `approved` | `rejected`.

---

## Viral Accounts (`smm-xaccounts`)

A read-only listing of every **active** account with `isViralBonus`, grouped by network (`ViralAccountsTable`) — the accounts SMMs may copy viral posts from. Small enough to load in one request, so nothing here is lazy. Its last column is **Suggested by** (`suggestedBy`), **not** Assigned: on this page the relationship that matters is who nominated the page and therefore earns the $2 share.

**Submit Page Suggestion** writes a `twitterx-page-suggestions` doc from a single field (the account link); the submitter, the timestamp and the `accountName` handle are all derived server-side (`extractAccountHandle`). Admins review them in **Bonus Management → Viral Page Suggestions**:
- **Approve** looks the handle up in `twitterx-accounts` (an `in` query over the three casings, since sheet-imported names are upper-case) and sets `isViralBonus: true`. If no such account exists the route answers `{ accountMissing: true }` **without writing**; the admin confirms, and a retry with `createAccount: true` registers a blank account carrying only the suggested name/link.
- **Deny** sets `isRejected: true`; neither approved nor denied entries appear again.

## Client hooks & caching

| Hook | Cache |
|---|---|
| `useSmmAccounts(scope)` | sessionStorage `bluu_smm_accounts_{scope}_v1`, 5-min TTL; mutations invalidate the whole `bluu_smm_accounts_` prefix |
| `useSmmAccountDatabase()` | admin database only — lazy per-network. `loadNetwork(network)` fetches `?scope=all&network=` on first expand; caches `bluu_smm_accounts_net_{network}_v1` (under the shared prefix). Mutations invalidate the prefix and refetch only the open groups |
| `useSmmPosts` | in-memory per-week map only (high churn); cleared on any post mutation — which also calls `invalidatePostLinkCheck()` |
| `useSmmPostLinkCheck` | module-level `Map` keyed by the **normalized** link, so every URL variant of a post shares one entry. Debounced 400 ms, skipped entirely unless the caller passes `enabled`, and stale responses are discarded by sequence number |
| `useSmmAccountResolve` | module-level `Map` keyed by the **lower-cased handle**. Same shape as `useSmmPostLinkCheck` (400 ms debounce, `enabled` gate, sequence-number staleness) — the schedule dialog enables it only once a local account match has failed, so a normal paste never hits it |
| `useSmmBonus` | current-round cached `bluu_smm_bonus_current_{me\|all}_v1`, 5-min TTL, invalidated on any bonus mutation; previous rounds uncached (lazy) |
| `useSmmUsers` | sessionStorage `bluu_smm_users_v1`, 5-min TTL |
| `useSmmSuggestions` | uncached — the pending list is small and must reflect a review immediately |
| `useAuthFetch` | shared bearer-token fetch helper (extracted from `useDisputesData`) |

---

## Gotchas
- **Two accounts, two roles.** A bonus involves the page the SMM *posted on* (tier, ownership, must be a 'Bonus' type) and the creator page they *uploaded from* (`sourceAcc` — network bonus + the $2 suggestion share). Reading `network` off the posting account is the mistake to avoid: the Twitter Management import gives every posting page `network: 'Other'`, so that bug is silent — it just pays nobody.
- **`normalizePostLink()` is the ONLY way a link may be compared or looked up.** A link's identity is the tweet's **status id** (`extractStatusId`), rendered as `x.com/i/status/<id>` — so every variant of the same post collapses to one value: scheme, `www.`, `x.com` vs `twitter.com`, the handle (which changes on a rename), `/photo/1`, `/video/2`, `?t=…&s=20`, `#fragment`. Never compare raw `postLink`/`originalLink` strings and never query on anything but this output; `isSameLink(a, b)` is the pure two-link comparison. A non-status link (a bare profile) falls back to a host-lowercased, scheme/`www.`-stripped form with `twitter.com` folded onto `x.com`. **`src/scripts/import-smm-bonus-schedule.js` carries a hand-copied mirror of this function — keep the two in lockstep.**
- **A post link must be a post on the account it is filed under.** `linkMatchesHandle(postLink, accountHandle(account))` compares the link's first path segment (`extractAccountHandle`) against the account's handle, case-insensitively. Enforced in **three** places: `CreatePostDialog` (the same call *resolves* the account from the link, so a non-matching handle simply yields no account and blocks Next), `PostDialog` edit (blocks Save, naming both handles — it still has an account dropdown), and server-side in `POST /api/smm/posts` + `PATCH …/[postId]` — the client answer is never trusted, since the account decides the bonus tier and ownership. `accountHandle()` reads the handle out of `accountLink` and falls back to `accountName` only if the link is unusable. The PATCH check fires **only when `postLink` itself changes**; a pure account move (the admin Content tab's move dropdown) is deliberately exempt, so a moved post can still carry its original page's link.
- **A post link may not equal the original (viral copy) link.** The post link is the *new* upload on the SMM's own account; the original is someone else's post that was copied. Same link ⇒ no new upload is being recorded. Checked in `ViralCopyDialog` (step two, where both links are known) and again in `POST`/`PATCH`.
- **A post link may not already be in the content schedule.** `findDuplicatePostLink(normalized, exclude?)` — one collection-group equality on `postLinkNormalized`, `select()` (keys only), `limit(2)`. It matches only a post's **own** link, never a copy source: two SMMs declaring the same viral original is normal, re-uploading the same post is not. Surfaced live by `useSmmPostLinkCheck` and enforced on write (**409**). `exclude` is the post doing the asking, so an edit doesn't flag itself.
- **`accountName` must stay equal to the handle in `accountLink`.** It is the only key `findAccountByHandle` matches on, so a hand-typed display name makes the account invisible to the viral-copy lookup (and to suggestion approval). **Add Account** therefore fills the name in from the link (`extractAccountHandle`) and keeps it in sync until the admin edits it — the link field comes first in the form for that reason.
- **The source account is derived, not asked for.** It is the account the copied original lives on, resolved from the link in the viral-copy step. There is no "Uploaded from" input anywhere in the UI any more (`SourceAccountField` is gone) — the only way a post gets a source, and therefore a network bonus, is by declaring a copy. `scope=viral` on the accounts route was consequently narrowed to `smm-xaccounts`/`smm-admin`; the dashboard no longer reads that list.
- **Times are local in the UI, UTC in the database.** `DateTimePicker` works entirely in the user's local timezone; `.toISOString()` on save converts to UTC, the API stores `Timestamp.fromDate(...)` (an absolute instant), and `serializeTimestamp` sends ISO back. Every renderer is date-fns `format`, which is local — including `WeekCalendar`'s `format(date, 'yyyy-MM-dd')` day-bucketing, so posts land in the SMM's own day columns. **Never** use `getUTC*`/`toISOString().split('T')` to derive a displayed date. A new post defaults to **the user's current local time** (`withCurrentTime`), keeping the clicked day but filling the clock from `new Date()`.
- **Post dates carry a time of day.** The qualifying windows are measured in hours (3d12h / 5d12h / 7d12h) from the post timestamp, so the schedule captures a time — `DateTimePicker` (calendar + native time input), not `DatePicker`. Everything that renders a post/submission date uses `'PPp'`, calendar cards show `HH:mm`, and a day column is ordered by time. `DatePicker` remains for round windows.
- **Inactive accounts** must never surface on the dashboard — filtered server-side (posts routes drop them; dropdowns use `scope=mine`/`active`). Enforced in the query layer, not the UI.
- **Subcollections** are NOT covered by the user-deletion cascade; `submittedBy`/`postedBy` are audit refs, kept like `disputes.createdBy`.
- Money renders via `formatMoney` ("$X.XX"); round headers via `formatRoundDate` ("26 April").
- External links open with `window.open(url, '_blank', 'noopener,noreferrer')` (Electron routes to the system browser); copy buttons use `navigator.clipboard` + sonner.
- Avatars only via `src/components/ui/avatar.tsx` — through `UserChip` (a Button pill) or `UserAvatarLabel` (inline, non-button; use inside another button such as a collapsible group header or a calendar card).
- **`WeekCalendar` is shared** between the dashboard (card body = capped caption) and the admin **Content Schedule** tab (card body = poster's `UserAvatarLabel`) via the `renderCardBody` prop. `onDayClick`/`onShowAll` are optional — the admin calendar is view/edit only. A 💰 renders on any card whose post has `bonusSubmission`.
- **Admin Account Database inline edits are staged, not live.** Cells call `onStage` (local buffer) and nothing is written until the **Save** button (`saveAccounts` — one PATCH per edited account, then a single refetch). `AccountDatabaseTab` reports its dirty state + save fn up to the page, which shows an `UnsavedChangesDialog` (Save / Continue without saving / Cancel) on a tab switch and a `beforeunload` prompt on reload/close. The row **Edit** dialog and **Add Account** still write immediately.
- **Collapsible table groups** use the shared `GroupHeaderRow` (chevron + label, Account-Database style): network groups (accounts), submitter groups (Bonus Management submissions), and round + submitter sub-groups (Previous Rounds). Submission/round groups default to expanded.
- **Account Database filter badges** (`Bonus Accounts` = type contains 'Bonus', `Viral Bonus Accounts` = `isViralBonus`) narrow the grid exactly like a search does — they force every network group to load so matches are found across networks, and only groups with matches expand.
- **Admin Account Database is lazy** — one table (`AccountsDatabaseTable`, memoized) with shared column headers and a collapsible group row per network. Groups are collapsed by default and fetch their accounts only on first expand (`twitterx-accounts` is large). Search is debounced (`useDebouncedValue`, 300 ms) and drives the filtering/loading — the input stays responsive while the heavy grid re-renders only on the settled value. A search loads every group to match across networks, but each group stays collapsed with a header spinner until its data arrives, then expands (only matching rows render). The post-move dropdown in the Content tab uses the slim `scope=active` list (not the lazy database), so it stays complete regardless of which groups are open.
