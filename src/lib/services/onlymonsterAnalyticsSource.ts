/**
 * OnlyFans Analytics, read from the OnlyMonster collections (migration plan §6.5).
 *
 * Each reader returns the shape the analytics fold consumes (originally BuddyX's
 * row shapes, which the archived history still uses), so the logic stays in one
 * place.
 *
 * **History stitching (§6.3).** `account-days` holds a mapped account from its
 * first OnlyMonster transaction (`onlymonster-accounts.firstTxDay`). For any day
 * before that, and for every Bluu account OnlyMonster does not cover (Fansly,
 * archived creators), the archived `creator-stats-days` rows (Infloww / BuddyX)
 * are kept, labelled with their own source. A day is never zero just because it
 * predates OnlyMonster.
 *
 * Firestore only; never the API.
 */
import 'server-only';
import { adminDb } from '../firebase-admin';
import { COLLECTIONS } from '../onlymonster/constants';
import { ONLYFANS_PLATFORM } from '../creators/accountPlatform';
import type { AccountDayDocument, BuddyxTeamRow, ChatterDayDocument, CreatorStatsDayDocument } from '@/types/firestore';

/** A Chatter Analytics team row, stamped with where it came from (absent = BuddyX). */
export type TeamRow = BuddyxTeamRow & { source?: 'buddyx' | 'onlymonster' };

/** creatorId → the first day OnlyMonster has data for it. Mapped OnlyFans accounts only. */
export async function onlyMonsterCoverage(): Promise<Map<string, string>> {
  const snap = await adminDb
    .collection(COLLECTIONS.accounts)
    .where('platform', '==', ONLYFANS_PLATFORM)
    .select('creatorId', 'firstTxDay', 'listed')
    .get();
  const out = new Map<string, string>();
  for (const d of snap.docs) {
    const creatorId = d.get('creatorId') as string | null;
    const first = d.get('firstTxDay') as string | undefined;
    if (!creatorId || !first || d.get('listed') === false) continue;
    const prev = out.get(creatorId);
    if (!prev || first < prev) out.set(creatorId, first);
  }
  return out;
}

/** `coverage` is `onlyMonsterCoverage()`, read once per request by the caller. */
export async function readStitchedDays(from: string, to: string, legacy: CreatorStatsDayDocument[], coverage: Map<string, string>): Promise<CreatorStatsDayDocument[]> {
  const snap = await adminDb.collection(COLLECTIONS.accountDays).where('day', '>=', from).where('day', '<=', to).get();
  const om = snap.docs.map(d => d.data() as AccountDayDocument);
  const kept = legacy.filter(r => {
    const first = coverage.get(r.creatorId);
    return !first || r.day < first;
  });
  return [...kept, ...om.map(r => ({ ...r, source: 'onlymonster' as const }))];
}

/** The earliest OnlyMonster day across mapped accounts: where the chart's hairline goes. */
export function onlyMonsterCutoverDay(coverage: Map<string, string>, fallback: string): string {
  return [...coverage.values()].sort()[0] ?? fallback;
}

/** Subscribers in the shape the analytics fold reads (archived `buddyx-subscribers`' shape). Includes free trials. */
export async function readOnlyMonsterSubscribers(from: string, to: string) {
  const snap = await adminDb.collection(COLLECTIONS.subDays).where('day', '>=', from).where('day', '<=', to).get();
  const out: Array<{ modelId: string | null; creatorId: string | null; subType: string | null; isTrial: boolean; isCreator: boolean; day: string }> = [];
  for (const d of snap.docs) {
    const subs = (d.get('subs') ?? {}) as Record<string, { action: string; type: string }>;
    for (const s of Object.values(subs)) {
      // `prolong` is a renewal, not a subscriber gained; it is counted in revenue, not here.
      if (s.action === 'prolong') continue;
      out.push({
        modelId: null,
        creatorId: d.get('creatorId') as string,
        subType: s.action === 'return' ? 'returning_subscriber' : 'new_subscriber',
        isTrial: s.type.includes('trial'),
        isCreator: false,
        day: d.get('day') as string,
      });
    }
  }
  return out;
}

