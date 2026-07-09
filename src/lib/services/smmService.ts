import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { serializeTimestamp } from '@/lib/middleware/apiHelpers';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { SMM_ACCOUNT_TYPES, SMM_NETWORKS, SMM_STATUS_LATE } from '@/types/firestore';
import type {
  SmmAccount,
  SmmAccountStatus,
  SmmBonusRound,
  SmmNetwork,
  SmmPost,
  SmmSubmission,
  SmmTier,
} from '@/types/firestore';

// ─── Collections ─────────────────────────────────────────────────────

export const SMM_ACCOUNTS = 'twitterx-accounts';
export const SMM_SCHEDULE = 'twitterx-content-schedule';
export const SMM_BONUS = 'twitterx-bonus';
export const SMM_POSTS_SUB = 'posts';
export const SMM_SUBMISSIONS_SUB = 'submissions';

// ─── Access gates ────────────────────────────────────────────────────

export type SmmAccessNeed = 'dashboard' | 'admin' | 'either';

/**
 * Page-permission gate for SMM API routes. 'admin' = the smm-admin page,
 * which is shared via page permissions like any other page (NOT the admin
 * JWT claim — these routes only touch SMM data, not the auth graph).
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
    tier: (d.tier ?? 1) as SmmTier,
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
    tier: (d.tier ?? 1) as SmmTier,
    bonusAmount: d.bonusAmount ?? 0,
    sysComments: d.sysComments ?? '',
    adminApproval: d.adminApproval ?? 'pending',
    isResidual: d.isResidual ?? false,
  };
}

// ─── Validation ──────────────────────────────────────────────────────

/** Enum validation shared by the account create + update handlers. */
export function validateAccountFields(body: {
  type?: string[];
  network?: string;
  tier?: number;
  status?: string;
  assigned?: string | null;
}): NextResponse | null {
  if (body.type !== undefined) {
    if (!Array.isArray(body.type) || body.type.some((t) => !(SMM_ACCOUNT_TYPES as readonly string[]).includes(t))) {
      return NextResponse.json({ error: 'Invalid account type' }, { status: 400 });
    }
  }
  if (body.network !== undefined && !(SMM_NETWORKS as readonly string[]).includes(body.network)) {
    return NextResponse.json({ error: 'Invalid network' }, { status: 400 });
  }
  if (body.tier !== undefined && body.tier !== 1 && body.tier !== 2) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
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

/** Latest round by roundDateStart, or null before the first round exists. */
export async function getCurrentRoundSnap(): Promise<DocumentSnapshot | null> {
  const snap = await adminDb
    .collection(SMM_BONUS)
    .orderBy('roundDateStart', 'desc')
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
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

/**
 * Find the most recent prior use of a normalized link — as a scheduled post
 * (postLinkNormalized) or as a viral-copy source of an earlier bonus
 * (originalLinkNormalized). Powers the wizard's eligibility check, so it runs
 * both on the eligibility route and again server-side at submit time (the
 * client's result is never trusted). Returns null when the link is unused.
 */
export async function findLinkUsage(normalized: string): Promise<LinkUsage | null> {
  if (!normalized) return null;

  const [posts, subs] = await Promise.all([
    adminDb.collectionGroup(SMM_POSTS_SUB).where('postLinkNormalized', '==', normalized).get(),
    adminDb.collectionGroup(SMM_SUBMISSIONS_SUB).where('originalLinkNormalized', '==', normalized).get(),
  ]);

  const candidates: LinkUsage[] = [];
  for (const doc of posts.docs) {
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
