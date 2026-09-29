import 'server-only';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  SEXUALITY_TO_ORIENTATION,
  completionErrors,
  progressOf,
  sanitisePatch,
  stripAt,
  type Answers,
  type OnboardingStatus,
  type OnboardingTrack,
} from '@/lib/creatorOnboarding';
import { serializeTimestamp as iso } from '@/lib/middleware/apiHelpers';
import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';
import { displayNamesFor } from '@/lib/services/userService';
import { SUBMISSIONS_COLLECTION, getSubmission } from '@/lib/services/modelSubmissionService';
import type { ModelSubmissionDocument } from '@/types/modelSubmission';
import type {
  OnboardingCursor,
  OnboardingDetail,
  OnboardingSummary,
  PublicOnboarding,
} from '@/types/creatorOnboarding';

/**
 * Creator onboarding — the personalised form an approved applicant fills in.
 *
 * `creator-onboarding/{submissionId}` — one per approved application, keyed by
 * the application's own id so the two records never need a lookup to join.
 * Admin-SDK only (rules deny every client path); see
 * documentation/creator-onboarding.md.
 *
 * THE LINK IS THE CREDENTIAL. `/join/<token>` where the token is the 32-hex
 * submission id followed by a 160-bit random secret. Only a SHA-256 of the
 * secret is stored, so a leaked database export does not leak working links,
 * and re-sending the invite rotates the secret — the old link stops working the
 * moment a new one is issued, while every answer already given is kept.
 */

export const ONBOARDING_COLLECTION = 'creator-onboarding';

const ID_LEN = 32;
const SECRET_BYTES = 20;

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function splitToken(token: string): { id: string; secret: string } | null {
  if (typeof token !== 'string' || token.length < ID_LEN + 20 || token.length > ID_LEN + 60) return null;
  const id = token.slice(0, ID_LEN);
  const secret = token.slice(ID_LEN);
  if (!/^[a-f0-9]{32}$/.test(id) || !/^[A-Za-z0-9_-]+$/.test(secret)) return null;
  return { id, secret };
}

export function onboardingUrl(token: string): string {
  return `${PUBLIC_APP_ORIGIN}/join/${token}`;
}

/** Non-secret, human-sized reference printed on the welcome pass. */
export function passNumber(id: string): string {
  return `BR-${id.slice(0, 4).toUpperCase()}`;
}

const normTrack = (d: FirebaseFirestore.DocumentData): OnboardingTrack => (d.track === 'of' ? 'of' : 'no-of');
const normStatus = (d: FirebaseFirestore.DocumentData): OnboardingStatus =>
  d.status === 'completed' ? 'completed' : d.status === 'started' ? 'started' : 'invited';

function validCursor(c: unknown): OnboardingCursor | null {
  const v = c as Partial<OnboardingCursor> | null | undefined;
  if (!v || !Number.isInteger(v.chapter) || !Number.isInteger(v.screen)) return null;
  if (v.chapter! < 0 || v.chapter! >= 10 || v.screen! < 0 || v.screen! >= 40) return null;
  return { chapter: v.chapter!, screen: v.screen! };
}

// ─── Prefill ─────────────────────────────────────────────────────────────────

/**
 * Seeds the form from the application, so nobody types their city twice. Only
 * fields the applicant actually gave us — an absent value stays absent rather
 * than becoming a plausible-looking default.
 */
export function prefillFrom(sub: ModelSubmissionDocument): Answers {
  const a: Answers = {};
  if (sub.telegram) a.telegram = stripAt(sub.telegram);
  if (sub.city) a.city = sub.city;
  if (sub.country) a.country = sub.country;
  if (sub.socialLinks) a.socials = sub.socialLinks;
  const orientation = SEXUALITY_TO_ORIENTATION[sub.sexuality];
  if (orientation) {
    a.orientation = orientation;
    a.pSexuality = orientation;
  }
  if (sub.hasOnlyFans && sub.trialLink) a.ofTrialLink = sub.trialLink;
  if (sub.city || sub.country) a.pLocation = [sub.city, sub.country].filter(Boolean).join(', ');
  if (sub.age) a.pAge = String(sub.age);
  return a;
}

