import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { serializeTimestamp } from '@/lib/middleware/apiHelpers';
import { extractAccountHandle } from '@/lib/smm/linkUtils';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { SMM_ACCOUNT_TYPES, SMM_NETWORKS, SMM_STATUS_LATE, isBonusAccountType } from '@/types/firestore';
import type {
  SmmAccount,
  SmmAccountStatus,
  SmmBonusRound,
  SmmNetwork,
  SmmPageSuggestion,
  SmmPost,
  SmmSubmission,
  SmmTier,
  ViralLinkReport,
} from '@/types/firestore';

// ─── Collections ─────────────────────────────────────────────────────

export const SMM_ACCOUNTS = 'twitterx-accounts';
export const SMM_SCHEDULE = 'twitterx-content-schedule';
export const SMM_BONUS = 'twitterx-bonus';
export const SMM_SUGGESTIONS = 'twitterx-page-suggestions';
export const SMM_POSTS_SUB = 'posts';
export const SMM_SUBMISSIONS_SUB = 'submissions';

// ─── Access gates ────────────────────────────────────────────────────

export type SmmAccessNeed = 'dashboard' | 'admin' | 'either' | 'viral';

/**
 * Page-permission gate for SMM API routes. 'admin' = the smm-admin page,
 * which is shared via page permissions like any other page (NOT the admin
 * JWT claim — these routes only touch SMM data, not the auth graph).
 * 'viral' = the creator pages SMMs upload from — the smm-xaccounts (Viral
 * Accounts) listing. The dashboard used to need this too, when scheduling a
 * post asked the SMM to name the creator; that source is now derived from the
 * copied link server-side, so the dashboard grant was dropped.
 * getUserById is cached (60s), so repeated calls in one handler are cheap.
 */
export async function checkSmmAccess(
  uid: string,
  need: SmmAccessNeed,
): Promise<NextResponse | null> {
  const pages = (await getUserById(uid))?.permittedPageIds ?? [];
  const ok =
    need === 'dashboard' ? pages.includes('smm-dashboard') :
    need === 'admin' ? pages.includes('smm-admin') :
    need === 'viral' ? pages.includes('smm-xaccounts') || pages.includes('smm-admin') :
    pages.includes('smm-dashboard') || pages.includes('smm-admin');
  return ok ? null : NextResponse.json({ error: 'Access denied' }, { status: 403 });
}

/** True when the caller holds the smm-admin page — widens ownership checks. */
export async function isSmmAdmin(uid: string): Promise<boolean> {
  return (await getUserById(uid))?.permittedPageIds?.includes('smm-admin') ?? false;
}

/**
 * Guard for posting to / moving a post onto an account: it must exist, be
 * active, and be assigned to the caller (admin-page users may act on any
 * account). Returns null when allowed, or the error response. Single source
 * of truth for the write-path account ownership rule.
 */
export async function assertAccountWritable(
  uid: string,
  accountSnap: DocumentSnapshot,
): Promise<NextResponse | null> {
  const account = accountSnap.data();
  if (!accountSnap.exists || account?.status !== 'active') {
    return NextResponse.json({ error: 'Account not found or inactive' }, { status: 404 });
  }
  if (account.assigned !== uid && !(await isSmmAdmin(uid))) {
    return NextResponse.json({ error: 'Account is not assigned to you' }, { status: 403 });
  }
  return null;
}

/**
 * Locate an account by its Twitter/X handle. Handles are stored with
 * inconsistent casing (the imported sheet is upper-case, a pasted link is
 * usually not), so the three casings are matched in one `in` query rather than
 * scanning the collection.
 */
export async function findAccountByHandle(handle: string): Promise<DocumentSnapshot | null> {
  const clean = handle.trim().replace(/^@/, '');
  if (!clean) return null;
  const variants = [...new Set([clean, clean.toUpperCase(), clean.toLowerCase()])];
  const snap = await adminDb
    .collection(SMM_ACCOUNTS)
    .where('accountName', 'in', variants)
    .limit(1)
    .get();
  return snap.docs[0] ?? null;
}

