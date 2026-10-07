/**
 * BuddyX sync — orchestration, and the `sales` scope.
 *
 * ```
 *  cron 05:01 / 13:01 / 21:01 UTC ──┐
 *  manual refresh (cooled down) ────┤──► runBuddyxSync(scopes)
 *                                   │      lease lock → directory → scopes → run log
 *                                   ▼
 *                        lib/buddyx/client.ts (the only file that calls the API)
 * ```
 *
 * ## What lives here
 *
 * - **The lease** (`buddyx-meta/lock`): one sync at a time, claimed in a
 *   transaction with a 6-minute lease, so a crashed run frees itself. A cron
 *   that finds it held skips; a manual refresh gets a 409 and polls status.
 * - **Freshness** (`buddyx-meta/state`): per scope, last success / attempt /
 *   error — the one document every "Synced 3 min ago" reads.
 * - **The run log** (`buddyx-sync-runs`): one row per run, TTL 90 days.
 * - **The alert** (`buddyxSyncFailing`): a revoked key, three failed runs in a
 *   row, or a new unmapped chatter carrying sales. Once per incident.
 * - **The sales scope**, which writes `ca-sales` — the money path. Its decisions
 *   are made by the pure planner (`lib/buddyx/salesPlan.ts`); this file reads
 *   and writes around it.
 *
 * The analytics scopes (`chatters`, `creators`, `fans`) are in
 * `buddyxStatsSync.ts`. Neither file is ever reached from a page read: the
 * analytics routes read Firestore only.
 */
import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { buddyxAll, isBuddyxConfigured, requestCount, resetRequestCount } from '../buddyx/client';
import { isBuddyxError } from '../buddyx/errors';
import { serializeTimestamp } from '../middleware/apiHelpers';
import {
  BUDDYX_SCOPES,
  REFRESH_COOLDOWN_MS,
  SYNC_LEASE_MS,
  SYNC_TIME_BUDGET_MS,
  type BuddyxScope,
} from '../buddyx/constants';
import {
  collectHolderPairs,
  normalisePpv,
  normaliseTip,
  pairKey,
  planSalesSync,
  type NormalisedSale,
  type StoredSale,
} from '../buddyx/salesPlan';
import type { BuddyxPpvRow, BuddyxTipRow } from '../buddyx/types';
import { SALARY_TIMEZONE, SALES_CUTOVER_AT } from '../salary/salaryConstants';
import { addMonths, currentMonthKey, monthKeyRange, toDayKey, type SalaryMonthKey } from '../salary/salaryDate';
import { notifications } from '../notificationContent';
import { getFinalizedMonthsFor, resolvePayrollMonth } from './caSalaryService';
import { CHATTERS, loadBuddyxMaps, syncDirectory } from './buddyxMappingService';
import { clearOpsAlert, sendOpsAlertOnce } from './onlyfansOpsAlerts';
import { announceTierCrossings } from './tierNotices';
import { displayNamesFor } from './userService';
import { syncChattersScope, syncCreatorsScope, syncFansScope } from './buddyxStatsSync';
import { bump, type SyncContext } from './buddyxSyncContext';
import type {
  BuddyxConfigDocument,
  BuddyxScopeState,
  BuddyxStateDocument,
  CaSaleDocument,
} from '@/types/firestore';

const META = 'buddyx-meta';
const RUNS = 'buddyx-sync-runs';
const SALES = 'ca-sales';
const STATE_DOC = `${META}/state`;
const LOCK_DOC = `${META}/lock`;
const CONFIG_DOC = `${META}/config`;

/** The incident latch for `buddyxSyncFailing`. */
const FAILING_ALERT_KEY = 'buddyx-sync-failing';
/** Consecutive failed runs before the alert fires. */
const FAILURES_BEFORE_ALERT = 3;
const RUN_LOG_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// ─── Config, state, lock ─────────────────────────────────────────────

export async function getBuddyxConfig(): Promise<BuddyxConfigDocument> {
  const snap = await adminDb.doc(CONFIG_DOC).get();
  return { salesWriteEnabled: snap.exists && snap.get('salesWriteEnabled') === true };
}