// ─── Invites ─────────────────────────────────────────────────────────────────

export class InviteRefused extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface IssuedInvite {
  token: string;
  url: string;
  submission: ModelSubmissionDocument;
  /** 1 on the first invite, then counts re-sends. */
  inviteCount: number;
}

/**
 * Creates the onboarding record (first invite) or rotates its link (re-send).
 *
 * Refuses unless the application is `approved`, and refuses a re-send once the
 * form is completed — there is nothing left to fill in, and a fresh link would
 * only reopen a submitted record.
 */
export async function issueInvite(submissionId: string, invitedBy: string): Promise<IssuedInvite> {
  const submission = await getSubmission(submissionId);
  if (!submission) throw new InviteRefused('Application not found', 404);
  if (submission.status !== 'approved') {
    throw new InviteRefused('Approve the application before sending onboarding', 409);
  }
  if (!submission.email) throw new InviteRefused('This application has no email address', 409);

  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  const tokenHash = hashSecret(secret);
  const ref = adminDb.collection(ONBOARDING_COLLECTION).doc(submissionId);
  const subRef = adminDb.collection(SUBMISSIONS_COLLECTION).doc(submissionId);
  const track: OnboardingTrack = submission.hasOnlyFans ? 'of' : 'no-of';

  const inviteCount = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = FieldValue.serverTimestamp();

    if (snap.exists) {
      const d = snap.data() ?? {};
      if (d.status === 'completed') {
        throw new InviteRefused('This creator has already completed onboarding', 409);
      }
      const count = (typeof d.inviteCount === 'number' ? d.inviteCount : 1) + 1;
      tx.update(ref, { tokenHash, invitedAt: now, invitedBy, inviteCount: count });
      tx.update(subRef, { onboardingInvitedAt: now, onboardingInvitedBy: invitedBy });
      return count;
    }

    const answers = prefillFrom(submission);
    const progress = progressOf(track, answers);
    tx.set(ref, {
      submissionId,
      name: submission.name,
      email: submission.email,
      whatsapp: submission.whatsapp,
      telegram: answers.telegram ?? '',
      stageName: '',
      track,
      tokenHash,
      status: 'invited' satisfies OnboardingStatus,
      answers,
      cursor: null,
      requiredAnswered: progress.requiredAnswered,
      requiredTotal: progress.requiredTotal,
      invitedAt: now,
      invitedBy,
      inviteCount: 1,
      approvedAt: submission.reviewedAt ? Timestamp.fromDate(new Date(submission.reviewedAt)) : now,
      openedAt: null,
      lastActivityAt: null,
      completedAt: null,
    });
    tx.update(subRef, { onboardingInvitedAt: now, onboardingInvitedBy: invitedBy });
    return 1;
  });

  const token = `${submissionId}${secret}`;
  return { token, url: onboardingUrl(token), submission, inviteCount };
}

/** Records the id of the email that carried the link, for support. */
export async function recordInviteEmail(submissionId: string, emailId: string): Promise<void> {
  await adminDb.collection(ONBOARDING_COLLECTION).doc(submissionId).update({ lastInviteEmailId: emailId });
}

// ─── The link holder ─────────────────────────────────────────────────────────

interface Loaded {
  id: string;
  ref: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
  track: OnboardingTrack;
  status: OnboardingStatus;
  answers: Answers;
}

/**
 * Resolves a link token to its record, or null. One document read — the id is
 * in the token — and a timing-safe comparison of the secret's hash. Every
 * refusal is the same null, so a caller learns nothing about which half failed.
 */
