/**
 * Sales export → normalised sale records.
 *
 * Pure: it takes a parsed sheet and a resolver, and returns rows plus a report.
 * Firestore lives in `caSalaryService`. Keeping the two apart is what lets the
 * admin screen offer a **dry run** — the same function, without the write — so
 * an admin can see exactly what a file would do before it does it.
 *
 * ## Idempotency
 *
 * A sale's document id is a hash of the facts that identify it: when it
 * happened, who earned it, which fan, how much, what type, and its disposition.
 * Re-uploading a file that overlaps a previous one therefore rewrites the same
 * documents instead of double-counting — which matters, because the exports are
 * cumulative and an admin uploading "the last few days" will always overlap.
 *
 * Two *genuinely distinct* sales that agree on every one of those facts (same
 * fan, same creator, same amount, same second) would otherwise collapse into
 * one, so identical rows within a single file are disambiguated by their
 * occurrence index. That keeps both rows and stays stable across re-uploads.
 */

import { createHash } from 'node:crypto';
import { SALES_EMAIL_MAP, REQUIRED_SALES_COLUMNS, type SaleStatus } from './salaryConstants';
import { parseExportTimestamp, toDayKey, toMonthKey } from './salaryDate';
import type { SalarySale, SalesImportSkip } from './salaryTypes';
import type { XlsxSheet } from './xlsx';
import { XlsxError } from './xlsx';

/**
 * `"$1,234.56"` → `1234.56`.
 *
 * Accepts a leading minus and accounting parentheses, tolerates any currency
 * symbol and thousands separators, and returns `null` rather than `0` for
 * anything it cannot read — an unparseable amount is a row to report, not a
 * free zero that quietly shrinks someone's month.
 */
export function parseMoney(raw: string): number | null {
  const text = (raw ?? '').trim();
  if (text === '' || text === '-' || text === '—') return null;

  const parenthesised = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[()]/g, '').replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return parenthesised ? -Math.abs(value) : value;
}

/**
 * The export writes `Complete` or `Reverse`. Anything unrecognised is treated as
 * complete: a new status string the provider adds later should not silently zero
 * a real sale, and an admin reviewing the sales report will see the raw value.
 */
export function normaliseStatus(raw: string): SaleStatus {
  return (raw ?? '').trim().toLowerCase().startsWith('rev') ? 'reverse' : 'complete';
}

/** Stable document id for a sale. See the idempotency note above. */
export function buildSaleId(parts: {
  occurredAtMs: number;
  sourceEmail: string;
  fanId: string;
  creatorName: string;
  grossRevenue: number;
  type: string;
  status: SaleStatus;
  occurrenceIndex: number;
}): string {
  const key = [
    parts.occurredAtMs,
    parts.sourceEmail.toLowerCase(),
    parts.fanId,
    parts.creatorName.toLowerCase(),
    parts.grossRevenue.toFixed(2),
    parts.type.toLowerCase(),
    parts.status,
    parts.occurrenceIndex,
  ].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 28);
}

/** Resolves a source-export address to a Bluu Backend uid, or null if unknown. */
export type UserResolver = (sourceEmail: string) => { uid: string; displayName: string } | null;

export interface ParsedSales {
  sales: SalarySale[];
  skips: SalesImportSkip[];
  totalRows: number;
}

interface SkipAccumulator {
  reason: SalesImportSkip['reason'];
  detail: string;
  rowCount: number;
  sampleRows: number[];
}

/**
 * Validate the sheet's columns and turn its rows into sales.
 *
 * Throws only for a file that is structurally wrong — a missing required column
 * makes every row unreadable, so failing whole is clearer than reporting 686
 * identical skips. Everything row-level is reported instead, grouped by reason,
 * so an admin sees "142 rows: no account for jessy@bluurock.com" rather than a
 * wall.
 */
