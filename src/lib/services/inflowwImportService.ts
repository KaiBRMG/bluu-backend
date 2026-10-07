/**
 * The one-off Infloww historical import — **delete after use** (buddyx.md §9).
 *
 * Two files, one admin-claim route (`/api/admin/buddyx/historical-import`):
 *
 * - **`sales`** — the CA sales export, 2025-10-04 → the cutover, through the
 *   same `parseSalesSheet` the retired `.xlsx` upload used. Rows after the
 *   cutover are refused (BuddyX owns them). Every row gains `source`, `kind`,
 *   `creatorId` and `sourceUserId`; because sale ids are content hashes, a row
 *   already stored is **updated in place**, which is how the existing history
 *   is backfilled with those fields rather than duplicated. Finalised months are
 *   refused, exactly as before. It also seeds the fan directory
 *   (`buddyx-fan-names`) and the per-fan spend rollup.
 * - **`creator-stats`** — the *Creator Statistics* export, sheet "Creator
 *   Statistics Detail". Only the fields BuddyX continues are kept, so every
 *   creator chart is one continuous series across the cutover.
 *
 * Both always preview first (`dryRun`).
 */
import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { normalizeEmail } from '../authEmail';
import { readXlsxSheet, XlsxError } from '../salary/xlsx';
import { buildUserResolver, parseMoney, parseSalesSheet } from '../salary/salesImport';
import { buildCreatorIdResolver } from '../salary/creatorResolver';
import { round2 } from '../salary/salaryEngine';
import { BUDDYX_CREATOR_STATS_START_DAY } from '../buddyx/constants';
import {
  getExistingSaleStamps,
  getFinalizedMonthsFor,
  recordImport,
  writeSales,
} from './caSalaryService';
import { displayNamesFor } from './userService';
import { rebuildFanSpend } from './buddyxStatsSync';
import type { SalesImportResult } from '../salary/salaryTypes';

export { XlsxError };

/** Infloww buckets creator statistics in UTC+0. */
const INFLOWW_STATS_TZ = 'Africa/Monrovia';

async function readCreators(): Promise<Array<{ id: string; stageName: string }>> {
  const [creators, subs] = await Promise.all([
    adminDb.collection('creators').select('creatorID', 'stageName').get(),
    adminDb.collection('creator-subaccounts').select('stageName').get(),
  ]);
  return [
    ...creators.docs.map(d => ({ id: (d.get('creatorID') as string | undefined) ?? d.id, stageName: (d.get('stageName') as string) ?? '' })),
    ...subs.docs.map(d => ({ id: d.id, stageName: (d.get('stageName') as string) ?? '' })),
  ];
}

// ─── Sales ───────────────────────────────────────────────────────────

export interface InflowwSalesImport {
  result: SalesImportResult & { backfilled: number; creatorsUnresolved: string[] };
  /** `uid|month` pairs written — for the commission-tier notice. */
  touched: string[];
}

