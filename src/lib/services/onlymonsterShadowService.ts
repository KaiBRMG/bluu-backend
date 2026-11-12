/**
 * Phase 3 — the Shadow reconciliation (migration plan §10, Phase 3 gate).
 *
 * What BuddyX pays today (`ca-sales`, `source: 'buddyx'`) beside what the
 * OnlyMonster derivation would pay (`ca-sales-shadow`) and what OnlyFans itself
 * recorded (`account-days`, tips + PPV). Five readings:
 *
 * 1. **Per account-day**: BuddyX tips + PPV gross vs OnlyFans' tips + message
 *    payments. Expected equal; a difference means one source is missing sales.
 *    BuddyX stamps sales up to a minute early (V14), so a sale within a minute of
 *    midnight can land a day apart — that pair nets to zero across the two days.
 * 2. **Per agent-day**: BuddyX's holder totals vs the shadow's.
 * 3. **Impact per agent**: what moves from credited to unassigned under the
 *    strict rule (D2) — the figure to communicate before cutover.
 * 4. **Chargebacks** matched / not matched.
 * 5. **Accounts BuddyX pays that OnlyMonster does not cover** (V13).
 *
 * Firestore only. Only rows that differ are returned (rule 9i); totals carry the rest.
 */
import 'server-only';
import { adminDb } from '../firebase-admin';
import { COLLECTIONS } from '../onlymonster/constants';
import { displayNamesFor } from './userService';
import { round2 } from '../salary/salaryEngine';
import { loadMappedAccounts } from './onlymonsterLedgerService';
import { ONLYMONSTER_CUTOVER_AT } from '../salary/salaryConstants';
import { monthKeyRange, toDayKey } from '../salary/salaryDate';
import { Timestamp } from 'firebase-admin/firestore';

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, round2((m.get(k) ?? 0) + v));

export interface ShadowReport {
  month: string;
  totals: { buddyx: number; shadow: number; onlyfans: number; shadowUnassigned: Record<string, number> };
  /** `chargebacks`: tips + PPV charged back whose original was on that day. BuddyX keeps those sales; OnlyFans drops them. */
  accountDays: Array<{ creatorId: string; day: string; buddyx: number; onlyfans: number; diff: number; chargebacks: number; explained: boolean }>;
  agentDays: Array<{ uid: string | null; name: string; day: string; buddyx: number; shadow: number; diff: number }>;
  impact: Array<{ uid: string; name: string; buddyx: number; shadow: number; diff: number }>;
  chargebacks: Record<string, number>;
  uncovered: Array<{ creatorId: string; sales: number; gross: number }>;
  /**
   * Phase 4's boundary check (plan §10). Once pay writes are live, BuddyX's and
   * OnlyMonster's paid rows together are compared with OnlyFans, and these two
   * counts must be zero: no `om-*` row at or before the cutover, no `bx-*` row after it.
   */
  boundary: { cutoverAt: string | null; omAtOrBefore: number; bxAfter: number; omPaid: number };
}