export async function setSalesWriteEnabled(enabled: boolean, actorUid: string): Promise<void> {
  await adminDb.doc(CONFIG_DOC).set(
    { salesWriteEnabled: enabled, updatedBy: actorUid, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export interface ScopeStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export interface BuddyxStatus {
  configured: boolean;
  scopes: Record<BuddyxScope, ScopeStatus>;
  /** The scope a sync is running for right now, or null. */
  running: string | null;
  salesWriteEnabled: boolean;
}

const iso = serializeTimestamp;

/**
 * Three document reads. Read by `GET /api/buddyx/status`, which a waiting
 * refresh polls every 5s — so nothing here may scan a collection.
 */
export async function getBuddyxStatus(): Promise<BuddyxStatus> {
  const [stateSnap, lockSnap, config] = await Promise.all([
    adminDb.doc(STATE_DOC).get(),
    adminDb.doc(LOCK_DOC).get(),
    getBuddyxConfig(),
  ]);
  const state = (stateSnap.data() ?? {}) as BuddyxStateDocument;
  const scopes = {} as Record<BuddyxScope, ScopeStatus>;
  for (const scope of BUDDYX_SCOPES) {
    const s = state[scope];
    scopes[scope] = {
      lastSuccessAt: iso(s?.lastSuccessAt),
      lastAttemptAt: iso(s?.lastAttemptAt),
      lastError: s?.lastError ?? null,
    };
  }
  const lock = lockSnap.data();
  const held = Boolean(lock) && ((lock?.expiresAt as Timestamp | undefined)?.toMillis?.() ?? 0) > Date.now();
  return {
    configured: isBuddyxConfigured(),
    scopes,
    running: held ? String(lock?.scope ?? 'sync') : null,
    salesWriteEnabled: config.salesWriteEnabled,
  };
}

async function acquireLock(holder: string, scope: string): Promise<{ ok: true } | { ok: false; running: string }> {
  const ref = adminDb.doc(LOCK_DOC);
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const expires = (data?.expiresAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (snap.exists && expires > Date.now()) return { ok: false as const, running: String(data?.scope ?? 'sync') };
    tx.set(ref, { holder, scope, expiresAt: Timestamp.fromMillis(Date.now() + SYNC_LEASE_MS) });
    return { ok: true as const };
  });
}

async function releaseLock(holder: string): Promise<void> {
  const ref = adminDb.doc(LOCK_DOC);
  await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.get('holder') === holder) tx.delete(ref);
  });
}

async function markScope(scope: BuddyxScope, error: string | null): Promise<void> {
  const now = FieldValue.serverTimestamp();
  // `set` + `merge` deep-merges the scope's map, so the other scopes' entries
  // (and this one's `lastSuccessAt` on a failure) are left alone.
  await adminDb.doc(STATE_DOC).set(
    { [scope]: { lastAttemptAt: now, lastError: error, ...(error ? {} : { lastSuccessAt: now }) } },
    { merge: true },
  );
}

const DIRECTORY_REUSE_MS = 60 * 60_000;

async function directoryIsRecent(): Promise<boolean> {
  const snap = await adminDb.doc(STATE_DOC).get();
  const last = (snap.get('directory.lastSuccessAt') as Timestamp | undefined)?.toMillis?.() ?? 0;
  return Date.now() - last < DIRECTORY_REUSE_MS;
}

/**
 * Whether a manual refresh of this scope is inside its cooldown. Returns the
 * time it last synced when it is, so the UI can say "Already up to date".
 */
export async function refreshCooldown(scope: BuddyxScope): Promise<{ cooling: boolean; syncedAt: string | null }> {
  const snap = await adminDb.doc(STATE_DOC).get();
  const state = (snap.data() ?? {}) as BuddyxStateDocument;
  const s: BuddyxScopeState | undefined = state[scope];
  const attempted = s?.lastAttemptAt?.toMillis?.() ?? 0;
  return {
    cooling: Date.now() - attempted < REFRESH_COOLDOWN_MS,
    syncedAt: iso(s?.lastSuccessAt),
  };
}

// ─── Alerts ──────────────────────────────────────────────────────────

