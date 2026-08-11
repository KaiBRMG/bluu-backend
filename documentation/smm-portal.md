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
| `twitterx-bonus/{roundId}/submissions/{id}` | Bonus submissions (incl. auto-created residuals) |
| `twitterx-page-suggestions/{id}` | Viral-page nominations from the Viral Accounts page. `accountName` (handle, derived server-side from `accountLink`), `submittedBy`, `submissionDate`, `isApproved`, `isRejected` — the pending list queries the two booleans |

All access is via Admin SDK API routes; `firestore.rules` denies client read/write on all five (subcollection matches are explicit — rules don't cascade).

**The current round** is the round whose window *contains today* (`getCurrentRoundSnap`: newest round starting on or before now, kept only if it hasn't ended), falling back to the latest round by `roundDateStart` when none is live. Bonus Management's header is a **round picker** over every round; `bonus/current?roundId=` views any of them (uncached — only the default round is cached).

### The tier ⇄ 'Bonus' invariant
`tier` is meaningful only on a **bonus account** (its `type` contains `'Bonus'`), because tier drives nothing but bonus payouts. `resolveTier()` in `smmService.ts` is the single source of truth, applied by both the create and update handlers **against the merged document** (a PATCH may change `type` or `tier` alone):
- type contains `'Bonus'` → a tier (1 or 2) is **required**; a missing one is a 400.
- otherwise → the tier is **forced to null**, not rejected — dropping `'Bonus'` from an existing account must not fail over a tier the admin never touched.

The UI mirrors this with the shared `TierField` (greyed out with *"Only bonus accounts can have a tier, set this in Type"* until 'Bonus' is selected; blocks save when a bonus account has no tier), and the Account Database hides the tier cell entirely on non-bonus rows.

`isViralBonus` is a **different axis** and is often confused with the `'Bonus'` type: `'Bonus'` = this account may *submit* for a bonus; `isViralBonus` = SMMs may *copy viral posts from* this account (it is what the Viral Accounts page lists).

### Denormalization (frozen at write time)
- `posts.accountName` — denormalized from the account so calendars/tables render without an account read. On account rename, the PATCH route fans the new name out to the account's posts (chunked batches). Bonus submissions keep their frozen copies by design.
- `posts.postLinkNormalized`, `posts.originalLinkNormalized`, `submissions.originalLinkNormalized` — `normalizePostLink()` output, stored so the viral-copy lookup can use equality queries (Firestore can't suffix-match). **Always** recomputed at every write boundary that sets the link.
- `posts.sourceAcc`/`sourceAccName` — the creator page the content was uploaded from. **Never entered by hand and never editable**: it is *derived* from the viral-copy declaration — the account the original post lives on, looked up from the pasted link by `resolveOriginalAccount()` — so it always equals `originalAcc`. A post that is not a copy has no source (⇒ network `'Other'` ⇒ no network bonus). Posts created before this change may still carry a hand-picked source that differs from `originalAcc`; the submission route handles both.
- `submissions.network`/`sourceAcc`/`sourceAccName`/`tier`/`accountName` — frozen at submission time so later account/post edits never change historical bonuses.

### Indexes (`firestore.indexes.json`)
First `COLLECTION_GROUP` indexes in the repo: `posts (postedBy, postDate)` asc + desc; `fieldOverrides` enable single-field collection-group equality on `posts.postLinkNormalized`, `posts.originalLinkNormalized` and `submissions.originalLinkNormalized`, and a **collection-group range on `posts.postDate`** (asc + desc) for the admin Content Schedule's all-users week query. Per-round submission and per-account post queries are single-equality COLLECTION scope (auto-indexed).

---

## API Routes (all `withAuth` + `checkSmmAccess`)

`checkSmmAccess(uid, 'dashboard'|'admin'|'either'|'viral')` (in `smmService.ts`) gates on `permittedPageIds` — the same mechanism as `checkPageAccess`, NOT the admin JWT claim (these routes only touch SMM data). `isSmmAdmin(uid)` widens ownership checks for admin-page users.

| Route | Gate | Ownership |
|---|---|---|
| `accounts` GET `?scope=mine\|active\|viral\|all[&network=]` | mine/active: either; viral: xaccounts (or admin); all: admin | mine = `assigned==uid` + active; `all&network=` filters one group (single-equality, auto-indexed) for the admin database's lazy load |
| `accounts` POST, `accounts/[id]` PATCH/DELETE | admin | DELETE also `recursiveDelete`s the posts subtree |
| `posts` GET `?view=week\|all`, `?accountId=` | dashboard (accountId: either) | own posts; inactive-account posts filtered out server-side |
| `posts` GET `?view=week&scope=all` | admin | **every** user's posts in the range, with `postedByName`/`postedByPhotoURL` resolved — powers the admin **Content Schedule** calendar. Pure `postDate` range on the `posts` collection group — needs the `posts.postDate` **COLLECTION_GROUP** single-field override (collection-group single-field indexes are NOT auto-created) |
| `posts` POST, `posts/[accountId]/[postId]` PATCH/DELETE | either | `postedBy==uid` unless admin-page user; account must be active + assigned |
| `bonus/current` GET `?scope=me\|all[&roundId=]` | me: dashboard; all: admin | me = own submissions + own total; `all` also returns `rounds` (every round's window) for the picker |
| `bonus/rounds` GET/POST | GET per scope; POST admin | |
| `bonus/rounds/[roundId]/totals` PATCH | admin | absolute payout override |
| `bonus/rounds/[roundId]/submissions/[submissionId]` PATCH/DELETE | admin | applies the totals delta (below) |
| `bonus/eligibility` GET `?link=` | dashboard | advisory — re-checked when the **post is created**. Also returns `handle` + the resolved `account` (`{id,name,network}` or `null`) so the dialog can show the source and block an unknown one |
| `bonus/submissions` POST | dashboard | own post; account type must contain 'Bonus' and carry a tier; server computes everything |
| `suggestions` GET | admin | pending viral-page nominations |
| `suggestions` POST | viral | submitter + timestamp + handle all derived server-side |
| `suggestions/[id]` PATCH | admin | approve (flag `isViralBonus`, optionally create the account) / deny |
| `users` GET | admin | non-archived SMM group members |

---

## Bonus system

### Calculation (`src/lib/smm/bonusCalc.ts` — pure, server-only)
`calculateBonus({tier, network, numLikes, postDateMs, submissionDateMs, hasOriginalLink})` → `{bonusAmount, status, sysComments, residualBonusAmount}`.

**The two inputs come from two different accounts** — the single most confusable thing in this subsystem:
- `tier` ← the **page the SMM posted on** (`accountId`). Only bonus accounts are tiered.
- `network` ← the **creator page the content was uploaded from** (`post.sourceAcc`, i.e. the account the copied original lives on). The manual pays the network bonus for uploading *from* the inhouse / X managed / twink lists, so it is a property of the source, not of your page. No recorded source — which now means "not declared as a copy" — ⇒ `'Other'` ⇒ no network bonus.
- `hasOriginalLink` ← the post's stored viral-copy declaration.

Pipeline:
1. **Target bonus**, evaluated highest-first. Tier 1: 35k→$25 / 20k→$10 / 10k→$5; Tier 2: 35k→$15 / 20k→$7 / 10k→$3 (windows 7d12h / 5d12h / 3d12h). No rule matched ⇒ `❌ Late submission`, $0, STOP (no network bonus on late).
2. **Viral halving** if `hasOriginalLink` and qualified — `residualBonusAmount` = the halved value, captured BEFORE the network step.
3. **Network** (of the *source* creator): Inhouse **+$3**, X Managed **+$1**, Twink **+ half of the _Tier 1_ amount for the threshold that was met** — an addition, and always measured against Tier 1 whatever tier the posting page is ("you will get half of the Tier 1 bonus").

### Shares paid to other SMMs
Both are written as their own `isResidual: true` submission docs so an admin approves each on its own merits, and both can fire on one post:
- **Rule 3️⃣ — page-suggestion share.** A flat `SUGGESTION_SHARE` ($2) to `sourceAccount.suggestedBy` — the SMM whose approved page suggestion added that creator — for every qualifying post another SMM uploads from it. Never paid to the submitter themselves. `suggestedBy` is stamped on the account when a suggestion is **approved**, and the first approved suggestion owns the page (never overwritten).
- **Rule 6️⃣ — viral-copy residual.** The halved target bonus to the `assigned` owner of the copied page.

### The viral-copy declaration happens at UPLOAD time
"Did you copy another viral post?" is **step one of scheduling a post** (`ViralCopyDialog` → `CreatePostDialog`), not part of applying for a bonus. Rationale: the 2-week source rule is only actionable while the SMM can still choose a different source.

- **The account is never typed in.** `extractAccountHandle()` pulls the handle out of the pasted link and `findAccountByHandle()` resolves it against `twitterx-accounts` (three casings in one `in` query — the sheet import is upper-case). That account is *both* the copy's origin and the post's `sourceAcc`, so it is what pays the network bonus; letting the SMM pick it by hand would let them point a post at a better-paying network.
- The dialog runs `bonus/eligibility` (which returns `handle` + the resolved `account`) and shows **"✅ Eligible"**, **"⚠️ Already Used Recently"**, or **"⚠️ Account Not Found"**. Any of the last two **blocks** the copy — the SMM picks another source or answers "No" and schedules an ordinary post. **A handle that isn't in the database is a hard stop**, not a sourceless post.
- `POST /api/smm/posts` **re-runs both checks** (`checkViralEligibility` + `resolveOriginalAccount`) and only then stores `isViralCopy`/`originalLink`/`originalAcc`/`sourceAcc`. It takes only `originalLink` from the client — no account id is accepted from the browser at all.
- `findLinkUsage` searches posts by `postLinkNormalized` **and** by `originalLinkNormalized`, plus submissions by `originalLinkNormalized` — a source claimed by another SMM's *upload* counts as used straight away, not only once their bonus is filed.
- The post PATCH allowlist deliberately **excludes** the viral fields **and `sourceAcc`**, so neither the copy nor the network it pays can be changed after the fact. An account move copies the whole doc, so the declaration follows the post.

### Submission flow (`bonus/submissions` POST)
Load post (must be caller's) → load account: **type must contain 'Bonus'** and its tier must be 1 or 2 (else 400 — the dashboard shows the same "not a bonus account" dialog before opening the wizard) → require now within the current round window (else 400) → read the viral-copy declaration **off the post** (never off the request body) → reject a duplicate `postLinkNormalized` in the round → `calculateBonus` → single batch writing the submission plus an optional **residual** submission for the original account's `assigned` owner (`isResidual: true`, `✅ Qualified`). **No `userTotals` write here.**

### Totals invariant (credited on approval only)
`userTotals[uid]` = the sum of that user's **approved** submissions' `bonusAmount` — *unless* an admin manually overrode it via the Earnings Payout cell. Totals move ONLY through:
- **Submission PATCH** — transactional delta `(newApproved ? newAmount : 0) − (oldApproved ? oldAmount : 0)`, covering approve (+), reject/un-approve (−), and bonus edits while approved (±).
- **Submission DELETE** — subtracts the bonus only if it was approved.
- **Totals PATCH** — absolute override (may intentionally diverge).

`adminApproval` is a 3-state enum: `pending` (default) | `approved` | `rejected`.

---

## Viral Accounts (`smm-xaccounts`)

A read-only listing of every **active** account with `isViralBonus`, grouped by network (`ViralAccountsTable`) — the accounts SMMs may copy viral posts from. Small enough to load in one request, so nothing here is lazy.

**Submit Page Suggestion** writes a `twitterx-page-suggestions` doc from a single field (the account link); the submitter, the timestamp and the `accountName` handle are all derived server-side (`extractAccountHandle`). Admins review them in **Bonus Management → Viral Page Suggestions**:
- **Approve** looks the handle up in `twitterx-accounts` (an `in` query over the three casings, since sheet-imported names are upper-case) and sets `isViralBonus: true`. If no such account exists the route answers `{ accountMissing: true }` **without writing**; the admin confirms, and a retry with `createAccount: true` registers a blank account carrying only the suggested name/link.
- **Deny** sets `isRejected: true`; neither approved nor denied entries appear again.

## Client hooks & caching

| Hook | Cache |
|---|---|
| `useSmmAccounts(scope)` | sessionStorage `bluu_smm_accounts_{scope}_v1`, 5-min TTL; mutations invalidate the whole `bluu_smm_accounts_` prefix |
| `useSmmAccountDatabase()` | admin database only — lazy per-network. `loadNetwork(network)` fetches `?scope=all&network=` on first expand; caches `bluu_smm_accounts_net_{network}_v1` (under the shared prefix). Mutations invalidate the prefix and refetch only the open groups |
| `useSmmPosts` | in-memory per-week map only (high churn); cleared on any post mutation |
| `useSmmBonus` | current-round cached `bluu_smm_bonus_current_{me\|all}_v1`, 5-min TTL, invalidated on any bonus mutation; previous rounds uncached (lazy) |
| `useSmmUsers` | sessionStorage `bluu_smm_users_v1`, 5-min TTL |
| `useSmmSuggestions` | uncached — the pending list is small and must reflect a review immediately |
| `useAuthFetch` | shared bearer-token fetch helper (extracted from `useDisputesData`) |

---

## Gotchas
- **Two accounts, two roles.** A bonus involves the page the SMM *posted on* (tier, ownership, must be a 'Bonus' type) and the creator page they *uploaded from* (`sourceAcc` — network bonus + the $2 suggestion share). Reading `network` off the posting account is the mistake to avoid: the Twitter Management import gives every posting page `network: 'Other'`, so that bug is silent — it just pays nobody.
- **The source account is derived, not asked for.** It is the account the copied original lives on, resolved from the link in the viral-copy step. There is no "Uploaded from" input anywhere in the UI any more (`SourceAccountField` is gone) — the only way a post gets a source, and therefore a network bonus, is by declaring a copy. `scope=viral` on the accounts route was consequently narrowed to `smm-xaccounts`/`smm-admin`; the dashboard no longer reads that list.
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
