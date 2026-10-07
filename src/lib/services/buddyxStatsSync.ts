/**
 * BuddyX sync — the three analytics scopes, and the fan spend rollup.
 *
 * | Scope | Writes | Cadence |
 * |---|---|---|
 * | `chatters` | `buddyx-team-days`, `buddyx-team-periods`, `buddyx-mass-messages` | every run |
 * | `creators` | `creator-stats-days`, `buddyx-subscribers`, `buddyx-links` | every run |
 * | `fans` | `buddyx-fans`, `buddyx-fan-names` | the 21:01 UTC run, or a manual refresh |
 *
 * Read-only against BuddyX, and only ever reached from a sync run — never from a
 * page read. Every collection is index-exempt beyond the fields that are
 * queried (rule 9), and nothing here mirrors message text: `/messages` and
 * mass-message bodies are deliberately not stored (documentation/buddyx.md §3.5).
 *
 * ## Backfill without a scan
 *
 * Day-keyed series (team days, creator days) backfill forward from a start day,
 * a few days per run, behind a cursor in `buddyx-meta/cursors`. The cursor is
 * what makes "which days are missing" one document read instead of a query over
 * a growing collection.
 */
import 'server-only';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { buddyxAll, buddyxData } from '../buddyx/client';
import { isBuddyxError } from '../buddyx/errors';
import {
  BUDDYX_CREATOR_STATS_START_DAY,
  BUDDYX_SUBSCRIBERS_START_DAY,
  BUDDYX_TEAM_STATS_START_DAY,
} from '../buddyx/constants';
import {
  normaliseId,
  type BuddyxEarningsRow,
  type BuddyxFreeTrialLink,
  type BuddyxLinkFan,
  type BuddyxMassMessage,
  type BuddyxOverview,
  type BuddyxOverviewRow,
  type BuddyxOverviewTotals,
  type BuddyxSubscriber,
  type BuddyxTrackingLink,
} from '../buddyx/types';
import { SALARY_TIMEZONE } from '../salary/salaryConstants';
import { round2 } from '../salary/salaryEngine';
import { saleKindOf } from '../salary/saleTypes';
import {
  addDays,
  addMonths,
  currentDayKey,
  currentMonthKey,
  dayKeyRange,
  monthKeyRange,
  toDayKey,
  type SalaryDayKey,
  type SalaryMonthKey,
} from '../salary/salaryDate';
import { bump, outOfTime, type SyncContext } from './buddyxSyncContext';
import type { BuddyxMaps } from './buddyxMappingService';
import type {
  BuddyxFanDocument,
  BuddyxLinkDocument,
  BuddyxTeamRow,
  BuddyxTeamTotals,
  CaSaleDocument,
} from '@/types/firestore';

const CURSORS_DOC = 'buddyx-meta/cursors';
const TEAM_DAYS = 'buddyx-team-days';
const TEAM_PERIODS = 'buddyx-team-periods';
const MASS = 'buddyx-mass-messages';
const CREATOR_DAYS = 'creator-stats-days';
const SUBSCRIBERS = 'buddyx-subscribers';
const LINKS = 'buddyx-links';
const FANS = 'buddyx-fans';
const FAN_NAMES = 'buddyx-fan-names';

/** Days backfilled per run, per series. Small: each creator day costs 1 + N expensive calls. */
const TEAM_BACKFILL_PER_RUN = 4;
const CREATOR_BACKFILL_PER_RUN = 2;
/** `series` cap on a link doc. */
const LINK_SERIES_CAP = 400;
/** Subscription event ids remembered per fan, so a re-read event never double-counts. */
const FAN_EVENT_ID_CAP = 50;
/** A preset period is re-pulled at most this often (prev-month barely moves). */
const PREV_MONTH_REFRESH_MS = 20 * 60 * 60 * 1000;

type Cursors = {
  teamDaysThrough?: string;
  creatorDaysThrough?: string;
  massMessagesSince?: number;
  subscribersSince?: Record<string, number>;
  fansSubscribersSince?: number;
};

