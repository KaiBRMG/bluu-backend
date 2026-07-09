# SMM Portal

> The Social Media Management teamspace (`smm-portal`): Twitter/X account management, a per-user content schedule (week calendar), and a periodic bonus system with server-calculated payouts. Modeled after the CA Portal.

## Dependencies / Interacting Files

| Layer | Location |
|---|---|
| Pages | `src/app/(main)/smm-portal/{dashboard,admin}/page.tsx` |
| API routes | `src/app/api/smm/**` |
| Service | `src/lib/services/smmService.ts` |
| Pure logic | `src/lib/smm/{bonusCalc,linkUtils,format}.ts` |
| Client hooks | `src/hooks/useSmm{Accounts,Posts,Bonus,Users}.ts`, `src/hooks/useAuthFetch.ts` |
| Components | `src/components/smm/{shared,dashboard,admin}/*` |
| Types/constants | `src/types/firestore.ts` (`Smm*`, `SMM_ACCOUNT_TYPES`, `SMM_NETWORKS`) |

The teamspace + pages are registered in `src/lib/definitions.ts` (`smm-portal`, `smm-admin`, `smm-dashboard`); the `SMM` group is in `groupService.ts` / `src/types/firestore.ts`. **Pages are invisible until an admin shares `smm-admin`/`smm-dashboard` with the SMM group via the Sharing UI** — see [permissions.md](permissions.md).

---

## Firestore Collections (first subcollections in the repo)