/**
 * Resolve the creator page a copied viral post lives on, derived from the
 * original link alone — the SMM never picks it by hand, so it cannot be
 * pointed at a better-paying network than the one they actually copied from.
 *
 * This single account plays both source roles: its `network` is the network
 * bonus and its `suggestedBy` earns the $2 page-suggestion share. Returns null
 * when the handle is not in `twitterx-accounts` — callers must refuse the copy
 * rather than silently record a sourceless post.
 */
export async function resolveOriginalAccount(originalLink: string): Promise<
  { id: string; name: string; network: SmmNetwork } | null
> {
  const doc = await findAccountByHandle(extractAccountHandle(originalLink));
  if (!doc) return null;
  const d = doc.data() ?? {};
  return {
    id: doc.id,
    name: (d.accountName as string) ?? '',
    network: (d.network ?? 'Other') as SmmNetwork,
  };
}

// ─── User resolution (disputes resolveNames pattern) ─────────────────

export interface ResolvedUser {
  displayName: string; // '' when the user doc no longer exists → client renders DeletedUser
  photoURL: string | null;
}

export async function resolveUserInfo(uids: string[]): Promise<Map<string, ResolvedUser>> {
  const unique = [...new Set(uids.filter(Boolean))];
  const map = new Map<string, ResolvedUser>();
  if (unique.length === 0) return map;
  const snaps = await adminDb.getAll(...unique.map((uid) => adminDb.collection('users').doc(uid)));
  for (const snap of snaps) {
    const data = snap.data();
    map.set(snap.id, {
      displayName: (data?.displayName as string) ?? '',
      photoURL: (data?.photoURL as string) ?? null,
    });
  }
  return map;
}

// ─── Serializers (Timestamp → ISO at the API boundary) ───────────────

export function serializeAccount(snap: DocumentSnapshot): SmmAccount {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    accountName: d.accountName ?? '',
    accountLink: d.accountLink ?? '',
    type: d.type ?? [],
    network: (d.network ?? 'Other') as SmmNetwork,
    // Only bonus accounts are tiered — everything else carries a null tier.
    tier: (d.tier ?? null) as SmmTier | null,
    isViralBonus: d.isViralBonus ?? false,
    suggestedBy: d.suggestedBy ?? null,
    assigned: d.assigned ?? null,
    driveLink: d.driveLink ?? '',
    comments: d.comments ?? '',
    information: d.information ?? '',
    status: (d.status ?? 'active') as SmmAccountStatus,
    lastUpdatedTime: serializeTimestamp(d.lastUpdatedTime),
    lastUpdatedBy: d.lastUpdatedBy ?? '',
  };
}

export function serializePost(snap: DocumentSnapshot): SmmPost {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    // posts live at twitterx-content-schedule/{accountId}/posts/{postId}
    accountId: snap.ref.parent.parent?.id ?? '',
    accountName: d.accountName ?? '',
    caption: d.caption ?? '',
    postDate: serializeTimestamp(d.postDate),
    postLink: d.postLink ?? '',
    postedBy: d.postedBy ?? '',
    createdTime: serializeTimestamp(d.createdTime),
    bonusSubmission: d.bonusSubmission ?? false,
    isViralCopy: d.isViralCopy ?? false,
    originalLink: d.originalLink ?? '',
    originalAcc: d.originalAcc ?? '',
    sourceAcc: d.sourceAcc ?? '',
    sourceAccName: d.sourceAccName ?? '',
  };
}

export function serializeSuggestion(snap: DocumentSnapshot): SmmPageSuggestion {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    accountName: d.accountName ?? '',
    accountLink: d.accountLink ?? '',
    submittedBy: d.submittedBy ?? '',
    submissionDate: serializeTimestamp(d.submissionDate),
    isApproved: d.isApproved ?? false,
    isRejected: d.isRejected ?? false,
  };
}

export function serializeRound(snap: DocumentSnapshot): SmmBonusRound {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    roundDateStart: serializeTimestamp(d.roundDateStart),
    roundDateEnd: serializeTimestamp(d.roundDateEnd),
  };
}