export async function importInflowwSales(params: {
  buffer: Buffer;
  fileName: string;
  actorUid: string;
  actorName: string;
  dryRun: boolean;
}): Promise<InflowwSalesImport> {
  const { buffer, fileName, actorUid, actorName, dryRun } = params;
  const importId = adminDb.collection('ca-sales-imports').doc().id;

  const sheet = readXlsxSheet(buffer);
  // Archived users included: this is history, and a former agent's rows must
  // still resolve to them.
  const usersSnap = await adminDb.collection('users').select('uid', 'workEmail', 'displayName').get();
  const users = usersSnap.docs
    .map(d => d.data())
    .filter(u => typeof u.workEmail === 'string')
    .map(u => ({ uid: u.uid as string, workEmail: u.workEmail as string, displayName: (u.displayName as string) ?? u.uid }));
  const resolveCreatorId = buildCreatorIdResolver(await readCreators());

  const parsed = parseSalesSheet(sheet, buildUserResolver(users, normalizeEmail), importId, resolveCreatorId);
  const sales = parsed.sales;
  const creatorsUnresolved = [...new Set(sales.filter(s => !s.creatorId && s.creatorName).map(s => s.creatorName))].sort();

  // ── The finalised guard, both ways (unchanged from the .xlsx upload) ──
  const existing = await getExistingSaleStamps(sales.map(s => s.saleId));
  const movedFrom = (s: (typeof sales)[number]) => {
    const prev = existing.get(s.saleId)?.month;
    return prev && prev !== s.month ? prev : null;
  };
  const byMonth = new Map<string, Set<string>>();
  for (const s of sales) {
    for (const month of [s.month, movedFrom(s)]) {
      if (!month || !s.userId) continue;
      const set = byMonth.get(month) ?? new Set<string>();
      set.add(s.userId);
      byMonth.set(month, set);
    }
  }
  const finalizedPairs = new Set<string>();
  for (const [month, uids] of byMonth) {
    for (const uid of await getFinalizedMonthsFor([...uids], month)) finalizedPairs.add(`${uid}|${month}`);
  }
  const rejectedMonths = new Set<string>();
  const writable = sales.filter(s => {
    let ok = true;
    for (const month of [s.month, movedFrom(s)]) {
      if (month && finalizedPairs.has(`${s.userId}|${month}`)) {
        rejectedMonths.add(month);
        ok = false;
      }
    }
    return ok;
  });
  const blocked = sales.length - writable.length;
  const rejectedFinalizedMonths = [...rejectedMonths].sort();
  const restamped = writable.filter(s => {
    const prev = existing.get(s.saleId);
    return prev !== undefined && prev.day !== s.day;
  }).length;

  // ── Per-agent reconciliation ──
  const perUserMap = new Map<string, { userId: string; displayName: string; sourceEmail: string; gross: number; rows: number }>();
  for (const sale of writable) {
    if (!sale.userId) continue;
    const entry = perUserMap.get(sale.userId) ?? { userId: sale.userId, displayName: '', sourceEmail: sale.sourceEmail, gross: 0, rows: 0 };
    entry.gross = round2(entry.gross + sale.signedGross);
    entry.rows += 1;
    perUserMap.set(sale.userId, entry);
  }
  const names = await displayNamesFor([...perUserMap.keys()]);
  for (const entry of perUserMap.values()) entry.displayName = names.get(entry.userId) ?? entry.userId;

  const skipped = [...parsed.skips];
  if (blocked > 0) {
    skipped.push({
      reason: 'unmapped-email',
      detail: `${blocked} row${blocked === 1 ? '' : 's'} belong to a finalised month (${rejectedFinalizedMonths.join(', ')}) and were not written. Reopen the month to accept them.`,
      rowCount: blocked,
      sampleRows: [],
    });
  }

  const backfilled = writable.filter(s => existing.has(s.saleId)).length;
  const { written, duplicates } = dryRun
    ? { written: writable.length - backfilled, duplicates: backfilled }
    : await writeSales(writable, new Set(existing.keys()));

  const result = {
    importId,
    fileName,
    uploadedBy: actorUid,
    uploadedAt: new Date().toISOString(),
    totalRows: parsed.totalRows,
    imported: written,
    duplicates,
    skipped,
    skippedRows: skipped.reduce((sum, s) => sum + s.rowCount, 0),
    monthsTouched: [...new Set(writable.map(s => s.month))].sort(),
    perUser: [...perUserMap.values()].sort((a, b) => b.gross - a.gross),
    rejectedFinalizedMonths,
    restamped,
    backfilled,
    creatorsUnresolved,
  };

  if (!dryRun) {
    await recordImport({ ...result, uploadedByName: actorName, kind: 'infloww-historical' });
    await seedFanNames(sales);
    await rebuildFanSpend(result.monthsTouched);
  }

  return {
    result,
    touched: dryRun ? [] : writable.filter(s => s.userId).map(s => `${s.userId}|${s.month}`),
  };
}

/**
 * Seed `buddyx-fan-names` from the export's `Fan` / `Fan ID` columns. A name
 * already learned from a BuddyX link list is fresher and is left alone.
 */
async function seedFanNames(sales: Array<{ fanId: string; fanName: string; occurredAt: string }>): Promise<number> {
  const latest = new Map<string, { name: string; at: string }>();
  for (const sale of sales) {
    if (!sale.fanId || !sale.fanName) continue;
    const prev = latest.get(sale.fanId);
    if (!prev || sale.occurredAt > prev.at) latest.set(sale.fanId, { name: sale.fanName, at: sale.occurredAt });
  }
  const ids = [...latest.keys()];
  const fromLinks = new Set<string>();
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map(id => adminDb.collection('buddyx-fan-names').doc(id));
    for (const snap of await adminDb.getAll(...refs, { fieldMask: ['source'] })) {
      if (snap.exists && snap.get('source') === 'buddyx-link') fromLinks.add(snap.id);
    }
  }
  const writer = adminDb.bulkWriter();
  let written = 0;
  for (const [fanId, { name, at }] of latest) {
    if (fromLinks.has(fanId)) continue;
    writer.set(adminDb.collection('buddyx-fan-names').doc(fanId), {
      fanId,
      name,
      source: 'infloww',
      lastSeenAt: new Date(at),
    });
    written += 1;
  }
  await writer.close();
  return written;
}

// ─── Creator statistics ──────────────────────────────────────────────

/** `29m 1s`, `1h 2m 3s`, `45s` → ms. `null` for anything else. */
export function parseDurationText(raw: string): number | null {
  const text = (raw ?? '').trim().toLowerCase();
  if (!text || text === '-') return null;
  let ms = 0;
  let matched = false;
  for (const [, n, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m|s)\b/g)) {
    matched = true;
    const value = Number(n);
    ms += value * (unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000);
  }
  return matched ? Math.round(ms) : null;
}