| Path | Purpose |
|---|---|
| `twitterx-accounts/{accountId}` | Twitter/X accounts. `type: string[]` (multi-select), `network`, `tier` (1\|2), `assigned` (uid\|null), `status` (active\|inactive), `lastUpdatedTime`/`lastUpdatedBy` stamped on every write |
| `twitterx-content-schedule/{accountId}/posts/{postId}` | Scheduled posts. **Subcollection** — the parent doc is never created. `bonusSubmission: boolean` is flipped to `true` when the post is submitted for a bonus (drives the calendar card's 💰). No `mediaCode` — it was removed |
| `twitterx-bonus/{roundId}` | A bonus round. `userTotals: map<uid, number>` |
| `twitterx-bonus/{roundId}/submissions/{id}` | Bonus submissions (incl. auto-created residuals) |

All access is via Admin SDK API routes; `firestore.rules` denies client read/write on all four (subcollection matches are explicit — rules don't cascade). The **current round** is the doc with the latest `roundDateStart`.

### Denormalization (frozen at write time)
- `posts.accountName` — denormalized from the account so calendars/tables render without an account read. On account rename, the PATCH route fans the new name out to the account's posts (chunked batches). Bonus submissions keep their frozen copies by design.
- `posts.postLinkNormalized`, `submissions.originalLinkNormalized` — `normalizePostLink()` output, stored so the bonus wizard's duplicate lookup can use equality queries (Firestore can't suffix-match). **Always** recomputed at every write boundary that sets the link.
- `submissions.network`/`tier`/`accountName` — frozen at submission time so later account edits never change historical bonuses.

### Indexes (`firestore.indexes.json`)
First `COLLECTION_GROUP` indexes in the repo: `posts (postedBy, postDate)` asc + desc; `fieldOverrides` enable single-field collection-group equality on `posts.postLinkNormalized` and `submissions.originalLinkNormalized`, and a **collection-group range on `posts.postDate`** (asc + desc) for the admin Content Schedule's all-users week query. Per-round submission and per-account post queries are single-equality COLLECTION scope (auto-indexed).

---

## API Routes (all `withAuth` + `checkSmmAccess`)

`checkSmmAccess(uid, 'dashboard'|'admin'|'either')` (in `smmService.ts`) gates on `permittedPageIds` — the same mechanism as `checkPageAccess`, NOT the admin JWT claim (these routes only touch SMM data). `isSmmAdmin(uid)` widens ownership checks for admin-page users.

| Route | Gate | Ownership |
|---|---|---|
| `accounts` GET `?scope=mine\|active\|all[&network=]` | mine/active: either; all: admin | mine = `assigned==uid` + active; `all&network=` filters one group (single-equality, auto-indexed) for the admin database's lazy load |
| `accounts` POST, `accounts/[id]` PATCH/DELETE | admin | DELETE also `recursiveDelete`s the posts subtree |
| `posts` GET `?view=week\|all`, `?accountId=` | dashboard (accountId: either) | own posts; inactive-account posts filtered out server-side |
| `posts` GET `?view=week&scope=all` | admin | **every** user's posts in the range, with `postedByName`/`postedByPhotoURL` resolved — powers the admin **Content Schedule** calendar. Pure `postDate` range on the `posts` collection group — needs the `posts.postDate` **COLLECTION_GROUP** single-field override (collection-group single-field indexes are NOT auto-created) |
| `posts` POST, `posts/[accountId]/[postId]` PATCH/DELETE | either | `postedBy==uid` unless admin-page user; account must be active + assigned |
| `bonus/current` GET `?scope=me\|all` | me: dashboard; all: admin | me = own submissions + own total |
| `bonus/rounds` GET/POST | GET per scope; POST admin | |
| `bonus/rounds/[roundId]/totals` PATCH | admin | absolute payout override |
| `bonus/rounds/[roundId]/submissions/[submissionId]` PATCH/DELETE | admin | applies the totals delta (below) |
| `bonus/eligibility` GET `?link=` | dashboard | advisory — re-checked at submit |
| `bonus/submissions` POST | dashboard | own post; server computes everything |
| `users` GET | admin | non-archived SMM group members |

---

## Bonus system

### Calculation (`src/lib/smm/bonusCalc.ts` — pure, server-only)
`calculateBonus({tier, network, numLikes, postDateMs, submissionDateMs, hasOriginalLink})` → `{bonusAmount, status, sysComments, residualBonusAmount}`. Pipeline:
1. **Target bonus**, evaluated highest-first. Tier 1: 35k→$25 / 20k→$10 / 10k→$5; Tier 2: 35k→$15 / 20k→$7 / 10k→$3 (windows 7d12h / 5d12h / 3d12h). No rule matched ⇒ `❌ Late submission`, $0, STOP (no network bonus on late).
2. **Viral halving** if `hasOriginalLink` and qualified — `residualBonusAmount` = the halved value, captured BEFORE the network step.
3. **Network**: Inhouse +$3, X Managed +$1, Twink (without originalLink) halves.

### Submission flow (`bonus/submissions` POST)
Load post (must be caller's) → load account (frozen tier/network, must be active) → require now within the current round window (else 400) → if viral, **re-run eligibility server-side** (client result never trusted) → reject a duplicate `postLinkNormalized` in the round → `calculateBonus` → single batch writing the submission plus an optional **residual** submission for the original account's `assigned` owner (`isResidual: true`, `✅ Qualified`). **No `userTotals` write here.**

### Totals invariant (credited on approval only)
`userTotals[uid]` = the sum of that user's **approved** submissions' `bonusAmount` — *unless* an admin manually overrode it via the Earnings Payout cell. Totals move ONLY through:
- **Submission PATCH** — transactional delta `(newApproved ? newAmount : 0) − (oldApproved ? oldAmount : 0)`, covering approve (+), reject/un-approve (−), and bonus edits while approved (±).
- **Submission DELETE** — subtracts the bonus only if it was approved.
- **Totals PATCH** — absolute override (may intentionally diverge).

`adminApproval` is a 3-state enum: `pending` (default) | `approved` | `rejected`.

---

## Client hooks & caching

| Hook | Cache |
|---|---|
| `useSmmAccounts(scope)` | sessionStorage `bluu_smm_accounts_{scope}_v1`, 5-min TTL; mutations invalidate the whole `bluu_smm_accounts_` prefix |
| `useSmmAccountDatabase()` | admin database only — lazy per-network. `loadNetwork(network)` fetches `?scope=all&network=` on first expand; caches `bluu_smm_accounts_net_{network}_v1` (under the shared prefix). Mutations invalidate the prefix and refetch only the open groups |
| `useSmmPosts` | in-memory per-week map only (high churn); cleared on any post mutation |
| `useSmmBonus` | current-round cached `bluu_smm_bonus_current_{me\|all}_v1`, 5-min TTL, invalidated on any bonus mutation; previous rounds uncached (lazy) |
| `useSmmUsers` | sessionStorage `bluu_smm_users_v1`, 5-min TTL |
| `useAuthFetch` | shared bearer-token fetch helper (extracted from `useDisputesData`) |

---

## Gotchas
- **Inactive accounts** must never surface on the dashboard — filtered server-side (posts routes drop them; dropdowns use `scope=mine`/`active`). Enforced in the query layer, not the UI.
- **Subcollections** are NOT covered by the user-deletion cascade; `submittedBy`/`postedBy` are audit refs, kept like `disputes.createdBy`.
- Money renders via `formatMoney` ("$X.XX"); round headers via `formatRoundDate` ("26 April").
- External links open with `window.open(url, '_blank', 'noopener,noreferrer')` (Electron routes to the system browser); copy buttons use `navigator.clipboard` + sonner.
- Avatars only via `src/components/ui/avatar.tsx` — through `UserChip` (a Button pill) or `UserAvatarLabel` (inline, non-button; use inside another button such as a collapsible group header or a calendar card).
- **`WeekCalendar` is shared** between the dashboard (card body = capped caption) and the admin **Content Schedule** tab (card body = poster's `UserAvatarLabel`) via the `renderCardBody` prop. `onDayClick`/`onShowAll` are optional — the admin calendar is view/edit only. A 💰 renders on any card whose post has `bonusSubmission`.
- **Admin Account Database inline edits are staged, not live.** Cells call `onStage` (local buffer) and nothing is written until the **Save** button (`saveAccounts` — one PATCH per edited account, then a single refetch). `AccountDatabaseTab` reports its dirty state + save fn up to the page, which shows an `UnsavedChangesDialog` (Save / Continue without saving / Cancel) on a tab switch and a `beforeunload` prompt on reload/close. The row **Edit** dialog and **Add Account** still write immediately.
- **Collapsible table groups** use the shared `GroupHeaderRow` (chevron + label, Account-Database style): network groups (accounts), submitter groups (Bonus Management submissions), and round + submitter sub-groups (Previous Rounds). Submission/round groups default to expanded.
- **Admin Account Database is lazy** — one table (`AccountsDatabaseTable`, memoized) with shared column headers and a collapsible group row per network. Groups are collapsed by default and fetch their accounts only on first expand (`twitterx-accounts` is large). Search is debounced (`useDebouncedValue`, 300 ms) and drives the filtering/loading — the input stays responsive while the heavy grid re-renders only on the settled value. A search loads every group to match across networks, but each group stays collapsed with a header spinner until its data arrives, then expands (only matching rows render). The post-move dropdown in the Content tab uses the slim `scope=active` list (not the lazy database), so it stays complete regardless of which groups are open.