async function loadByToken(token: string): Promise<Loaded | null> {
  const parts = splitToken(token);
  if (!parts) return null;
  const ref = adminDb.collection(ONBOARDING_COLLECTION).doc(parts.id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const expected = Buffer.from(String(data.tokenHash ?? ''), 'hex');
  const given = Buffer.from(hashSecret(parts.secret), 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return {
    id: parts.id,
    ref,
    data,
    track: normTrack(data),
    status: normStatus(data),
    answers: (data.answers ?? {}) as Answers,
  };
}

/**
 * The public page's read. Read-only on purpose: `openedAt` is NOT stamped here.
 * Mail security scanners (Outlook Safe Links and friends) fetch every link in
 * an email before the recipient does, so a server-render stamp would mark
 * applicants "opened" who never saw the page. The page pings the autosave
 * route from the browser instead — see `saveAnswers`' empty-patch path.
 */
export async function openByToken(token: string): Promise<PublicOnboarding | null> {
  const loaded = await loadByToken(token);
  if (!loaded) return null;
  const { data } = loaded;

  return {
    name: String(data.name ?? ''),
    track: loaded.track,
    status: loaded.status,
    answers: loaded.answers,
    cursor: validCursor(data.cursor),
    approvedAt: iso(data.approvedAt),
    completedAt: iso(data.completedAt),
    passNo: passNumber(loaded.id),
  };
}

export type SaveResult =
  | { ok: true; requiredAnswered: number; requiredTotal: number }
  | { ok: false; reason: 'not-found' | 'locked' };

/**
 * Autosave. Merges only the fields in the patch (dotted `answers.<id>` paths —
 * no read-modify-write of the whole map, so two tabs saving different fields
 * cannot erase each other), plus the resume cursor and progress counters.
 */
export async function saveAnswers(
  token: string,
  patch: unknown,
  cursor: unknown,
): Promise<SaveResult> {
  const loaded = await loadByToken(token);
  if (!loaded) return { ok: false, reason: 'not-found' };
  if (loaded.status === 'completed') return { ok: false, reason: 'locked' };

  const clean = sanitisePatch(loaded.track, patch);
  const nextCursor = validCursor(cursor);

  // An empty patch is the page's "a real browser opened this" ping: stamp
  // `openedAt` once and change nothing else — it is not activity, and it must
  // not move the record to `started`.
  if (Object.keys(clean).length === 0 && !nextCursor) {
    if (!loaded.data.openedAt) await loaded.ref.update({ openedAt: FieldValue.serverTimestamp() });
    const p = progressOf(loaded.track, loaded.answers);
    return { ok: true, requiredAnswered: p.requiredAnswered, requiredTotal: p.requiredTotal };
  }

  const merged = { ...loaded.answers, ...clean };
  const progress = progressOf(loaded.track, merged);

  const update: Record<string, unknown> = {
    lastActivityAt: FieldValue.serverTimestamp(),
    requiredAnswered: progress.requiredAnswered,
    requiredTotal: progress.requiredTotal,
  };
  for (const [key, value] of Object.entries(clean)) update[`answers.${key}`] = value;
  if (loaded.status === 'invited') update.status = 'started' satisfies OnboardingStatus;
  if (!loaded.data.openedAt) update.openedAt = FieldValue.serverTimestamp();
  // Denormalised for the staff list, which never reads `answers`.
  if ('stageName' in clean) update.stageName = clean.stageName.trim();
  if ('telegram' in clean) update.telegram = stripAt(clean.telegram).trim();

  if (nextCursor) update.cursor = nextCursor;

  await loaded.ref.update(update);
  return { ok: true, requiredAnswered: progress.requiredAnswered, requiredTotal: progress.requiredTotal };
}

export type CompleteResult =
  | { ok: true; id: string; name: string; stageName: string; telegram: string }
  | { ok: false; reason: 'not-found' | 'locked' }
  | { ok: false; reason: 'incomplete'; fields: Record<string, string> };

/** Final submit: every required answer present and well-formed, then locked. */
export async function completeByToken(token: string, patch: unknown): Promise<CompleteResult> {
  const loaded = await loadByToken(token);
  if (!loaded) return { ok: false, reason: 'not-found' };
  if (loaded.status === 'completed') return { ok: false, reason: 'locked' };

  // The last keystrokes may not have autosaved yet — fold them in first.
  const clean = sanitisePatch(loaded.track, patch);
  const answers = { ...loaded.answers, ...clean };
  const fields = completionErrors(loaded.track, answers);
  if (Object.keys(fields).length > 0) return { ok: false, reason: 'incomplete', fields };

  const progress = progressOf(loaded.track, answers);
  const stageName = (answers.stageName ?? '').trim();
  const telegram = stripAt(answers.telegram ?? '').trim();
  const update: Record<string, unknown> = {
    status: 'completed' satisfies OnboardingStatus,
    completedAt: FieldValue.serverTimestamp(),
    lastActivityAt: FieldValue.serverTimestamp(),
    requiredAnswered: progress.requiredAnswered,
    requiredTotal: progress.requiredTotal,
    stageName,
    telegram,
  };
  for (const [key, value] of Object.entries(clean)) update[`answers.${key}`] = value;
  await loaded.ref.update(update);

  return {
    ok: true,
    id: loaded.id,
    name: String(loaded.data.name ?? ''),
    stageName,
    telegram,
  };
}

// ─── Staff reads ─────────────────────────────────────────────────────────────

/** Every field the list shows — `answers` and `tokenHash` never leave Firestore here. */
const SUMMARY_FIELDS = [
  'name',
  'stageName',
  'email',
  'telegram',
  'whatsapp',
  'track',
  'status',
  'invitedAt',
  'invitedBy',
  'openedAt',
  'lastActivityAt',
  'completedAt',
  'requiredAnswered',
  'requiredTotal',
  'inviteCount',
] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSummary(id: string, d: any, names: Map<string, string>): OnboardingSummary {
  return {
    id,
    name: d.name ?? '',
    stageName: d.stageName ?? '',
    email: d.email ?? '',
    telegram: d.telegram ?? '',
    whatsapp: d.whatsapp ?? '',
    track: normTrack(d),
    status: normStatus(d),
    invitedAt: iso(d.invitedAt),
    invitedByName: d.invitedBy ? names.get(d.invitedBy) ?? 'Unknown' : null,
    openedAt: iso(d.openedAt),
    lastActivityAt: iso(d.lastActivityAt),
    completedAt: iso(d.completedAt),
    requiredAnswered: typeof d.requiredAnswered === 'number' ? d.requiredAnswered : 0,
    requiredTotal: typeof d.requiredTotal === 'number' ? d.requiredTotal : 0,
    inviteCount: typeof d.inviteCount === 'number' ? d.inviteCount : 1,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */


/** Newest invite first. Projected with `select()` so no answers are read over the wire. */
export async function listOnboardings(limit = 500): Promise<OnboardingSummary[]> {
  const snap = await adminDb
    .collection(ONBOARDING_COLLECTION)
    .orderBy('invitedAt', 'desc')
    .limit(limit)
    .select(...SUMMARY_FIELDS)
    .get();
  const names = await displayNamesFor(snap.docs.map((d) => d.data().invitedBy));
  return snap.docs.map((d) => toSummary(d.id, d.data(), names));
}

export async function getOnboardingDetail(id: string): Promise<OnboardingDetail | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const [snap, submission] = await Promise.all([
    adminDb.collection(ONBOARDING_COLLECTION).doc(id).get(),
    getSubmission(id),
  ]);
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  const names = await displayNamesFor([d.invitedBy]);
  return {
    ...toSummary(snap.id, d, names),
    answers: (d.answers ?? {}) as Answers,
    city: submission?.city ?? '',
    country: submission?.country ?? '',
    age: submission?.age ?? 0,
  };
}