async function readCursors(): Promise<Cursors> {
  return ((await adminDb.doc(CURSORS_DOC).get()).data() ?? {}) as Cursors;
}

async function writeCursors(patch: Cursors): Promise<void> {
  await adminDb.doc(CURSORS_DOC).set(patch, { merge: true });
}


/** `[start, end)` of a salary day as the API's inclusive date-time pair. */
function dayQuery(day: SalaryDayKey) {
  const [start, end] = dayKeyRange(day);
  return { startDate: new Date(start).toISOString(), endDate: new Date(end - 1).toISOString(), timeZone: SALARY_TIMEZONE };
}

function rangeQuery(start: number, end: number) {
  return { startDate: new Date(start).toISOString(), endDate: new Date(end).toISOString(), timeZone: SALARY_TIMEZONE };
}

/**
 * The days a forward-only backfill should take this run: the next `cap` days
 * after the cursor, never reaching the days every run already refreshes.
 */
function backfillDays(through: string | undefined, startDay: SalaryDayKey, lastDay: SalaryDayKey, cap: number): SalaryDayKey[] {
  const out: SalaryDayKey[] = [];
  let day = through ? addDays(through, 1) : startDay;
  while (day <= lastDay && out.length < cap) {
    out.push(day);
    day = addDays(day, 1);
  }
  return out;
}

// ─── Team overview → stored rows ─────────────────────────────────────

function teamTotals(t: BuddyxOverviewTotals | undefined): BuddyxTeamTotals {
  return {
    ppvGross: round2(t?.revenue?.gross ?? 0),
    tipsGross: round2(t?.tips?.gross ?? 0),
    tipsAssignedGross: round2(t?.tipsAssigned?.gross ?? 0),
    tipsCount: t?.tipsCount ?? 0,
    ppvsSent: t?.ppvsSent ?? 0,
    ppvsUnlocked: t?.ppvsUnlocked ?? 0,
    unlockRate: t?.unlockRate ?? 0,
    ppvRate: t?.ppvRate ?? 0,
    fansChatted: t?.fansChatted ?? 0,
    totalMessages: t?.totalMessages ?? 0,
    onlineMs: t?.onlineMs ?? 0,
    medianResponseTimeMs: t?.medianResponseTimeMs ?? null,
    p75ResponseTimeMs: t?.p75ResponseTimeMs ?? null,
  };
}

function teamRow(row: BuddyxOverviewRow, maps: BuddyxMaps): BuddyxTeamRow {
  const chatterId = normaliseId(row.chatterId) ?? '';
  return {
    chatterId,
    chatterName: row.chatterName ?? null,
    uid: maps.chatters.get(chatterId)?.uid ?? null,
    ppvGross: round2(row.revenue?.gross ?? 0),
    ppvsUnlocked: row.ppvsUnlocked ?? 0,
    ppvsSent: row.ppvsSent ?? 0,
    ppvRate: row.ppvRate ?? 0,
    unlockRate: row.unlockRate ?? 0,
    fansChatted: row.fansChatted ?? 0,
    totalMessages: row.totalMessages ?? 0,
    tipsGross: round2(row.tips?.gross ?? 0),
    tipsCount: row.tipsCount ?? 0,
    onlineMs: row.onlineMs ?? 0,
    medianResponseTimeMs: row.medianResponseTimeMs ?? null,
    p75ResponseTimeMs: row.p75ResponseTimeMs ?? null,
  };
}

async function overview(query: Record<string, string>): Promise<BuddyxOverview> {
  return buddyxData<BuddyxOverview>('/v1/public/team-reports/overview', query);
}