export function serializeSubmission(snap: DocumentSnapshot): SmmSubmission {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    roundId: snap.ref.parent.parent?.id ?? '',
    postLink: d.postLink ?? '',
    accountName: d.accountName ?? '',
    originalLink: d.originalLink ?? '',
    originalAcc: d.originalAcc ?? '',
    submittedBy: d.submittedBy ?? '',
    screenshotLink: d.screenshotLink ?? '',
    postDate: serializeTimestamp(d.postDate),
    submissionDate: serializeTimestamp(d.submissionDate),
    numLikes: d.numLikes ?? 0,
    status: d.status ?? SMM_STATUS_LATE,
    network: (d.network ?? 'Other') as SmmNetwork,
    sourceAcc: d.sourceAcc ?? '',
    sourceAccName: d.sourceAccName ?? '',
    tier: (d.tier ?? 1) as SmmTier,
    bonusAmount: d.bonusAmount ?? 0,
    sysComments: d.sysComments ?? '',
    adminApproval: d.adminApproval ?? 'pending',
    isResidual: d.isResidual ?? false,
  };
}

// ─── Validation ──────────────────────────────────────────────────────

/**
 * The tier ⇄ 'Bonus' type invariant, resolved against the MERGED document
 * (a PATCH may change either field alone, so both handlers must reconcile the
 * incoming values with what is already stored).
 *
 * - type contains 'Bonus' → a tier is required (1 or 2).
 * - otherwise → the tier is forced to null, rather than rejected: dropping
 *   'Bonus' from an existing account's type must not fail because of a tier
 *   the admin never touched.
 *
 * Returns the tier to persist, or an error response.
 */
export function resolveTier(
  type: string[],
  tier: number | null | undefined,
): { tier: SmmTier | null } | NextResponse {
  if (!isBonusAccountType(type)) return { tier: null };
  if (tier !== 1 && tier !== 2) {
    return NextResponse.json({ error: 'Bonus accounts must have a tier' }, { status: 400 });
  }
  return { tier };
}

/** Enum validation shared by the account create + update handlers. */
export function validateAccountFields(body: {
  type?: string[];
  network?: string;
  tier?: number | null;
  status?: string;
  assigned?: string | null;
  isViralBonus?: boolean;
}): NextResponse | null {
  if (body.type !== undefined) {
    if (!Array.isArray(body.type) || body.type.some((t) => !(SMM_ACCOUNT_TYPES as readonly string[]).includes(t))) {
      return NextResponse.json({ error: 'Invalid account type' }, { status: 400 });
    }
  }
  if (body.network !== undefined && !(SMM_NETWORKS as readonly string[]).includes(body.network)) {
    return NextResponse.json({ error: 'Invalid network' }, { status: 400 });
  }
  if (body.tier !== undefined && body.tier !== null && body.tier !== 1 && body.tier !== 2) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
  }
  if (body.isViralBonus !== undefined && typeof body.isViralBonus !== 'boolean') {
    return NextResponse.json({ error: 'Invalid viral account flag' }, { status: 400 });
  }
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'inactive') {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (body.assigned !== undefined && body.assigned !== null && typeof body.assigned !== 'string') {
    return NextResponse.json({ error: 'Invalid assigned user' }, { status: 400 });
  }
  return null;
}

// ─── Rounds ──────────────────────────────────────────────────────────

/**
 * The round to treat as "current": the round whose window contains now, else
 * the latest round by `roundDateStart`. Two limit(1) reads at worst — the
 * containing round is found by taking the most recently *started* round and
 * checking its end, so no full collection scan is needed.
 */
export async function getCurrentRoundSnap(): Promise<DocumentSnapshot | null> {
  const now = Timestamp.now();
  const started = await adminDb
    .collection(SMM_BONUS)
    .where('roundDateStart', '<=', now)
    .orderBy('roundDateStart', 'desc')
    .limit(1)
    .get();
  const candidate = started.docs[0];
  if (candidate) {
    const end = candidate.data()?.roundDateEnd as Timestamp | undefined;
    if (end && end.toMillis() >= now.toMillis()) return candidate;
  }

  // No round is live right now — fall back to the latest one (which may be
  // finished, or scheduled to start in the future).
  const latest = await adminDb
    .collection(SMM_BONUS)
    .orderBy('roundDateStart', 'desc')
    .limit(1)
    .get();
  return latest.empty ? null : latest.docs[0];
}

