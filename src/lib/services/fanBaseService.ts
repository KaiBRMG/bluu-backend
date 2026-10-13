/**
 * The fan base — one fan across every creator, bridging BuddyX/Infloww sales
 * with the custom-request pipeline. Three read models:
 *
 * - **Directory** (`/ca-portal/fan-analytics`, All fans) — every fan in the
 *   viewer's scope with spend and customs folded together, searchable.
 * - **Report** (`/ca-portal/fan-analytics/[fanKey]`) — everything about one fan.
 * - **Lookup** — the custom-request wizard's fan search.
 *
 * Scope follows Fan Analytics (D9): an agent sees the creators they are
 * rostered on this month, `ca-admin` sees all. Firestore only; nothing here
 * calls BuddyX. Registry writes live in `fanRegistryService`.
 */
import 'server-only';
import type { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { round2 } from '../salary/salaryEngine';
import { saleKindOf, saleSourceOf } from '../salary/saleTypes';
import { CAMPAIGN_TYPES } from '../campaignTracking';
import {
  automaticFanName,
  customMoney,
  fanKeyOf,
  isHandleKey,
  isValidFanKey,
  parseProfileLink,
  profileLinkForKey,
  resolveFanName,
  type FanNameSource,
} from '../fans/fanIdentity';
import { readFans, resolveFanScope, summariseFan } from './buddyxAnalyticsService';
import { FAN_REGISTRY, readCustomsFans, resolveFanKeyForLink } from './fanRegistryService';
import { displayNamesFor } from './userService';
import type {
  FanCustomItem,
  FanDirectory,
  FanDirectoryFilter,
  FanDirectoryRow,
  FanDirectorySort,
  FanLookupHit,
  FanPurchase,
  FanReport,
} from '../buddyx/analyticsTypes';
import type { BuddyxFanDocument, CaSaleDocument, FanRegistryDocument } from '@/types/firestore';

const CUSTOMS = 'campaign-tracking';

/** Drop a working field before a row leaves the server. */
function withoutKey<K extends string>(key: K) {
  return <T extends Record<K, unknown>>(row: T): Omit<T, K> => {
    const copy = { ...row };
    delete copy[key];
    return copy;
  };
}

type RegistryEntry = FanRegistryDocument & { key: string };

// ─── Directory ───────────────────────────────────────────────────────

export async function getFanDirectory(params: {
  viewerUid: string;
  isAdmin: boolean;
  creatorId: string | null;
  q: string;
  filter: FanDirectoryFilter;
  sort: FanDirectorySort;
  offset: number;
  limit: number;
}): Promise<FanDirectory & { scope: string[] }> {
  const { scope, creatorIds } = await resolveFanScope({ viewerUid: params.viewerUid, isAdmin: params.isAdmin, requested: params.creatorId });
  const emptyCounts = { all: 0, customs: 0, owes: 0, unnamed: 0, unmatched: 0 };
  if (creatorIds.length === 0 && !params.isAdmin) return { rows: [], total: 0, counts: emptyCounts, scope };

  const [fanDocs, customsFans] = await Promise.all([creatorIds.length ? readFans(creatorIds) : Promise.resolve([]), readCustomsFans()]);
  const inScope = new Set(creatorIds);
  // An admin with no creator filter sees every fan with customs, mapped creator or not.
  const customsVisible = (entry: RegistryEntry) =>
    params.isAdmin && !params.creatorId ? true : (entry.customsCreatorIds ?? []).some(id => inScope.has(id));

  const rows = new Map<string, FanDirectoryRow & { lastCustomAt: number | null }>();
  for (const doc of fanDocs) {
    const summary = summariseFan(doc, null);
    const row = rows.get(doc.fanId) ?? {
      fanKey: doc.fanId,
      fanId: doc.fanId,
      handle: null,
      name: null,
      nameSource: null,
      creatorIds: [],
      lifetimeSpend: 0,
      lastPurchaseAt: null,
      customs: 0,
      outstandingAmount: 0,
      unmatched: false,
      lastCustomAt: null,
    };
    row.creatorIds.push(doc.creatorId);
    row.lifetimeSpend = round2(row.lifetimeSpend + summary.lifetimeSpend);
    if (summary.lastPurchaseAt && (!row.lastPurchaseAt || summary.lastPurchaseAt > row.lastPurchaseAt)) row.lastPurchaseAt = summary.lastPurchaseAt;
    if (!row.name && summary.name) {
      row.name = summary.name;
      row.nameSource = summary.nameSource;
    }
    rows.set(doc.fanId, row);
  }
  for (const entry of customsFans) {
    if (!customsVisible(entry)) continue;
    const resolved = resolveFanName(entry);
    const row = rows.get(entry.key) ?? {
      fanKey: entry.key,
      fanId: entry.fanId ?? null,
      handle: entry.handle ?? null,
      name: null,
      nameSource: null,
      creatorIds: [],
      lifetimeSpend: 0,
      lastPurchaseAt: null,
      customs: 0,
      outstandingAmount: 0,
      unmatched: isHandleKey(entry.key),
      lastCustomAt: null,
    };
    // The registry is the truth for the name; the rollup's copy can lag a minute.
    if (resolved.name) {
      row.name = resolved.name;
      row.nameSource = resolved.source;
    }
    row.customs = entry.customsCount ?? 0;
    row.outstandingAmount = entry.customsOutstandingAmount ?? 0;
    row.lastCustomAt = (entry.lastCustomAt as Timestamp | null | undefined)?.toMillis?.() ?? null;
    for (const id of entry.customsCreatorIds ?? []) if (!row.creatorIds.includes(id) && (params.isAdmin || inScope.has(id))) row.creatorIds.push(id);
    rows.set(entry.key, row);
  }

  // Search first, then the counts (so each chip says what it would show), then the filter.
  const matcher = searchMatcher(params.q);
  const searched = [...rows.values()].filter(matcher);
  const counts = {
    all: searched.length,
    customs: searched.filter(r => r.customs > 0).length,
    owes: searched.filter(r => r.outstandingAmount > 0).length,
    unnamed: searched.filter(r => !r.name).length,
    unmatched: searched.filter(r => r.unmatched).length,
  };
  const filtered = searched.filter(r => {
    switch (params.filter) {
      case 'customs': return r.customs > 0;
      case 'owes': return r.outstandingAmount > 0;
      case 'unnamed': return !r.name;
      case 'unmatched': return r.unmatched;
      default: return true;
    }
  });
  const recency = (r: { lastPurchaseAt: number | null; lastCustomAt: number | null }) => Math.max(r.lastPurchaseAt ?? 0, r.lastCustomAt ?? 0);
  filtered.sort((a, b) => {
    switch (params.sort) {
      case 'recent': return recency(b) - recency(a);
      case 'customs': return b.customs - a.customs || b.outstandingAmount - a.outstandingAmount || b.lifetimeSpend - a.lifetimeSpend;
      case 'name':
        if (!a.name !== !b.name) return a.name ? -1 : 1;
        return (a.name ?? a.fanKey).localeCompare(b.name ?? b.fanKey);
      default: return b.lifetimeSpend - a.lifetimeSpend || b.customs - a.customs;
    }
  });
  return {
    rows: filtered.slice(params.offset, params.offset + params.limit).map(withoutKey('lastCustomAt')),
    total: filtered.length,
    counts,
    scope,
  };
}

/** Name contains, id starts with, handle contains — or an exact pasted link. */
function searchMatcher(raw: string) {
  const q = raw.trim().toLowerCase();
  if (!q) return () => true;
  const linkKey = fanKeyOf(parseProfileLink(raw));
  return (r: { fanKey: string; fanId: string | null; handle: string | null; name: string | null }) =>
    (linkKey !== null && r.fanKey === linkKey) ||
    (r.name?.toLowerCase().includes(q) ?? false) ||
    (r.fanId?.startsWith(q) ?? false) ||
    (r.handle?.includes(q.replace(/^@/, '')) ?? false);
}

// ─── Wizard lookup ───────────────────────────────────────────────────

/**
 * The custom-request wizard's fan search. A pasted link or id is looked up
 * directly (any fan, any creator); a name searches the selected creator's
 * fans plus every fan who has ordered a custom. With no query, the creator's
 * fans with customs come first, then their biggest spenders.
 */
export async function lookupFans(params: { q: string; creatorId: string | null; limit?: number }): Promise<FanLookupHit[]> {
  const limit = params.limit ?? 8;
  const creatorId = params.creatorId;
  const linked = parseProfileLink(params.q);
  if (linked && params.q.trim()) {
    const key = await resolveFanKeyForLink(params.q);
    if (!key) return [];
    const refs = [adminDb.collection(FAN_REGISTRY).doc(key)];
    if (creatorId && !isHandleKey(key)) refs.push(adminDb.collection('buddyx-fans').doc(`${creatorId}_${key}`));
    const [regSnap, fanSnap] = await adminDb.getAll(...refs);
    const reg = regSnap.exists ? (regSnap.data() as FanRegistryDocument) : null;
    const fan = fanSnap?.exists ? (fanSnap.data() as BuddyxFanDocument) : null;
    if (!reg && !fan) return [];
    const summary = fan ? summariseFan(fan, null) : null;
    const resolved = reg ? resolveFanName(reg) : { name: summary?.name ?? null, source: summary?.nameSource ?? null };
    return [{
      fanKey: key,
      fanId: isHandleKey(key) ? null : key,
      handle: reg?.handle ?? (isHandleKey(key) ? key.slice(2) : null),
      name: resolved.name,
      nameSource: resolved.source,
      profileLink: profileLinkForKey(key),
      spendWithCreator: summary?.lifetimeSpend ?? 0,
      customs: reg?.customsCount ?? 0,
    }];
  }

  const [fanDocs, customsFans] = await Promise.all([creatorId ? readFans([creatorId]) : Promise.resolve([]), readCustomsFans()]);
  const hits = new Map<string, FanLookupHit & { forCreator: boolean }>();
  for (const doc of fanDocs) {
    const summary = summariseFan(doc, null);
    hits.set(doc.fanId, {
      fanKey: doc.fanId,
      fanId: doc.fanId,
      handle: null,
      name: summary.name,
      nameSource: summary.nameSource,
      profileLink: profileLinkForKey(doc.fanId),
      spendWithCreator: summary.lifetimeSpend,
      customs: 0,
      forCreator: false,
    });
  }
  for (const entry of customsFans) {
    const resolved = resolveFanName(entry);
    const hit = hits.get(entry.key) ?? {
      fanKey: entry.key,
      fanId: entry.fanId ?? null,
      handle: entry.handle ?? null,
      name: null,
      nameSource: null,
      profileLink: profileLinkForKey(entry.key),
      spendWithCreator: 0,
      customs: 0,
      forCreator: false,
    };
    if (resolved.name) {
      hit.name = resolved.name;
      hit.nameSource = resolved.source;
    }
    hit.customs = entry.customsCount ?? 0;
    hit.forCreator = creatorId ? (entry.customsCreatorIds ?? []).includes(creatorId) : false;
    hits.set(entry.key, hit);
  }

  const q = params.q.trim().toLowerCase();
  const list = [...hits.values()].filter(h =>
    !q ? h.forCreator || h.spendWithCreator > 0 : (h.name?.toLowerCase().includes(q) ?? false) || (h.handle?.includes(q.replace(/^@/, '')) ?? false),
  );
  const startsWith = (h: FanLookupHit) => (q && h.name?.toLowerCase().startsWith(q) ? 1 : 0);
  list.sort((a, b) =>
    startsWith(b) - startsWith(a) ||
    Number(b.forCreator) - Number(a.forCreator) ||
    b.spendWithCreator - a.spendWithCreator ||
    b.customs - a.customs,
  );
  return list.slice(0, limit).map(withoutKey('forCreator'));
}

// ─── Report ──────────────────────────────────────────────────────────

/**
 * One fan, everything known. `null` when the fan does not exist **or** has
 * nothing in the viewer's scope — the two are indistinguishable on purpose,
 * so the report cannot be used to read a creator an agent is not rostered on.
 * `{ movedTo }` for a handle entry that has been linked to an id.
 */
export async function getFanReport(params: {
  viewerUid: string;
  isAdmin: boolean;
  fanKey: string;
}): Promise<FanReport | { movedTo: string } | null> {
  const { fanKey } = params;
  if (!isValidFanKey(fanKey)) return null;
  const fanId = isHandleKey(fanKey) ? null : fanKey;
  const { scope } = await resolveFanScope({ viewerUid: params.viewerUid, isAdmin: params.isAdmin, requested: null });
  const inScope = new Set(scope);
  const visible = (creatorId: string | null | undefined) => params.isAdmin || (creatorId ? inScope.has(creatorId) : false);

  const [regSnap, fanSnap, customsSnap, salesSnap, subsSnap] = await Promise.all([
    adminDb.collection(FAN_REGISTRY).doc(fanKey).get(),
    fanId
      ? adminDb
          .collection('buddyx-fans')
          .where('fanId', '==', fanId)
          .select('creatorId', 'fanId', 'name', 'nameSource', 'salesName', 'displayName', 'displayNameSource', 'spendByMonth', 'acquisition', 'isStacker')
          .get()
      : Promise.resolve(null),
    adminDb
      .collection(CUSTOMS)
      .where('fanKey', '==', fanKey)
      .select('CR', 'type', 'status', 'isArchived', 'creatorID', 'fanName', 'description', 'createdTime', 'totalAmount', 'amountPaid', 'originalTotalAmount', 'originalAmountPaid')
      .get(),
    fanId
      ? adminDb
          .collection('ca-sales')
          .where('fanId', '==', fanId)
          .select('saleId', 'occurredAt', 'kind', 'type', 'signedGross', 'source', 'userId', 'removedAt', 'creatorId')
          .get()
      : Promise.resolve(null),
    fanId
      ? adminDb.collection('buddyx-subscribers').where('fanId', '==', fanId).select('id', 'creatorId', 'subscribedAt', 'subType', 'isTrial', 'priceGross').get()
      : Promise.resolve(null),
  ]);

  const reg = regSnap.exists ? (regSnap.data() as FanRegistryDocument) : null;
  if (reg?.mergedInto) return { movedTo: reg.mergedInto };

  const fanDocs = (fanSnap?.docs ?? []).map(d => d.data() as BuddyxFanDocument).filter(f => visible(f.creatorId));
  const customs = customsSnap.docs
    .map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }) as Record<string, unknown> & { id: string })
    .filter(c => visible(c.creatorID as string));
  const sales = (salesSnap?.docs ?? []).map(d => d.data() as CaSaleDocument).filter(s => !s.removedAt && visible(s.creatorId ?? null));
  if (!reg && fanDocs.length === 0 && customs.length === 0) return null;
  if (!params.isAdmin && fanDocs.length === 0 && customs.length === 0 && sales.length === 0) return null;

  // ── Name ──
  const summaries = fanDocs.map(f => summariseFan(f, null));
  const fallback = summaries.find(s => s.name) ?? null;
  const resolved = reg ? resolveFanName(reg) : { name: fallback?.name ?? null, source: fallback?.nameSource ?? null };
  const automatic = reg ? automaticFanName(reg) : resolved;

  // ── Spend ──
  const monthly = new Map<string, { tips: number; ppv: number }>();
  for (const doc of fanDocs) {
    for (const [month, v] of Object.entries(doc.spendByMonth ?? {})) {
      const m = monthly.get(month) ?? { tips: 0, ppv: 0 };
      m.tips = round2(m.tips + v.tips);
      m.ppv = round2(m.ppv + v.ppv);
      monthly.set(month, m);
    }
  }
  const tips = round2(summaries.reduce((s, f) => s + f.lifetimeTips, 0));
  const ppv = round2(summaries.reduce((s, f) => s + f.lifetimePpv, 0));
  const lifetime = round2(tips + ppv);
  const lasts = summaries.map(s => s.lastPurchaseAt).filter((n): n is number => n !== null);
  const firsts = summaries.map(s => s.firstSeenAt).filter((n): n is number => n !== null);

  // ── Purchases ──
  const names = params.isAdmin ? await displayNamesFor(sales.map(s => s.userId)) : new Map<string, string>();
  const label = (uid: string | null) =>
    !uid ? null : params.isAdmin ? names.get(uid) ?? 'Unknown' : uid === params.viewerUid ? 'You' : 'Team';
  const purchases: FanPurchase[] = sales
    .map(s => ({
      saleId: s.saleId,
      occurredAt: s.occurredAt?.toDate?.()?.toISOString() ?? '',
      creatorId: s.creatorId ?? null,
      kind: saleKindOf(s),
      type: s.type,
      gross: s.signedGross,
      source: saleSourceOf(s, s.occurredAt?.toMillis?.() ?? 0),
      earnedBy: label(s.userId ?? null),
    }))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const earned = new Map<string, { label: string; gross: number; count: number }>();
  for (const p of purchases) {
    const key = p.earnedBy ?? 'Unassigned';
    const entry = earned.get(key) ?? { label: key, gross: 0, count: 0 };
    entry.gross = round2(entry.gross + p.gross);
    entry.count += 1;
    earned.set(key, entry);
  }

  // ── Customs ──
  const items: FanCustomItem[] = customs
    .map(c => {
      const money = customMoney({
        type: String(c.type ?? ''),
        status: String(c.status ?? ''),
        isArchived: c.isArchived === true,
        totalAmount: Number(c.totalAmount ?? 0),
        amountPaid: Number(c.amountPaid ?? 0),
        originalTotalAmount: typeof c.originalTotalAmount === 'number' ? c.originalTotalAmount : null,
        originalAmountPaid: typeof c.originalAmountPaid === 'number' ? c.originalAmountPaid : null,
      });
      const description = String(c.description ?? '');
      return {
        id: c.id,
        CR: (c.CR as string | undefined) ?? null,
        type: String(c.type ?? ''),
        status: String(c.status ?? ''),
        isCampaign: (CAMPAIGN_TYPES as readonly string[]).includes(String(c.type)),
        isArchived: c.isArchived === true,
        creatorId: String(c.creatorID ?? ''),
        fanName: String(c.fanName ?? ''),
        description: description.length > 160 ? `${description.slice(0, 160)}…` : description,
        createdTime: (c.createdTime as Timestamp | undefined)?.toDate?.()?.toISOString() ?? null,
        totalAmount: Number(c.totalAmount ?? 0),
        amountPaid: Number(c.amountPaid ?? 0),
        outstanding: money.outstanding,
        abandoned: money.abandoned,
        abandonedAmount: money.abandonedAmount,
      };
    })
    .sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? ''));
  const byType = new Map<string, number>();
  for (const item of items) byType.set(item.type, (byType.get(item.type) ?? 0) + 1);
  const outstandingItems = items.filter(i => i.outstanding > 0);
  const abandonedItems = items.filter(i => i.abandoned);

  return {
    fanKey,
    fanId,
    handle: reg?.handle ?? (fanId ? null : fanKey.slice(2)),
    handles: reg?.handles ?? [],
    profileLink: profileLinkForKey(fanKey),
    name: resolved.name,
    nameSource: resolved.source as FanNameSource | null,
    manual: reg?.manualName
      ? { by: reg.manualNameByName ?? null, at: (reg.manualNameAt as Timestamp | null | undefined)?.toDate?.()?.toISOString() ?? null }
      : null,
    automatic,
    customsVote: reg?.customsName ? { votes: reg.customsNameVotes ?? 0, total: reg.customsCount ?? 0 } : null,
    canLink: params.isAdmin && isHandleKey(fanKey),
    spend: {
      lifetime,
      tips,
      ppv,
      lastPurchaseAt: lasts.length ? Math.max(...lasts) : null,
      firstSeenAt: firsts.length ? Math.min(...firsts) : null,
      usual: lifetime <= 0 ? null : tips / lifetime >= 0.75 ? 'tips' : ppv / lifetime >= 0.75 ? 'ppv' : 'mixed',
      byCreator: summaries
        .map(s => ({ creatorId: s.creatorId, lifetime: s.lifetimeSpend, tips: s.lifetimeTips, ppv: s.lifetimePpv, lastPurchaseAt: s.lastPurchaseAt }))
        .sort((a, b) => b.lifetime - a.lifetime),
      monthly: [...monthly].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month)),
    },
    isStacker: fanDocs.some(f => f.isStacker === true),
    acquisition: fanDocs
      .filter(f => f.acquisition)
      .map(f => ({ creatorId: f.creatorId, ...f.acquisition! })),
    purchases,
    earnedBy: [...earned.values()].sort((a, b) => b.gross - a.gross),
    subscriptions: (subsSnap?.docs ?? [])
      .map(d => d.data())
      .filter(s => visible(s.creatorId as string | null))
      .map(s => ({
        id: String(s.id),
        creatorId: (s.creatorId as string | null) ?? null,
        at: (s.subscribedAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
        subType: (s.subType as string | null) ?? null,
        isTrial: s.isTrial === true,
        priceGross: Number(s.priceGross ?? 0),
      }))
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),
    customs: {
      total: items.length,
      byType: [...byType].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      outstanding: { count: outstandingItems.length, amount: round2(outstandingItems.reduce((s, i) => s + i.outstanding, 0)) },
      abandoned: {
        count: abandonedItems.length,
        amount: round2(abandonedItems.reduce((s, i) => s + (i.abandonedAmount ?? 0), 0)),
        unknownAmount: abandonedItems.filter(i => i.abandonedAmount === null).length,
      },
      rejected: items.filter(i => i.status === 'Rejected').length,
      completed: items.filter(i => i.status === 'Completed').length,
      items,
    },
  };
}

/**
 * May this viewer act on this fan (rename, link)? The same rule as the
 * report: the fan has something in their scope. Cheap — id-only reads.
 */
export async function canViewFan(params: { viewerUid: string; isAdmin: boolean; fanKey: string }): Promise<boolean> {
  if (!isValidFanKey(params.fanKey)) return false;
  if (params.isAdmin) return true;
  const { scope } = await resolveFanScope({ viewerUid: params.viewerUid, isAdmin: false, requested: null });
  if (scope.length === 0) return false;
  const fanId = isHandleKey(params.fanKey) ? null : params.fanKey;
  const [customs, fans] = await Promise.all([
    adminDb.collection(CUSTOMS).where('fanKey', '==', params.fanKey).select('creatorID').get(),
    fanId ? adminDb.collection('buddyx-fans').where('fanId', '==', fanId).select('creatorId').get() : Promise.resolve(null),
  ]);
  const inScope = new Set(scope);
  return (
    customs.docs.some(d => inScope.has(d.get('creatorID'))) ||
    (fans?.docs ?? []).some(d => inScope.has(d.get('creatorId')))
  );
}