export async function getShadowReport(month: string): Promise<ShadowReport> {
  const [monthStart, monthEnd] = monthKeyRange(month);
  const [bxSnap, omSnap, shSnap, adSnap, cbSnap, mapped, cbByOriginal] = await Promise.all([
    adminDb.collection('ca-sales').where('month', '==', month).where('source', '==', 'buddyx')
      .select('creatorId', 'day', 'signedGross', 'userId', 'removedAt', 'occurredAt').get(),
    adminDb.collection('ca-sales').where('month', '==', month).where('source', '==', 'onlymonster')
      .select('creatorId', 'day', 'signedGross', 'userId', 'removedAt', 'occurredAt').get(),
    adminDb.collection(COLLECTIONS.salesShadow).where('month', '==', month)
      .select('creatorId', 'day', 'signedGross', 'userId', 'attributedBy', 'removedAt').get(),
    adminDb.collection(COLLECTIONS.accountDays).where('day', '>=', `${month}-01`).where('day', '<=', `${month}-31`)
      .select('creatorId', 'day', 'tipsGross', 'messagesGross').get(),
    adminDb.collection(COLLECTIONS.chargebacks).where('month', '==', month).select('matchState', 'category', 'removedAt').get(),
    loadMappedAccounts(),
    adminDb.collection(COLLECTIONS.chargebacks)
      .where('transactionAt', '>=', Timestamp.fromMillis(monthStart))
      .where('transactionAt', '<=', Timestamp.fromMillis(monthEnd))
      .select('creatorId', 'transactionAt', 'amount', 'category', 'removedAt').get(),
  ]);
  // Charged-back tips / PPV by the original's account-day: what explains BuddyX > OnlyFans.
  const cbAcct = new Map<string, number>();
  for (const d of cbByOriginal.docs) {
    if (d.get('removedAt') || !['tip', 'message'].includes(d.get('category'))) continue;
    add(cbAcct, `${d.get('creatorId')}|${toDayKey((d.get('transactionAt') as Timestamp).toMillis())}`, Number(d.get('amount')) || 0);
  }
  const covered = new Set(mapped.map(a => a.creatorId));

  const bxAcct = new Map<string, number>();
  const bxAgent = new Map<string, number>();
  const bxAgentMonth = new Map<string, number>();
  const bxUncovered = new Map<string, { sales: number; gross: number }>();
  let bxTotal = 0;
  const cutover = Number.isFinite(ONLYMONSTER_CUTOVER_AT) ? ONLYMONSTER_CUTOVER_AT : null;
  let omAtOrBefore = 0;
  let bxAfter = 0;
  let omPaid = 0;
  for (const d of bxSnap.docs) if (cutover !== null && !d.get('removedAt') && d.get('occurredAt')?.toMillis?.() > cutover) bxAfter += 1;
  for (const d of omSnap.docs) {
    if (d.get('removedAt')) continue;
    if (cutover !== null && d.get('occurredAt')?.toMillis?.() <= cutover) omAtOrBefore += 1;
    omPaid += Number(d.get('signedGross')) || 0;
  }
  // After the cutover the paid side is BuddyX's rows plus OnlyMonster's live rows.
  for (const d of [...bxSnap.docs, ...omSnap.docs]) {
    if (d.get('removedAt')) continue;
    const g = Number(d.get('signedGross')) || 0;
    const creatorId = (d.get('creatorId') as string | null) ?? '';
    const uid = (d.get('userId') as string | null) ?? '';
    bxTotal += g;
    if (!covered.has(creatorId)) {
      const u = bxUncovered.get(creatorId) ?? { sales: 0, gross: 0 };
      bxUncovered.set(creatorId, { sales: u.sales + 1, gross: round2(u.gross + g) });
      continue; // not comparable: OnlyMonster never sees this account
    }
    add(bxAcct, `${creatorId}|${d.get('day')}`, g);
    add(bxAgent, `${uid}|${d.get('day')}`, g);
    if (uid) add(bxAgentMonth, uid, g);
  }

  const shAgent = new Map<string, number>();
  const shAgentMonth = new Map<string, number>();
  const unassigned: Record<string, number> = {};
  let shTotal = 0;
  for (const d of shSnap.docs) {
    if (d.get('removedAt')) continue;
    const g = Number(d.get('signedGross')) || 0;
    const uid = (d.get('userId') as string | null) ?? '';
    shTotal += g;
    add(shAgent, `${uid}|${d.get('day')}`, g);
    if (uid) add(shAgentMonth, uid, g);
    else {
      const why = String(d.get('attributedBy') ?? 'unscheduled');
      unassigned[why] = round2((unassigned[why] ?? 0) + g);
    }
  }

  const ofAcct = new Map<string, number>();
  let ofTotal = 0;
  for (const d of adSnap.docs) {
    const g = (Number(d.get('tipsGross')) || 0) + (Number(d.get('messagesGross')) || 0);
    ofTotal += g;
    add(ofAcct, `${d.get('creatorId')}|${d.get('day')}`, g);
  }

  const accountDays = [...new Set([...bxAcct.keys(), ...ofAcct.keys()])]
    .map(k => {
      const [creatorId, day] = k.split('|');
      const buddyx = bxAcct.get(k) ?? 0;
      const onlyfans = ofAcct.get(k) ?? 0;
      const diff = round2(onlyfans - buddyx);
      const chargebacks = cbAcct.get(k) ?? 0;
      return { creatorId, day, buddyx, onlyfans, diff, chargebacks, explained: chargebacks > 0 && Math.abs(diff + chargebacks) < 0.01 };
    })
    .filter(r => Math.abs(r.diff) >= 0.01)
    .sort((a, b) => a.day.localeCompare(b.day) || a.creatorId.localeCompare(b.creatorId));

  const agentKeys = [...new Set([...bxAgent.keys(), ...shAgent.keys()])];
  const uids = [...new Set([...agentKeys.map(k => k.split('|')[0]), ...bxAgentMonth.keys(), ...shAgentMonth.keys()].filter(Boolean))];
  const names = await displayNamesFor(uids);
  const nameOf = (uid: string) => (uid ? names.get(uid) ?? uid : 'Unassigned');

  const agentDays = agentKeys
    .map(k => {
      const [uid, day] = k.split('|');
      const buddyx = bxAgent.get(k) ?? 0;
      const shadow = shAgent.get(k) ?? 0;
      return { uid: uid || null, name: nameOf(uid), day, buddyx, shadow, diff: round2(shadow - buddyx) };
    })
    .filter(r => Math.abs(r.diff) >= 0.01)
    .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));

  const impact = uids
    .map(uid => {
      const buddyx = bxAgentMonth.get(uid) ?? 0;
      const shadow = shAgentMonth.get(uid) ?? 0;
      return { uid, name: nameOf(uid), buddyx, shadow, diff: round2(shadow - buddyx) };
    })
    .sort((a, b) => a.diff - b.diff);

  const chargebacks: Record<string, number> = {};
  for (const d of cbSnap.docs) {
    if (d.get('removedAt')) continue;
    const k = `${d.get('category')}.${d.get('matchState')}`;
    chargebacks[k] = (chargebacks[k] ?? 0) + 1;
  }

  return {
    month,
    totals: { buddyx: round2(bxTotal), shadow: round2(shTotal), onlyfans: round2(ofTotal), shadowUnassigned: unassigned },
    accountDays,
    agentDays,
    impact,
    chargebacks,
    uncovered: [...bxUncovered].map(([creatorId, v]) => ({ creatorId, ...v })),
    boundary: { cutoverAt: cutover === null ? null : new Date(cutover).toISOString(), omAtOrBefore, bxAfter, omPaid: round2(omPaid) },
  };
}