export function parseSalesSheet(sheet: XlsxSheet, resolve: UserResolver, importId: string): ParsedSales {
  const present = new Set(sheet.headers);
  const missing = REQUIRED_SALES_COLUMNS.filter(c => !present.has(c));
  if (missing.length > 0) {
    throw new XlsxError(
      `The file is missing ${missing.length === 1 ? 'a required column' : 'required columns'}: ${missing.join(', ')}. ` +
        `Found: ${sheet.headers.join(', ')}.`,
    );
  }

  const sales: SalarySale[] = [];
  const skips = new Map<string, SkipAccumulator>();
  const occurrences = new Map<string, number>();

  const skip = (reason: SalesImportSkip['reason'], detail: string, rowNumber: number) => {
    const key = `${reason}:${detail}`;
    const existing = skips.get(key);
    if (existing) {
      existing.rowCount++;
      if (existing.sampleRows.length < 5) existing.sampleRows.push(rowNumber);
    } else {
      skips.set(key, { reason, detail, rowCount: 1, sampleRows: [rowNumber] });
    }
  };

  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const rowNumber = sheet.rowNumbers[i];

    const sourceEmail = (row['Email'] ?? '').trim().toLowerCase();
    if (!sourceEmail) {
      skip('missing-email', 'Row has no Employee email', rowNumber);
      continue;
    }

    const user = resolve(sourceEmail);
    if (!user) {
      skip('unmapped-email', sourceEmail, rowNumber);
      continue;
    }

    const occurredAtMs = parseExportTimestamp(row['Date & time Africa/Harare'] ?? '');
    if (occurredAtMs === null) {
      skip('unparseable-date', row['Date & time Africa/Harare'] || '(blank)', rowNumber);
      continue;
    }

    const grossRevenue = parseMoney(row['Gross revenue'] ?? '');
    if (grossRevenue === null) {
      skip('unparseable-amount', row['Gross revenue'] || '(blank)', rowNumber);
      continue;
    }

    // Trust the export's own net when it is present — it is the figure the
    // agent's third-party dashboard shows them, so a derived one that differs by
    // a cent would be the first thing disputed.
    const netFromFile = parseMoney(row['Net revenue'] ?? '');
    const netRevenue = netFromFile ?? grossRevenue * 0.8;

    const creatorName = (row['Creator'] ?? '').trim();
    const type = (row['Type'] ?? '').trim();
    const fanId = (row['Fan ID'] ?? '').trim();
    const status = normaliseStatus(row['Status'] ?? '');

    const identity = [occurredAtMs, sourceEmail, fanId, creatorName, grossRevenue.toFixed(2), type, status].join('|');
    const occurrenceIndex = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrenceIndex + 1);

    const saleId = buildSaleId({
      occurredAtMs,
      sourceEmail,
      fanId,
      creatorName,
      grossRevenue,
      type,
      status,
      occurrenceIndex,
    });

    sales.push({
      saleId,
      userId: user.uid,
      day: toDayKey(occurredAtMs),
      month: toMonthKey(occurredAtMs),
      occurredAt: new Date(occurredAtMs).toISOString(),
      employeeName: (row['Employee'] ?? '').trim(),
      sourceEmail,
      creatorName,
      fanName: (row['Fan'] ?? '').trim(),
      fanId,
      grossRevenue,
      netRevenue,
      // A reversal is money going back to the fan, so it is stored negative and
      // the engine simply sums this column.
      signedGross: status === 'reverse' ? -grossRevenue : grossRevenue,
      type,
      rule: (row['Rule'] ?? '').trim(),
      assignedBy: (row['Assigned by'] ?? '').trim(),
      status,
      importId,
    });
  }

  return {
    sales,
    skips: [...skips.values()].sort((a, b) => b.rowCount - a.rowCount),
    totalRows: sheet.rows.length,
  };
}

/**
 * Build the resolver from the registered user list.
 *
 * Two passes, in order: the source address through {@link SALES_EMAIL_MAP} to a
 * personal Google account, then the source address itself. The second covers
 * anyone who has not been through the personal-email migration and still signs
 * in on `@bluurock.com`, so the importer keeps working through that rollout
 * without a code change either way.
 *
 * `normalise` must be `normalizeEmail` from `lib/authEmail` — the same folding
 * login uses, so an address that authorises here is the same string that
 * authorises there.
 */
export function buildUserResolver(
  users: Array<{ uid: string; workEmail: string; displayName: string }>,
  normalise: (email: string) => string,
): UserResolver {
  const byEmail = new Map<string, { uid: string; displayName: string }>();
  for (const u of users) {
    const key = normalise(u.workEmail);
    if (key) byEmail.set(key, { uid: u.uid, displayName: u.displayName });
  }

  return (sourceEmail: string) => {
    const mapped = SALES_EMAIL_MAP[sourceEmail.toLowerCase()];
    if (mapped) {
      const hit = byEmail.get(normalise(mapped));
      if (hit) return hit;
    }
    return byEmail.get(normalise(sourceEmail)) ?? null;
  };
}
