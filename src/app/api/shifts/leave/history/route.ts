import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getRecentLeaveLedger } from '@/lib/services/leaveLedger';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LeaveLedgerAction, LeaveLedgerDocument, LeaveRequestDocument } from '@/types/firestore';

// ─── GET /api/shifts/leave/history ───────────────────────────────────────────
//
// Coverage → History: every decided or withdrawn leave request, its outcome,
// and the balance trail from `leave-ledger` (see `leaveLedger.ts`).
//
// Two sources, merged by `leaveId`, because neither is complete alone:
// - `leave_requests` holds decided requests, including those decided before the
//   ledger existed (which therefore have no balance trail).
// - `leave-ledger` is the only record of a **withdrawn** request, whose document
//   the DELETE route removes.
//
// Same access tier as the approvals queue (`scope=all` on the parent route):
// shift-management or ca-admin.
//
// Not cached (rule 9i): it sits one tab away from the queue that writes it, and
// an admin who has just denied a request expects to see it here immediately.
// Two bounded queries plus one `getAll` for names.

const REQUEST_LIMIT = 400;
const LEDGER_LIMIT = 600;

type Outcome = 'approved' | 'denied' | 'withdrawn';

export interface LeaveHistoryEvent {
  action: LeaveLedgerAction;
  before: number;
  after: number;
  at: string | null;
  actorName: string | null;
}

export interface LeaveHistoryRow {
  leaveId: string;
  userId: string;
  displayName: string | null;
  photoURL: string | null;
  leaveType: 'paid' | 'unpaid';
  occurrenceStart: number;
  reason: string | null;
  outcome: Outcome;
  /** When it reached its outcome — the decision, or the withdrawal. */
  decidedAt: string | null;
  decidedByName: string | null;
  /** Oldest first. Empty for a request decided before the ledger existed. */
  events: LeaveHistoryEvent[];
  /** For a withdrawal: whether it was pending, approved or denied at the time. */
  withdrawnFrom: string | null;
}

const iso = (ts: unknown): string | null =>
  (ts as { toDate?: () => Date } | null | undefined)?.toDate?.()?.toISOString() ?? null;

export const GET = withAuth(async (_request, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    const permitted = caller?.permittedPageIds ?? [];
    if (!permitted.includes('shift-management') && !permitted.includes('ca-admin')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [requestSnap, ledger] = await Promise.all([
      adminDb
        .collection('leave_requests')
        .where('status', 'in', ['approved', 'denied'])
        .limit(REQUEST_LIMIT)
        .get(),
      getRecentLeaveLedger(LEDGER_LIMIT),
    ]);

    const eventsByLeave = new Map<string, LeaveLedgerDocument[]>();
    for (const entry of ledger) {
      const list = eventsByLeave.get(entry.leaveId);
      if (list) list.push(entry);
      else eventsByLeave.set(entry.leaveId, [entry]);
    }
    for (const list of eventsByLeave.values()) {
      list.sort((a, b) => (a.at?.toMillis?.() ?? 0) - (b.at?.toMillis?.() ?? 0));
    }

    type Draft = Omit<LeaveHistoryRow, 'displayName' | 'photoURL' | 'decidedByName' | 'events'> & {
      decidedBy: string | null;
      entries: LeaveLedgerDocument[];
    };
    const drafts: Draft[] = [];
    const seen = new Set<string>();

    for (const doc of requestSnap.docs) {
      const leave = doc.data() as LeaveRequestDocument;
      seen.add(leave.leaveId);
      drafts.push({
        leaveId: leave.leaveId,
        userId: leave.userId,
        leaveType: leave.leaveType,
        occurrenceStart: leave.occurrenceStart,
        reason: leave.reason ?? null,
        outcome: leave.status as Outcome,
        decidedAt: iso(leave.resolvedAt),
        decidedBy: leave.resolvedBy ?? null,
        withdrawnFrom: null,
        entries: eventsByLeave.get(leave.leaveId) ?? [],
      });
    }

    // Withdrawn requests exist only in the ledger. A leaveId with no document
    // whose last entry is not a withdrawal is a pending request — the queue's
    // business, not history's.
    for (const [leaveId, entries] of eventsByLeave) {
      if (seen.has(leaveId)) continue;
      const last = entries[entries.length - 1];
      if (last.action !== 'withdrawn') continue;
      drafts.push({
        leaveId,
        userId: last.userId,
        leaveType: last.leaveType,
        occurrenceStart: last.occurrenceStart,
        reason: null,
        outcome: 'withdrawn',
        decidedAt: iso(last.at),
        decidedBy: last.actorUid,
        withdrawnFrom: last.priorStatus ?? null,
        entries,
      });
    }

    // Names for requesters, deciders and every actor in a trail, in one read
    // (rule 9).
    const uids = new Set<string>();
    for (const draft of drafts) {
      uids.add(draft.userId);
      if (draft.decidedBy) uids.add(draft.decidedBy);
      for (const entry of draft.entries) uids.add(entry.actorUid);
    }
    const people = new Map<string, { displayName: string | null; photoURL: string | null }>();
    if (uids.size > 0) {
      const snaps = await adminDb.getAll(...[...uids].map(uid => adminDb.collection('users').doc(uid)));
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const data = snap.data();
        people.set(snap.id, { displayName: data?.displayName ?? null, photoURL: data?.photoURL ?? null });
      }
    }
    const nameOf = (uid: string | null) => (uid ? people.get(uid)?.displayName ?? null : null);

    const rows: LeaveHistoryRow[] = drafts
      .map(({ decidedBy, entries, ...draft }) => ({
        ...draft,
        displayName: nameOf(draft.userId),
        photoURL: people.get(draft.userId)?.photoURL ?? null,
        decidedByName: nameOf(decidedBy),
        events: entries.map(entry => ({
          action: entry.action,
          before: entry.balanceBefore,
          after: entry.balanceAfter,
          at: iso(entry.at),
          actorName: nameOf(entry.actorUid),
        })),
      }))
      // Most recently decided first: history is read backwards from today.
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));

    return NextResponse.json(
      { rows },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    console.error('[shifts/leave/history GET]', err);
    return NextResponse.json({ error: 'Failed to load leave history' }, { status: 500 });
  }
});