// ─── Bonus totals invariant ──────────────────────────────────────────

/**
 * Change to apply to `userTotals[submittedBy]` when a submission's approval or
 * bonus amount changes. userTotals is credited on approval only, so the total
 * reflects `newApproved ? newAmount : 0` and previously reflected
 * `oldApproved ? oldAmount : 0`. Single source of truth for both the PATCH
 * (edit/approve/reject) and DELETE (new state = not-approved, $0) paths.
 */
export function bonusTotalDelta(args: {
  oldApproved: boolean;
  oldAmount: number;
  newApproved: boolean;
  newAmount: number;
}): number {
  return (args.newApproved ? args.newAmount : 0) - (args.oldApproved ? args.oldAmount : 0);
}

// ─── Duplicate-link lookup (bonus wizard) ────────────────────────────

export interface LinkUsage {
  source: 'post' | 'submission';
  refDate: string | null; // postDate / submissionDate (ISO)
  userId: string;         // postedBy / submittedBy
  detailLink: string;     // postLink / originalLink
}

/** A copied viral post only qualifies if its source is older than this. */
export const VIRAL_ELIGIBLE_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ViralEligibility {
  found: boolean;
  eligible: boolean;
  source?: 'post' | 'submission';
  daysDiff: number | null;
  detail?: { link: string; userName: string; date: string | null };
}

/**
 * The viral-copy rule, in one place: an original link may be copied only if it
 * has never been used, or its most recent use (a scheduled post or an earlier
 * bonus's source) is more than {@link VIRAL_ELIGIBLE_AFTER_DAYS} days old.
 *
 * Runs on the advisory eligibility route AND authoritatively when the post is
 * scheduled — the client's result is never trusted.
 */
export async function checkViralEligibility(normalized: string): Promise<ViralEligibility> {
  const usage = await findLinkUsage(normalized);
  if (!usage) return { found: false, eligible: true, daysDiff: null };

  const names = await resolveUserInfo([usage.userId]);
  const daysDiff = usage.refDate
    ? Math.floor((Date.now() - new Date(usage.refDate).getTime()) / DAY_MS)
    : Infinity;

  return {
    found: true,
    source: usage.source,
    eligible: daysDiff > VIRAL_ELIGIBLE_AFTER_DAYS,
    daysDiff: Number.isFinite(daysDiff) ? daysDiff : null,
    detail: {
      link: usage.detailLink,
      userName: names.get(usage.userId)?.displayName ?? '',
      date: usage.refDate,
    },
  };
}

/**
 * Find the most recent prior use of a normalized link — as a scheduled post
 * (postLinkNormalized) or as a viral-copy source of an earlier bonus
 * (originalLinkNormalized). Powers the wizard's eligibility check, so it runs
 * both on the eligibility route and again server-side at submit time (the
 * client's result is never trusted). Returns null when the link is unused.
 */
export async function findLinkUsage(normalized: string): Promise<LinkUsage | null> {
  if (!normalized) return null;

  const [posts, copies, subs] = await Promise.all([
    adminDb.collectionGroup(SMM_POSTS_SUB).where('postLinkNormalized', '==', normalized).get(),
    // Copies are declared when a post is SCHEDULED, so a source already claimed
    // by another SMM's upload must count as used even before its bonus is filed.
    adminDb.collectionGroup(SMM_POSTS_SUB).where('originalLinkNormalized', '==', normalized).get(),
    adminDb.collectionGroup(SMM_SUBMISSIONS_SUB).where('originalLinkNormalized', '==', normalized).get(),
  ]);

  const candidates: LinkUsage[] = [];
  for (const doc of [...posts.docs, ...copies.docs]) {
    const d = doc.data();
    candidates.push({
      source: 'post',
      refDate: serializeTimestamp(d.postDate),
      userId: d.postedBy ?? '',
      detailLink: d.postLink ?? '',
    });
  }
  for (const doc of subs.docs) {
    const d = doc.data();
    candidates.push({
      source: 'submission',
      refDate: serializeTimestamp(d.submissionDate),
      userId: d.submittedBy ?? '',
      detailLink: d.originalLink ?? '',
    });
  }
  if (candidates.length === 0) return null;

  // Most recent by refDate (nulls sort last).
  candidates.sort((a, b) => {
    const ta = a.refDate ? new Date(a.refDate).getTime() : -Infinity;
    const tb = b.refDate ? new Date(b.refDate).getTime() : -Infinity;
    return tb - ta;
  });
  return candidates[0];
}