/** One live overview for an arbitrary window, stored as a custom period (admin "Pull"). */
export async function pullCustomTeamPeriod(
  maps: BuddyxMaps,
  from: SalaryDayKey,
  to: SalaryDayKey,
): Promise<void> {
  const [start] = dayKeyRange(from);
  const [, end] = dayKeyRange(to);
  const data = await overview(rangeQuery(start, end - 1));
  await adminDb.collection(TEAM_PERIODS).doc(`custom-${from}-${to}`).set({
    period: 'custom',
    from,
    to,
    totals: teamTotals(data.totals),
    breakdown: (data.breakdown ?? []).map(r => teamRow(r, maps)),
    syncedAt: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
}

// ─── chatters ────────────────────────────────────────────────────────

export async function syncChattersScope(ctx: SyncContext): Promise<void> {
  const cursors = await readCursors();
  const today = currentDayKey(ctx.now);
  const yesterday = addDays(today, -1);

  // Today and yesterday every run (both still move); older days once, by cursor.
  const backfillFloor = [BUDDYX_TEAM_STATS_START_DAY, `${addMonths(currentMonthKey(ctx.now), -1)}-01`].sort()[1];
  const backfill = backfillDays(cursors.teamDaysThrough, backfillFloor, addDays(today, -2), TEAM_BACKFILL_PER_RUN);

  for (const day of [today, yesterday, ...backfill]) {
    if (outOfTime(ctx)) return;
    const data = await overview(dayQuery(day));
    await adminDb.collection(TEAM_DAYS).doc(day).set({
      day,
      totals: teamTotals(data.totals),
      breakdown: (data.breakdown ?? []).map(r => teamRow(r, ctx.maps)),
      syncedAt: FieldValue.serverTimestamp(),
    });
    bump(ctx, 'chatters.days');
  }
  if (backfill.length > 0) await writeCursors({ teamDaysThrough: backfill[backfill.length - 1] });

  // Whole-period aggregates: medians and p75s cannot be summed from days.
  const month = currentMonthKey(ctx.now);
  const [monthStart] = monthKeyRange(month);
  const [prevStart, prevEnd] = monthKeyRange(addMonths(month, -1));
  const periods: Array<{ id: string; start: number; end: number; from: string; to: string }> = [
    { id: 'mtd', start: monthStart, end: ctx.now, from: toDayKey(monthStart), to: today },
    { id: '7d', start: ctx.now - 7 * 86_400_000, end: ctx.now, from: toDayKey(ctx.now - 7 * 86_400_000), to: today },
    { id: '30d', start: ctx.now - 30 * 86_400_000, end: ctx.now, from: toDayKey(ctx.now - 30 * 86_400_000), to: today },
  ];
  const prevSnap = await adminDb.collection(TEAM_PERIODS).doc('prev-month').get();
  const prevSynced = (prevSnap.get('syncedAt') as Timestamp | undefined)?.toMillis?.() ?? 0;
  const prevFrom = toDayKey(prevStart);
  if (prevSnap.get('from') !== prevFrom || ctx.now - prevSynced > PREV_MONTH_REFRESH_MS) {
    periods.push({ id: 'prev-month', start: prevStart, end: prevEnd - 1, from: prevFrom, to: toDayKey(prevEnd - 1) });
  }

  for (const period of periods) {
    if (outOfTime(ctx)) return;
    const data = await overview(rangeQuery(period.start, period.end));
    await adminDb.collection(TEAM_PERIODS).doc(period.id).set({
      period: period.id,
      from: period.from,
      to: period.to,
      totals: teamTotals(data.totals),
      breakdown: (data.breakdown ?? []).map(r => teamRow(r, ctx.maps)),
      syncedAt: FieldValue.serverTimestamp(),
    });
    bump(ctx, 'chatters.periods');
  }

  // Mass messages: a rolling window with a day of overlap. No text, ever.
  if (outOfTime(ctx)) return;
  const since = cursors.massMessagesSince ?? monthKeyRange(addMonths(month, -1))[0];
  const rows = await buddyxAll<BuddyxMassMessage>('/v1/public/mass-messages', rangeQuery(since - 86_400_000, ctx.now));
  const writer = adminDb.bulkWriter();
  for (const row of rows) {
    const id = normaliseId(row.id);
    if (!id) continue;
    const modelId = normaliseId(row.modelId);
    const sentBy = normaliseId(row.sentBy);
    const sentMs = row.sentDate ? Date.parse(row.sentDate) : NaN;
    const unsentMs = row.unsentDate ? Date.parse(row.unsentDate) : NaN;
    writer.set(adminDb.collection(MASS).doc(id), {
      id,
      modelId,
      creatorId: modelId ? ctx.maps.modelCreator.get(modelId) ?? null : null,
      sentBy,
      uid: sentBy ? ctx.maps.chatters.get(sentBy)?.uid ?? null : null,
      sentDate: Number.isFinite(sentMs) ? Timestamp.fromMillis(sentMs) : null,
      day: Number.isFinite(sentMs) ? toDayKey(sentMs) : null,
      price: round2(Number(row.price ?? 0)),
      previewCount: Array.isArray(row.previews) ? row.previews.length : 0,
      unsent: Boolean(row.unsentBy || row.unsentDate),
      unsentBy: normaliseId(row.unsentBy),
      unsentDate: Number.isFinite(unsentMs) ? Timestamp.fromMillis(unsentMs) : null,
      syncedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.close();
  bump(ctx, 'chatters.massMessages', rows.length);
  await writeCursors({ massMessagesSince: ctx.now });
}

// ─── creators ────────────────────────────────────────────────────────

export async function syncCreatorsScope(ctx: SyncContext): Promise<void> {
  const cursors = await readCursors();
  const today = currentDayKey(ctx.now);
  const backfill = backfillDays(
    cursors.creatorDaysThrough,
    BUDDYX_CREATOR_STATS_START_DAY,
    addDays(today, -2),
    CREATOR_BACKFILL_PER_RUN,
  );
  const days = [today, addDays(today, -1), ...backfill].filter(d => d >= BUDDYX_CREATOR_STATS_START_DAY);

  // ── Daily creator stats: the earnings split, then the chat stats per creator ──
  for (const day of days) {
    if (outOfTime(ctx)) break;
    const query = dayQuery(day);
    const rows = await buddyxData<BuddyxEarningsRow[]>('/v1/public/creators/earnings-breakdown', query);
    for (const row of rows ?? []) {
      if (outOfTime(ctx)) break;
      const modelId = normaliseId(row.modelId);
      const creatorId = modelId ? ctx.maps.modelCreator.get(modelId) : undefined;
      if (!modelId || !creatorId) {
        bump(ctx, 'creators.unmappedModelRows');
        continue;
      }

      let chat: BuddyxOverviewTotals | undefined;
      try {
        chat = (await overview({ ...query, modelIds: modelId })).totals;
      } catch (err) {
        if (!(isBuddyxError(err) && err.isModelScoped)) throw err;
        bump(ctx, 'creators.inactiveModels');
      }

      await adminDb.collection(CREATOR_DAYS).doc(`${creatorId}_${day}`).set({
        creatorId,
        day,
        source: 'buddyx',
        tz: SALARY_TIMEZONE,
        totalGross: round2(row.revenue?.gross ?? 0),
        subsGross: round2(row.subscriptions?.gross ?? 0),
        tipsGross: round2(row.tips?.gross ?? 0),
        messagesGross: round2(row.messages?.gross ?? 0),
        newSubs: row.newSubs ?? 0,
        fansChatted: chat ? chat.fansChatted : null,
        messagesSent: chat ? chat.totalMessages : null,
        ppvsSent: chat ? chat.ppvsSent : null,
        replyTimeMs: chat ? chat.medianResponseTimeMs : null,
        revShareGross: row.revShareAmount ? round2(row.revShareAmount.gross) : null,
        massMessages: row.massMessages ?? 0,
        ppvsUnlocked: chat ? chat.ppvsUnlocked : null,
        unlockRate: chat ? chat.unlockRate : null,
        onlineMs: chat ? chat.onlineMs : null,
        syncedAt: FieldValue.serverTimestamp(),
      });
      bump(ctx, 'creators.days');
    }
    if (backfill.includes(day) && !ctx.partial) await writeCursors({ creatorDaysThrough: day });
  }

  // ── Subscribers and links, per creator ──
  const subscribersSince = { ...(cursors.subscribersSince ?? {}) };
  for (const [modelId, model] of ctx.maps.models) {
    if (outOfTime(ctx)) break;
    const creatorId = model.creatorId;
    try {
      const since = subscribersSince[modelId] ?? dayKeyRange(BUDDYX_SUBSCRIBERS_START_DAY)[0];
      const subs = await buddyxAll<BuddyxSubscriber>('/v1/public/subscribers', {
        modelId,
        ...rangeQuery(since - 86_400_000, ctx.now),
      });
      const writer = adminDb.bulkWriter();
      for (const sub of subs) {
        const id = normaliseId(sub.id);
        if (!id) continue;
        const at = sub.subscribedAt ? Date.parse(sub.subscribedAt) : NaN;
        writer.set(adminDb.collection(SUBSCRIBERS).doc(id), {
          id,
          modelId,
          creatorId,
          fanId: normaliseId(sub.fanId),
          subType: sub.subType ?? null,
          isTrial: sub.isTrial === true,
          isCreator: sub.isCreator === true,
          priceGross: round2(sub.price?.gross ?? 0),
          subscribedAt: Number.isFinite(at) ? Timestamp.fromMillis(at) : null,
          day: Number.isFinite(at) ? toDayKey(at) : null,
          syncedAt: FieldValue.serverTimestamp(),
        });
      }
      await writer.close();
      bump(ctx, 'creators.subscribers', subs.length);
      subscribersSince[modelId] = ctx.now;

      if (outOfTime(ctx)) break;
      await syncLinksForModel(ctx, modelId, creatorId);
    } catch (err) {
      if (!(isBuddyxError(err) && err.isModelScoped)) throw err;
      bump(ctx, 'creators.inactiveModels');
    }
  }
  await writeCursors({ subscribersSince });
}

async function syncLinksForModel(ctx: SyncContext, modelId: string, creatorId: string | null): Promise<void> {
  const [tracking, trials, storedSnap] = await Promise.all([
    buddyxAll<BuddyxTrackingLink>('/v1/public/tracking-links', { modelId }),
    buddyxAll<BuddyxFreeTrialLink>('/v1/public/free-trial-links', { modelId }),
    adminDb.collection(LINKS).where('modelId', '==', modelId).select('series').get(),
  ]);
  const seriesKeys = new Map(storedSnap.docs.map(d => [d.id, Object.keys((d.get('series') ?? {}) as object).sort()]));
  const today = currentDayKey(ctx.now);
  const writer = adminDb.bulkWriter();

  const write = (linkId: string, doc: Omit<BuddyxLinkDocument, 'series' | 'syncedAt' | 'fansSyncedAt' | 'fansSyncedCount'>) => {
    const id = `${modelId}_${linkId}`;
    const keys = seriesKeys.get(id) ?? [];
    // Keep the newest entries; today's makes one more. Day keys start with a
    // digit and contain '-', so they need a FieldPath, not a dotted string.
    const prune = keys
      .filter(k => k !== today)
      .slice(0, Math.max(0, keys.length + 1 - LINK_SERIES_CAP))
      .flatMap(key => [new FieldPath('series', key), FieldValue.delete()]);
    writer.set(
      adminDb.collection(LINKS).doc(id),
      {
        ...doc,
        series: { [today]: { subs: doc.subscribers, revenue: doc.revenue, fans: doc.fansCount } },
        syncedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (prune.length > 0) {
      const [field, value, ...more] = prune;
      writer.update(adminDb.collection(LINKS).doc(id), field as FieldPath, value, ...more);
    }
  };

  for (const link of tracking) {
    const linkId = normaliseId(link.linkId ?? link.id);
    if (!linkId) continue;
    write(linkId, {
      modelId,
      linkId,
      creatorId,
      kind: 'tracking',
      name: link.campaignName ?? link.campaignCode ?? null,
      url: link.url ?? null,
      createdAt: link.createdAt ?? null,
      archived: link.archived === true,
      cost: round2(Number(link.cost ?? 0)),
      subscribers: link.countSubscribers ?? 0,
      transitions: link.countTransitions ?? 0,
      revenue: round2(link.metrics?.revenue ?? 0),
      fansCount: link.metrics?.fansCount ?? 0,
      stackersCount: null,
      revenueFromStackers: null,
    });
  }
  for (const link of trials) {
    const linkId = normaliseId(link.linkId ?? link.id);
    if (!linkId) continue;
    write(linkId, {
      modelId,
      linkId,
      creatorId,
      kind: 'free-trial',
      name: link.name ?? null,
      url: link.url ?? null,
      createdAt: link.createdAt ?? null,
      archived: link.archived === true,
      cost: round2(Number(link.cost ?? 0)),
      subscribers: link.claimCounts ?? 0,
      transitions: null,
      revenue: round2(link.metrics?.revenue ?? 0),
      fansCount: link.metrics?.fansCount ?? 0,
      stackersCount: link.metrics?.stackersCount ?? 0,
      revenueFromStackers: round2(link.metrics?.revenueFromStackers ?? 0),
    });
  }
  await writer.close();
  bump(ctx, 'creators.links', tracking.length + trials.length);
}

// ─── fans ────────────────────────────────────────────────────────────

type FanPatch = {
  creatorId: string;
  fanId: string;
  name?: string;
  acquisition?: BuddyxFanDocument['acquisition'];
  linkTotalSpent?: number;
  isStacker?: boolean;
  subs?: Array<{ id: string; subType: string | null; isTrial: boolean; at: number }>;
};

const fanKey = (creatorId: string, fanId: string) => `${creatorId}_${fanId}`;

export async function syncFansScope(ctx: SyncContext): Promise<void> {
  const cursors = await readCursors();
  const patches = new Map<string, FanPatch>();
  const patch = (creatorId: string, fanId: string) => {
    const key = fanKey(creatorId, fanId);
    const p = patches.get(key) ?? { creatorId, fanId };
    patches.set(key, p);
    return p;
  };
  const fanNames = new Map<string, string>();

  // ── 1. Link fan lists — names, acquisition, lifetime spend via the link ──
  // Only links whose fan count moved since their last walk, and only from a
  // day before that walk: most links are static, so most runs walk none.
  const linkSnap = await adminDb
    .collection(LINKS)
    .select('modelId', 'linkId', 'creatorId', 'kind', 'name', 'fansCount', 'fansSyncedAt', 'fansSyncedCount')
    .get();
  for (const doc of linkSnap.docs) {
    if (outOfTime(ctx)) break;
    const link = doc.data() as Partial<BuddyxLinkDocument>;
    if (!link.creatorId || !link.modelId || !link.linkId) continue;
    const syncedAt = (link.fansSyncedAt as Timestamp | null | undefined)?.toMillis?.() ?? null;
    if (syncedAt && link.fansSyncedCount === link.fansCount) continue;

    const path = link.kind === 'free-trial'
      ? `/v1/public/free-trial-links/${encodeURIComponent(link.linkId)}/fans`
      : `/v1/public/tracking-links/${encodeURIComponent(link.linkId)}/fans`;
    let fans: BuddyxLinkFan[];
    try {
      fans = await buddyxAll<BuddyxLinkFan>(path, {
        modelId: link.modelId,
        ...(syncedAt ? rangeQuery(syncedAt - 86_400_000, ctx.now) : {}),
      });
    } catch (err) {
      if (!(isBuddyxError(err) && err.isModelScoped)) throw err;
      bump(ctx, 'fans.skippedLinks');
      continue;
    }

    for (const fan of fans) {
      const fanId = normaliseId(fan.fanId);
      if (!fanId) continue;
      const p = patch(link.creatorId, fanId);
      if (fan.fanName) {
        p.name = fan.fanName;
        fanNames.set(fanId, fan.fanName);
      }
      p.acquisition ??= { kind: link.kind ?? 'tracking', linkId: link.linkId, linkName: link.name ?? null };
      p.linkTotalSpent = Math.max(p.linkTotalSpent ?? 0, round2(Number(fan.totalSpent ?? 0)));
      p.isStacker = p.isStacker || fan.isStacker === true;
    }
    await doc.ref.update({ fansSyncedAt: Timestamp.fromMillis(ctx.now), fansSyncedCount: link.fansCount ?? 0 });
    bump(ctx, 'fans.linksWalked');
    bump(ctx, 'fans.linkFans', fans.length);
  }

  // ── 2. Subscription events since the last fans run ──
  const subsSince = cursors.fansSubscribersSince ?? 0;
  const subSnap = await adminDb
    .collection(SUBSCRIBERS)
    .where('syncedAt', '>', Timestamp.fromMillis(subsSince))
    .select('creatorId', 'fanId', 'subType', 'isTrial', 'subscribedAt', 'isCreator')
    .get();
  for (const doc of subSnap.docs) {
    const creatorId = doc.get('creatorId') as string | null;
    const fanId = doc.get('fanId') as string | null;
    if (!creatorId || !fanId || doc.get('isCreator') === true) continue;
    const at = (doc.get('subscribedAt') as Timestamp | null)?.toMillis?.() ?? 0;
    const p = patch(creatorId, fanId);
    (p.subs ??= []).push({ id: doc.id, subType: doc.get('subType') ?? null, isTrial: doc.get('isTrial') === true, at });
  }

  // ── 3. Merge into the stored rollups ──
  const keys = [...patches.keys()];
  const existing = new Map<string, Partial<BuddyxFanDocument>>();
  for (let i = 0; i < keys.length; i += 300) {
    const refs = keys.slice(i, i + 300).map(k => adminDb.collection(FANS).doc(k));
    for (const snap of await adminDb.getAll(...refs, { fieldMask: ['acquisition', 'subscriptions', 'isStacker', 'linkTotalSpent'] })) {
      if (snap.exists) existing.set(snap.id, snap.data() as Partial<BuddyxFanDocument>);
    }
  }

  const writer = adminDb.bulkWriter();
  for (const [key, p] of patches) {
    const prev = existing.get(key);
    const update: Record<string, unknown> = {
      creatorId: p.creatorId,
      fanId: p.fanId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (p.name) {
      update.name = p.name;
      update.nameSource = 'buddyx-link';
    }
    // The first link a fan arrived through stays their acquisition.
    if (p.acquisition && !prev?.acquisition) update.acquisition = p.acquisition;
    if (p.linkTotalSpent !== undefined) update.linkTotalSpent = Math.max(p.linkTotalSpent, prev?.linkTotalSpent ?? 0);
    if (p.isStacker) update.isStacker = true;
    if (p.subs?.length) {
      const subs = prev?.subscriptions ?? { lastSubType: null, isTrial: false, lastSubscribedAt: null, subCount: 0, eventIds: [] };
      const seen = new Set(subs.eventIds ?? []);
      let { subCount, lastSubType, isTrial } = subs;
      let lastAt = (subs.lastSubscribedAt as Timestamp | null)?.toMillis?.() ?? 0;
      for (const sub of p.subs.sort((a, b) => a.at - b.at)) {
        if (seen.has(sub.id)) continue;
        seen.add(sub.id);
        subCount += 1;
        if (sub.at >= lastAt) {
          lastAt = sub.at;
          lastSubType = sub.subType;
          isTrial = sub.isTrial;
        }
      }
      update.subscriptions = {
        lastSubType,
        isTrial,
        lastSubscribedAt: lastAt ? Timestamp.fromMillis(lastAt) : null,
        subCount,
        eventIds: [...seen].slice(-FAN_EVENT_ID_CAP),
      };
    }
    if (!prev) {
      update.spendByMonth = {};
      update.spendMonths = [];
      if (update.isStacker === undefined) update.isStacker = false;
    }
    writer.set(adminDb.collection(FANS).doc(key), update, { merge: true });
  }
  for (const [fanId, name] of fanNames) {
    writer.set(adminDb.collection(FAN_NAMES).doc(fanId), {
      fanId,
      name,
      source: 'buddyx-link',
      lastSeenAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.close();
  bump(ctx, 'fans.rollupsWritten', patches.size);
  bump(ctx, 'fans.namesWritten', fanNames.size);
  if (!ctx.partial) await writeCursors({ fansSubscribersSince: ctx.now });

  // ── 4. Spend, rebuilt from ca-sales for the open months ──
  if (outOfTime(ctx)) return;
  const month = currentMonthKey(ctx.now);
  bump(ctx, 'fans.spendWritten', await rebuildFanSpend([addMonths(month, -1), month]));
}

/**
 * Rebuild `buddyx-fans.spendByMonth[m]` for each month from `ca-sales` — both
 * sources, removed rows excluded. Writes only fans whose figure changed, and
 * clears the month from fans who no longer have a sale in it (found through
 * `spendMonths`, which is what that array is for).
 *
 * Called by the `fans` scope for the open months, and by the historical Infloww
 * import for every month it touched — which is what makes lifetime spend span
 * the cutover. Returns the number of fan documents written.
 */
export async function rebuildFanSpend(months: SalaryMonthKey[]): Promise<number> {
  let written = 0;
  for (const month of [...new Set(months)]) {
    const salesSnap = await adminDb
      .collection('ca-sales')
      .where('month', '==', month)
      .select('creatorId', 'fanId', 'kind', 'type', 'signedGross', 'occurredAt', 'removedAt', 'fanName')
      .get();

    const agg = new Map<string, { creatorId: string; fanId: string; tips: number; ppv: number; count: number; first: number; last: number; name: string }>();
    for (const doc of salesSnap.docs) {
      const sale = doc.data() as Partial<CaSaleDocument>;
      if (sale.removedAt || !sale.creatorId || !sale.fanId) continue;
      const key = fanKey(sale.creatorId, sale.fanId);
      const at = (sale.occurredAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      const entry = agg.get(key) ?? { creatorId: sale.creatorId, fanId: sale.fanId, tips: 0, ppv: 0, count: 0, first: at, last: at, name: '' };
      if (saleKindOf(sale) === 'ppv') entry.ppv = round2(entry.ppv + Number(sale.signedGross ?? 0));
      else entry.tips = round2(entry.tips + Number(sale.signedGross ?? 0));
      entry.count += 1;
      entry.first = Math.min(entry.first, at);
      if (at >= entry.last) {
        entry.last = at;
        if (sale.fanName) entry.name = sale.fanName;
      }
      agg.set(key, entry);
    }

    const monthPath = new FieldPath('spendByMonth', month);
    const prevSnap = await adminDb
      .collection(FANS)
      .where('spendMonths', 'array-contains', month)
      .select(monthPath)
      .get();
    const prev = new Map(prevSnap.docs.map(d => [d.id, d.get(monthPath) as { tips: number; ppv: number; count: number; last: number | null } | undefined]));

    const writer = adminDb.bulkWriter();
    for (const [key, entry] of agg) {
      const before = prev.get(key);
      const value = { tips: entry.tips, ppv: entry.ppv, count: entry.count, first: entry.first || null, last: entry.last || null };
      if (before && before.tips === value.tips && before.ppv === value.ppv && before.count === value.count && before.last === value.last) continue;
      writer.set(
        adminDb.collection(FANS).doc(key),
        {
          creatorId: entry.creatorId,
          fanId: entry.fanId,
          spendByMonth: { [month]: value },
          spendMonths: FieldValue.arrayUnion(month),
          ...(entry.name ? { salesName: entry.name } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      written += 1;
    }
    for (const key of prev.keys()) {
      if (agg.has(key)) continue;
      writer.update(
        adminDb.collection(FANS).doc(key),
        monthPath,
        FieldValue.delete(),
        'spendMonths',
        FieldValue.arrayRemove(month),
        'updatedAt',
        FieldValue.serverTimestamp(),
      );
      written += 1;
    }
    await writer.close();
  }
  return written;
}