/** Mass messages in the shape the analytics fold reads (archived `buddyx-mass-messages`' shape). */
export async function readOnlyMonsterMass(from: string, to: string) {
  const snap = await adminDb
    .collection(COLLECTIONS.massMessages)
    .where('day', '>=', from)
    .where('day', '<=', to)
    .select('creatorId', 'createdAt', 'day', 'priceGross', 'status', 'uid')
    .get();
  return snap.docs.map(d => ({
    id: d.id,
    modelId: null,
    creatorId: d.get('creatorId') as string,
    sentBy: null,
    uid: (d.get('uid') as string | null) ?? null,
    sentDate: d.get('createdAt'),
    day: d.get('day') as string,
    price: Number(d.get('priceGross')) || 0,
    previewCount: 0,
    unsent: d.get('status') === 'unsent',
    unsentBy: null,
    unsentDate: null,
    syncedAt: d.get('createdAt'),
  }));
}

// ─── Chatter Analytics (migration plan §7) ───────────────────────────

/**
 * `chatter-days` rows (OnlyMonster `/users/metrics`) in BuddyX's team-row shape,
 * so Chatter Analytics' fold works unchanged. **Revenue is never taken from
 * here for a mapped agent** — the fold prefers the `ca-sales` ledger (§7); these
 * amounts only stand in for a member with no Bluu user.
 *
 * - Online time does not exist in OnlyMonster (D12): `onlineMs` is 0 and the row is
 *   stamped `source: 'onlymonster'`, so the fold leaves it out of online time.
 * - Reply time is an **average**, never a median (§3.2): it is not put in the
 *   median fields, so no median is ever shown from OnlyMonster data.
 */
export async function readOnlyMonsterTeamRows(from: string, to: string) {
  const snap = await adminDb.collection(COLLECTIONS.chatterDays).where('day', '>=', from).where('day', '<=', to).get();
  const rows: TeamRow[] = [];
  const days = new Set<string>();
  for (const d of snap.docs) {
    days.add(d.get('day') as string);
    // A carried-over BuddyX day (D24) stores BuddyX's own row shape.
    if (d.get('source') === 'buddyx-historical') {
      rows.push(...((d.get('breakdown') ?? []) as BuddyxTeamRow[]).map(r => ({ ...r, source: 'buddyx' as const })));
      continue;
    }
    if (d.get('source') !== 'onlymonster') continue;
    const byMember = (d.get('rows') ?? {}) as ChatterDayDocument['rows'];
    for (const [memberId, r] of Object.entries(byMember)) {
      if (!r.messages && !r.ppvsSold && !r.tipsGross) continue;
      rows.push({
        chatterId: memberId,
        chatterName: null,
        uid: r.uid,
        ppvGross: r.soldGross,
        ppvsUnlocked: r.ppvsSold,
        ppvsSent: r.ppvsSent,
        ppvRate: r.messages > 0 ? r.ppvsSent / r.messages : 0,
        unlockRate: r.ppvsSent > 0 ? (r.ppvsSold / r.ppvsSent) * 100 : 0,
        fansChatted: r.chats,
        totalMessages: r.messages,
        tipsGross: r.tipsGross,
        tipsCount: 0,
        onlineMs: 0,
        medianResponseTimeMs: null,
        p75ResponseTimeMs: null,
        source: 'onlymonster',
      });
    }
  }
  return { rows, days };
}

/** OnlyMonster mass messages in the shape Chatter Analytics' summary reads. */
export async function readOnlyMonsterMassForChatters(from: string, to: string) {
  const snap = await adminDb
    .collection(COLLECTIONS.massMessages)
    .where('day', '>=', from)
    .where('day', '<=', to)
    .select('uid', 'createdById', 'priceGross', 'status', 'createdAt')
    .get();
  return snap.docs.map(d => ({
    uid: (d.get('uid') as string | null) ?? null,
    sentBy: (d.get('createdById') as string | null) ?? null,
    price: Number(d.get('priceGross')) || 0,
    unsent: d.get('status') === 'unsent',
    sentDate: d.get('createdAt'),
  }));
}