/**
 * Track consecutive failed runs and fire / clear the incident alert. Never
 * throws — an alert that could not be sent must not fail the run.
 */
async function updateIncident(failed: boolean, fatalReason: string | null): Promise<void> {
  try {
    const ref = adminDb.doc(STATE_DOC);
    const snap = await ref.get();
    const prev = Number(snap.get('runFailures') ?? 0);
    const failures = failed ? prev + 1 : 0;
    await ref.set({ runFailures: failures }, { merge: true });

    if (!failed) {
      await clearOpsAlert(FAILING_ALERT_KEY);
      return;
    }
    if (fatalReason) {
      await sendOpsAlertOnce(FAILING_ALERT_KEY, notifications.buddyxSyncFailing(fatalReason));
    } else if (failures >= FAILURES_BEFORE_ALERT) {
      await sendOpsAlertOnce(
        FAILING_ALERT_KEY,
        notifications.buddyxSyncFailing(`The BuddyX sync has failed ${failures} runs in a row.`),
      );
    }
  } catch (err) {
    console.error('[buddyx] incident tracking failed', err);
  }
}

/**
 * A BuddyX chatter carrying sales that resolve to nobody. Each chatter alerts
 * once (`unmappedAlertedAt`), and the latch resets when it maps — so a chatter
 * who is unlinked again later is reported again.
 */