function parseCount(raw: string): number | null {
  const text = (raw ?? '').replace(/[,\s]/g, '');
  if (text === '' || text === '-') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** The fields kept from the Infloww sheet — only those BuddyX continues (D3). */
const STATS_COLUMNS = {
  day: 'Date/Time Africa/Monrovia',
  creator: 'Creator',
  totalGross: 'Total earnings Gross',
  subsGross: 'Total subscription earnings Gross',
  tipsGross: 'Tips Gross',
  messagesGross: 'Message Gross',
  newSubs: 'New subscribers',
  fansChatted: 'Fans chatted',
  messagesSent: 'Messages sent',
  ppvsSent: 'PPVs sent',
  replyTime: 'Reply time',
} as const;

export interface CreatorStatsImport {
  rows: number;
  written: number;
  range: { from: string | null; to: string | null };
  creators: Array<{ name: string; creatorId: string; days: number; totalGross: number }>;
  skipped: Array<{ reason: string; detail: string; rowCount: number }>;
}

export async function importCreatorStats(params: { buffer: Buffer; dryRun: boolean }): Promise<CreatorStatsImport> {
  const sheet = readXlsxSheet(params.buffer, { sheetName: 'Creator Statistics Detail' });
  const missing = [STATS_COLUMNS.day, STATS_COLUMNS.creator, STATS_COLUMNS.totalGross].filter(c => !sheet.headers.includes(c));
  if (missing.length > 0) throw new XlsxError(`The sheet is missing: ${missing.join(', ')}.`);

  const resolve = buildCreatorIdResolver(await readCreators());
  const skips = new Map<string, { reason: string; detail: string; rowCount: number }>();
  const skip = (reason: string, detail: string) => {
    const key = `${reason}:${detail}`;
    const entry = skips.get(key) ?? { reason, detail, rowCount: 0 };
    entry.rowCount += 1;
    skips.set(key, entry);
  };

  const docs = new Map<string, Record<string, unknown>>();
  const perCreator = new Map<string, { name: string; creatorId: string; days: number; totalGross: number }>();
  let from: string | null = null;
  let to: string | null = null;

  for (const row of sheet.rows) {
    const day = (row[STATS_COLUMNS.day] ?? '').trim().slice(0, 10);
    const name = (row[STATS_COLUMNS.creator] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      skip('unparseable-date', row[STATS_COLUMNS.day] || '(blank)');
      continue;
    }
    // BuddyX owns this day onward — the two must never write one document.
    if (day >= BUDDYX_CREATOR_STATS_START_DAY) {
      skip('after-cutover', `Days from ${BUDDYX_CREATOR_STATS_START_DAY} come from BuddyX`);
      continue;
    }
    if (!name || /\(deleted\)/i.test(name)) {
      skip('deleted-creator', name || '(blank)');
      continue;
    }
    const creatorId = resolve(name);
    if (!creatorId) {
      skip('unmatched-creator', name);
      continue;
    }

    const money = (col: string) => {
      const v = parseMoney(row[col] ?? '');
      return v === null ? null : round2(v);
    };
    const doc = {
      creatorId,
      day,
      source: 'infloww',
      tz: INFLOWW_STATS_TZ,
      totalGross: money(STATS_COLUMNS.totalGross),
      subsGross: money(STATS_COLUMNS.subsGross),
      tipsGross: money(STATS_COLUMNS.tipsGross),
      messagesGross: money(STATS_COLUMNS.messagesGross),
      newSubs: parseCount(row[STATS_COLUMNS.newSubs] ?? ''),
      fansChatted: parseCount(row[STATS_COLUMNS.fansChatted] ?? ''),
      messagesSent: parseCount(row[STATS_COLUMNS.messagesSent] ?? ''),
      ppvsSent: parseCount(row[STATS_COLUMNS.ppvsSent] ?? ''),
      // Infloww's reply time is an average; BuddyX's a median. The chart marks
      // the cutover on this metric rather than pretending they are one series.
      replyTimeMs: parseDurationText(row[STATS_COLUMNS.replyTime] ?? ''),
    };
    docs.set(`${creatorId}_${day}`, doc);

    const entry = perCreator.get(creatorId) ?? { name, creatorId, days: 0, totalGross: 0 };
    entry.days += 1;
    entry.totalGross = round2(entry.totalGross + (doc.totalGross ?? 0));
    perCreator.set(creatorId, entry);
    if (!from || day < from) from = day;
    if (!to || day > to) to = day;
  }

  if (!params.dryRun && docs.size > 0) {
    const writer = adminDb.bulkWriter();
    for (const [id, doc] of docs) {
      writer.set(adminDb.collection('creator-stats-days').doc(id), { ...doc, syncedAt: FieldValue.serverTimestamp() });
    }
    await writer.close();
  }

  return {
    rows: sheet.rows.length,
    written: params.dryRun ? 0 : docs.size,
    range: { from, to },
    creators: [...perCreator.values()].sort((a, b) => b.totalGross - a.totalGross),
    skipped: [...skips.values()].sort((a, b) => b.rowCount - a.rowCount),
  };
}