/**
 * Has this exact post already been recorded in the content schedule? Matches
 * on `postLinkNormalized` only — a post's OWN link, not a copy source, since
 * two SMMs legitimately declaring the same viral original is the normal case
 * and only re-uploading the same post twice is the mistake.
 *
 * Kept as cheap as the question deserves: keys only (`select()` with no
 * fields), capped at two docs — two is enough to still answer "yes" when the
 * single match found is the post being edited.
 *
 * `exclude` is the post doing the asking (an edit), so it doesn't flag itself.
 */
export async function findDuplicatePostLink(
  normalized: string,
  exclude?: { accountId?: string; postId?: string },
): Promise<boolean> {
  if (!normalized) return false;

  const snap = await adminDb
    .collectionGroup(SMM_POSTS_SUB)
    .where('postLinkNormalized', '==', normalized)
    .select()
    .limit(2)
    .get();

  if (!exclude?.postId) return !snap.empty;
  return snap.docs.some(
    (d) => !(d.id === exclude.postId && d.ref.parent.parent?.id === exclude.accountId),
  );
}

// ─── Full-result viral-copy report (the card's result screen) ────────

const byPostDateDesc = (a: SmmPost, b: SmmPost) =>
  (b.postDate ? new Date(b.postDate).getTime() : -Infinity) -
  (a.postDate ? new Date(a.postDate).getTime() : -Infinity);

const bySubmissionDateDesc = (a: SmmSubmission, b: SmmSubmission) =>
  (b.submissionDate ? new Date(b.submissionDate).getTime() : -Infinity) -
  (a.submissionDate ? new Date(a.submissionDate).getTime() : -Infinity);

/**
 * The full search behind the viral-copy card's result screen — every match in
 * every category, not just the newest (which is all {@link findLinkUsage}
 * keeps, since that function only needs a verdict). Runs the same three
 * collection-group queries so the report and the eligibility verdict never
 * disagree about what "used" means.
 */
export async function findLinkUsageReport(normalized: string): Promise<ViralLinkReport> {
  if (!normalized) return { originalPost: null, copies: [], submissions: [] };

  const [postLinkSnap, originalLinkSnap, subsSnap] = await Promise.all([
    adminDb.collectionGroup(SMM_POSTS_SUB).where('postLinkNormalized', '==', normalized).get(),
    adminDb.collectionGroup(SMM_POSTS_SUB).where('originalLinkNormalized', '==', normalized).get(),
    adminDb.collectionGroup(SMM_SUBMISSIONS_SUB).where('originalLinkNormalized', '==', normalized).get(),
  ]);

  const originalCandidates = postLinkSnap.docs.map(serializePost).sort(byPostDateDesc);
  const copies = originalLinkSnap.docs.map(serializePost).sort(byPostDateDesc);
  const submissions = subsSnap.docs.map(serializeSubmission).sort(bySubmissionDateDesc);

  const uids = [...new Set([
    ...originalCandidates.map((p) => p.postedBy),
    ...copies.map((p) => p.postedBy),
    ...submissions.map((s) => s.submittedBy),
  ].filter(Boolean))];
  const names = await resolveUserInfo(uids);

  const withPostedBy = (p: SmmPost): SmmPost => ({
    ...p,
    postedByName: names.get(p.postedBy)?.displayName ?? '',
    postedByPhotoURL: names.get(p.postedBy)?.photoURL ?? null,
  });
  const withSubmittedBy = (s: SmmSubmission): SmmSubmission => ({
    ...s,
    submittedByName: names.get(s.submittedBy)?.displayName ?? '',
    submittedByPhotoURL: names.get(s.submittedBy)?.photoURL ?? null,
  });

  return {
    originalPost: originalCandidates[0] ? withPostedBy(originalCandidates[0]) : null,
    copies: copies.map(withPostedBy),
    submissions: submissions.map(withSubmittedBy),
  };
}