async function alertUnmappedChatters(
  unmapped: Map<string, { name: string | null; rows: number; gross: number }>,
): Promise<void> {
  if (unmapped.size === 0) return;
  try {
    const refs = [...unmapped.keys()].map(id => adminDb.collection(CHATTERS).doc(id));
    const snaps = await adminDb.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists && snap.get('unmappedAlertedAt')) continue;
      const entry = unmapped.get(snap.id)!;
      const who = entry.name ? `${entry.name} (BuddyX chatter ${snap.id})` : `BuddyX chatter ${snap.id}`;
      const sent = await sendOpsAlertOnce(
        `buddyx-unmapped-${snap.id}`,
        notifications.buddyxSyncFailing(
          `${who} is carrying ${entry.rows} sale${entry.rows === 1 ? '' : 's'} ($${entry.gross.toFixed(2)}) but matches no Bluu user.`,
        ),
      );
      if (sent || !snap.exists) {
        await adminDb.collection(CHATTERS).doc(snap.id).set({ unmappedAlertedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
  } catch (err) {
    console.error('[buddyx] unmapped-chatter alert failed', err);
  }
}

// ─── The sales scope ─────────────────────────────────────────────────

/** Per-agent-per-day totals for the dry-run preview an admin checks against BuddyX. */
export interface SalesPreviewRow {
  uid: string | null;
  name: string;
  day: string;
  tips: number;
  ppv: number;
  count: number;
}

export interface SalesScopeResult {
  windowStart: string;
  months: SalaryMonthKey[];
  wrote: boolean;
  preview: SalesPreviewRow[] | null;
  rejectedFinalized: Array<{ saleId: string; months: string[] }>;
}

/**
 * The months the sales window spans: from the oldest month payroll still owes
 * (`resolvePayrollMonth` — last month until every agent is finalised) to now,
 * never earlier than the cutover.
 */
export async function salesWindow(now: number): Promise<{ start: number; months: SalaryMonthKey[] }> {
  const first = await resolvePayrollMonth(now);
  const current = currentMonthKey(now);
  const start = Math.max(SALES_CUTOVER_AT + 1, monthKeyRange(first)[0]);
  const months: SalaryMonthKey[] = [];
  for (let m = currentMonthKey(start); m <= current; m = addMonths(m, 1)) months.push(m);
  return { start, months };
}

/** The window's stored BuddyX rows, field-masked. One query per month. */
async function readStoredSales(months: SalaryMonthKey[]): Promise<Map<string, StoredSale>> {
  const out = new Map<string, StoredSale>();
  const snaps = await Promise.all(
    months.map(month =>
      adminDb
        .collection(SALES)
        .where('month', '==', month)
        .where('source', '==', 'buddyx')
        .select('userId', 'month', 'transfer', 'removedAt', 'syncHash', 'vanishedAfterFinalise')
        .get(),
    ),
  );
  for (const [i, snap] of snaps.entries()) {
    const month = months[i];
    for (const doc of snap.docs) {
      const data = doc.data() as Partial<CaSaleDocument>;
      out.set(doc.id, {
        saleId: doc.id,
        userId: data.userId ?? null,
        month: data.month ?? month,
        transfer: data.transfer ? { fromUserId: data.transfer.fromUserId ?? null, toUserId: data.transfer.toUserId } : null,
        removed: Boolean(data.removedAt),
        syncHash: data.syncHash ?? null,
        vanishedAfterFinalise: data.vanishedAfterFinalise === true,
      });
    }
  }
  return out;
}

/** Which of the given `uid|month` pairs are finalised. One batched read per month. */
async function readFinalized(pairs: Set<string>): Promise<Set<string>> {
  const byMonth = new Map<string, string[]>();
  for (const pair of pairs) {
    const [uid, month] = pair.split('|');
    const list = byMonth.get(month) ?? [];
    list.push(uid);
    byMonth.set(month, list);
  }
  const out = new Set<string>();
  await Promise.all(
    [...byMonth].map(async ([month, uids]) => {
      for (const uid of await getFinalizedMonthsFor(uids, month)) out.add(pairKey(uid, month));
    }),
  );
  return out;
}

/** Fan names for the rows being written — only those, never the whole window. */
async function fanNamesFor(fanIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(fanIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map(id => adminDb.collection('buddyx-fan-names').doc(id));
    for (const snap of await adminDb.getAll(...refs, { fieldMask: ['name'] })) {
      const name = snap.get('name');
      if (snap.exists && typeof name === 'string' && name) out.set(snap.id, name);
    }
  }
  return out;
}

/**
 * The `sales` scope. Re-pulls the whole window every run — a few hundred rows a
 * month, 2–4 pages per endpoint — because a full re-pull is what makes
 * vanished-row detection and late re-attribution correct.
 *
 * `write: false` runs everything except the writes and returns a per-agent,
 * per-day preview instead: the dry run an admin checks against the BuddyX
 * dashboard before switching the scope on (`salesWriteEnabled`).
 */
export async function syncSalesScope(ctx: SyncContext, write: boolean): Promise<SalesScopeResult> {
  const { start, months } = await salesWindow(ctx.now);
  const range = {
    startDate: new Date(start).toISOString(),
    endDate: new Date(ctx.now).toISOString(),
    timeZone: SALARY_TIMEZONE,
  };

  // Both endpoints must paginate to completion for anything to be removed.
  // `buddyxAll` throws on any failure, so reaching the next line means both did.
  const [tipRows, ppvRows] = await Promise.all([
    buddyxAll<BuddyxTipRow>('/v1/public/team-reports/tips', range),
    buddyxAll<BuddyxPpvRow>('/v1/public/team-reports/ppv-revenue', range),
  ]);
  const complete = true;

  const sales: NormalisedSale[] = [];
  for (const row of tipRows) {
    const sale = normaliseTip(row);
    if (sale) sales.push(sale);
  }
  for (const row of ppvRows) {
    const sale = normalisePpv(row);
    if (sale) sales.push(sale);
  }

  const stored = await readStoredSales(months);
  const finalized = await readFinalized(collectHolderPairs(sales, stored, ctx.maps.chatters, ctx.maps.models));
  const plan = planSalesSync({
    sales,
    stored,
    chatters: ctx.maps.chatters,
    models: ctx.maps.models,
    finalized,
    complete,
  });

  for (const [key, value] of Object.entries(plan.counts)) bump(ctx, `sales.${key}`, value);

  if (!write) {
    // Preview: what the window would pay, per agent per day, from the rows
    // the API returned — the figure an admin reconciles against the dashboard.
    const byKey = new Map<string, SalesPreviewRow>();
    for (const sale of sales) {
      const chatter = sale.chatterId ? ctx.maps.chatters.get(sale.chatterId) : undefined;
      const uid = stored.get(sale.saleId)?.transfer?.toUserId ?? chatter?.uid ?? null;
      const day = toDayKey(sale.occurredAtMs);
      const key = `${uid ?? `chatter:${sale.chatterId ?? 'none'}`}|${day}`;
      const row = byKey.get(key) ?? {
        uid,
        name: uid ? '' : sale.chatterId ? (sale.chatterName ?? `Chatter ${sale.chatterId}`) + ' (unmapped)' : 'Unassigned',
        day,
        tips: 0,
        ppv: 0,
        count: 0,
      };
      if (sale.kind === 'tip') row.tips = Math.round((row.tips + sale.gross) * 100) / 100;
      else row.ppv = Math.round((row.ppv + sale.gross) * 100) / 100;
      row.count += 1;
      byKey.set(key, row);
    }
    const preview = [...byKey.values()];
    const names = await displayNamesFor(preview.map(r => r.uid));
    for (const row of preview) if (row.uid) row.name = names.get(row.uid) ?? row.uid;
    preview.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
    return {
      windowStart: new Date(start).toISOString(),
      months,
      wrote: false,
      preview,
      rejectedFinalized: plan.rejectedFinalized,
    };
  }

  // ── Write ──
  const names = await fanNamesFor(plan.upserts.map(u => u.sale.fanId));
  const writer = adminDb.bulkWriter();
  const syncedAt = Timestamp.fromMillis(ctx.now);
  for (const { sale, isNew } of plan.upserts) {
    const { occurredAtMs, ...fields } = sale;
    writer.set(
      adminDb.collection(SALES).doc(sale.saleId),
      {
        ...fields,
        occurredAt: Timestamp.fromMillis(occurredAtMs),
        fanName: names.get(sale.fanId) ?? '',
        importId: ctx.runId,
        syncedAt,
        ...(isNew ? { createdAt: FieldValue.serverTimestamp(), transfer: null, disputeId: null } : {}),
      },
      // `merge` is what keeps a transfer and a dispute lock: the plan never
      // names either field on an existing row, so a sync can never clear them.
      { merge: true },
    );
  }
  for (const saleId of plan.removals) {
    writer.update(adminDb.collection(SALES).doc(saleId), { removedAt: syncedAt, syncedAt });
  }
  for (const saleId of plan.vanishedFlags) {
    writer.update(adminDb.collection(SALES).doc(saleId), { vanishedAfterFinalise: true, syncedAt });
  }
  await writer.close();

  await alertUnmappedChatters(plan.unmappedChatters);
  if (plan.touched.size > 0) await announceTierCrossings(plan.touched);

  return {
    windowStart: new Date(start).toISOString(),
    months,
    wrote: true,
    preview: null,
    rejectedFinalized: plan.rejectedFinalized,
  };
}

// ─── The run ─────────────────────────────────────────────────────────

export interface SyncRunResult {
  runId: string;
  ran: BuddyxScope[];
  failed: BuddyxScope[];
  counts: Record<string, number>;
  errors: string[];
  requestCount: number;
  durationMs: number;
  partial: boolean;
  sales: SalesScopeResult | null;
}

export type SyncOutcome = { ok: true; result: SyncRunResult } | { ok: false; running: string };

/**
 * Run the named scopes, `directory` first. One run at a time (the lease).
 *
 * `trigger` is `'cron'` or the uid of whoever pressed refresh, recorded on the
 * run log. `salesPreview` turns the sales scope into a dry run regardless of
 * the switch; otherwise the scope writes only when `salesWriteEnabled`.
 */
export async function runBuddyxSync(params: {
  scopes: BuddyxScope[];
  trigger: string;
  salesPreview?: boolean;
}): Promise<SyncOutcome> {
  const scopes = BUDDYX_SCOPES.filter(s => s === 'directory' || params.scopes.includes(s));
  const runRef = adminDb.collection(RUNS).doc();
  const lock = await acquireLock(runRef.id, scopes.filter(s => s !== 'directory').join(',') || 'directory');
  if (!lock.ok) return lock;

  const startedAt = Date.now();
  resetRequestCount();
  const ctx: SyncContext = {
    runId: runRef.id,
    now: startedAt,
    deadline: startedAt + SYNC_TIME_BUDGET_MS,
    dryRun: Boolean(params.salesPreview),
    maps: { chatters: new Map(), models: new Map(), modelCreator: new Map(), uidChatter: new Map() },
    counts: {},
    errors: [],
    partial: false,
  };
  const ran: BuddyxScope[] = [];
  const failed: BuddyxScope[] = [];
  let fatalReason: string | null = null;
  let salesResult: SalesScopeResult | null = null;

  try {
    const config = await getBuddyxConfig();

    for (const scope of scopes) {
      if (fatalReason) break;
      try {
        if (scope === 'directory') {
          // A manual refresh of another scope reuses a directory synced in the
          // last hour rather than re-reading five collections per button press.
          if (params.trigger !== 'cron' && !params.scopes.includes('directory') && (await directoryIsRecent())) {
            ctx.maps = await loadBuddyxMaps();
            continue;
          }
          const directory = await syncDirectory();
          ctx.maps = directory.maps;
          for (const [key, value] of Object.entries(directory.counts)) bump(ctx, `directory.${key}`, value);
        } else if (scope === 'sales') {
          salesResult = await syncSalesScope(ctx, !params.salesPreview && config.salesWriteEnabled);
          if (!salesResult.wrote) bump(ctx, 'sales.dryRun');
        } else if (scope === 'chatters') {
          await syncChattersScope(ctx);
        } else if (scope === 'creators') {
          await syncCreatorsScope(ctx);
        } else if (scope === 'fans') {
          await syncFansScope(ctx);
        }
        ran.push(scope);
        // A preview is not a sync: it must not make the sales figures look fresh.
        if (!(scope === 'sales' && salesResult && !salesResult.wrote)) await markScope(scope, null);
      } catch (err) {
        failed.push(scope);
        const message = err instanceof Error ? err.message : String(err);
        ctx.errors.push(`${scope}: ${message}`);
        console.error(`[buddyx] ${scope} failed`, err);
        await markScope(scope, message.slice(0, 300));

        if (isBuddyxError(err) && err.isFatal) {
          fatalReason = 'The BuddyX API key was rejected (revoked, malformed or missing). Issue a new key and set BUDDYX_API_KEY.';
        }
        // Without the directory nothing can be attributed — fall back to the
        // stored maps so the analytics scopes can still run.
        if (scope === 'directory' && !fatalReason) ctx.maps = await loadBuddyxMaps();
      }
    }
  } finally {
    const durationMs = Date.now() - startedAt;
    await runRef
      .set({
        trigger: params.trigger,
        scopes,
        startedAt: Timestamp.fromMillis(startedAt),
        durationMs,
        requestCount: requestCount(),
        counts: ctx.counts,
        errors: ctx.errors,
        dryRun: Boolean(params.salesPreview),
        partial: ctx.partial,
        expireAt: Timestamp.fromMillis(startedAt + RUN_LOG_TTL_MS),
      })
      .catch(err => console.error('[buddyx] run log write failed', err));
    await releaseLock(runRef.id).catch(err => console.error('[buddyx] lock release failed', err));
  }

  await updateIncident(failed.length > 0, fatalReason);

  return {
    ok: true,
    result: {
      runId: runRef.id,
      ran,
      failed,
      counts: ctx.counts,
      errors: ctx.errors,
      requestCount: requestCount(),
      durationMs: Date.now() - startedAt,
      partial: ctx.partial,
      sales: salesResult,
    },
  };
}

/** The last N runs, for CA Admin → Sales → Sync history. */
export async function getRecentSyncRuns(limit = 20) {
  const snap = await adminDb.collection(RUNS).orderBy('startedAt', 'desc').limit(limit).get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      runId: d.id,
      trigger: String(data.trigger ?? ''),
      scopes: (data.scopes ?? []) as string[],
      startedAt: iso(data.startedAt),
      durationMs: Number(data.durationMs ?? 0),
      requestCount: Number(data.requestCount ?? 0),
      counts: (data.counts ?? {}) as Record<string, number>,
      errors: (data.errors ?? []) as string[],
      dryRun: data.dryRun === true,
      partial: data.partial === true,
    };
  });
}

