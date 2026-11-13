/**
 * OnlyMonster sync — the orchestrator.
 *
 * ```
 *  Vercel Cron 05:01 / 13:01 / 21:01 UTC ──► runOnlyMonsterSync()
 *                                             lease → stages in order → run log → incident
 *                                             │
 *                                lib/onlymonster/client.ts (the only file that calls the API)
 * ```
 *
 * - **The lease** (`onlymonster-meta/lock`): one run at a time, claimed in a
 *   transaction with a 6-minute lease, so a crashed run frees itself. A run that
 *   finds it held skips.
 * - **Freshness** (`onlymonster-meta/state`): per stage, last success / attempt /
 *   error. The one document `DataFreshness` reads.
 * - **The run log** (`onlymonster-sync-runs`): one row per run, TTL 90 days via
 *   `expireAt` (the TTL policy is set in the console, see documentation/onlymonster.md).
 * - **The alert** (`onlymonsterSyncFailing`): a rejected key, a missing
 *   permission, or three failed runs in a row. Once per incident; cleared on the
 *   next healthy run.
 * - **Not configured is not failing.** Until `ONLYMONSTER_API_KEY` is set in the
 *   environment, a run records nothing and alerts nobody, so a deploy that lands
 *   before the key does not page the maintainer three times a day.
 *
 * Phase 1 runs `directory` only. Each later phase adds its stage to
 * `ONLYMONSTER_STAGES` and a branch in `runStage` (migration plan §4.1).
 * No stage is ever reached from a page read: pages read Firestore only.
 */
import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { isOnlyMonsterConfigured, requestCount, resetRequestCount } from '../onlymonster/client';
import { isOnlyMonsterError } from '../onlymonster/errors';
import {
  COLLECTIONS,
  ONLYMONSTER_STAGES,
  RECONCILE_HOUR_UTC,
  SYNC_LEASE_MS,
  SYNC_TIME_BUDGET_MS,
  nextScheduledRun,
  type OnlyMonsterStage,
} from '../onlymonster/constants';
import { serializeTimestamp } from '../middleware/apiHelpers';
import { notifications } from '../notificationContent';
import { clearOpsAlert, sendOpsAlertOnce } from './onlyfansOpsAlerts';
import { syncDirectory } from './onlymonsterMappingService';
import { derivePayStage } from './onlymonsterPayService';
import {
  BudgetExceeded,
  backfillJobs,
  loadMappedAccounts,
  memberUids,
  payrollWindow,
  reconcileStage,
  rollupTouched,
  syncBalancesStage,
  runBackfillJob,
  syncMassMessagesStage,
  syncMetricsStage,
  syncSubscriptionsStage,
  syncTransactionsStage,
  type BackfillJob,
  type LedgerContext,
} from './onlymonsterLedgerService';
import type { OnlyMonsterConfigDocument, OnlyMonsterStateDocument } from '@/types/firestore';

const STATE_DOC = `${COLLECTIONS.meta}/state`;
const LOCK_DOC = `${COLLECTIONS.meta}/lock`;
const FAILING_ALERT_KEY = 'onlymonster-sync-failing';
const FAILURES_BEFORE_ALERT = 3;
const RUN_LOG_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// ─── Lease ───────────────────────────────────────────────────────────

async function acquireLock(holder: string): Promise<boolean> {
  const ref = adminDb.doc(LOCK_DOC);
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const expires = (snap.get('expiresAt') as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (snap.exists && expires > Date.now()) return false;
    tx.set(ref, { holder, expiresAt: Timestamp.fromMillis(Date.now() + SYNC_LEASE_MS) });
    return true;
  });
}

async function releaseLock(holder: string): Promise<void> {
  const ref = adminDb.doc(LOCK_DOC);
  await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.get('holder') === holder) tx.delete(ref);
  });
}

async function markStage(stage: OnlyMonsterStage, error: string | null): Promise<void> {
  const now = FieldValue.serverTimestamp();
  await adminDb
    .doc(STATE_DOC)
    .set({ stages: { [stage]: { lastAttemptAt: now, lastError: error, ...(error ? {} : { lastSuccessAt: now }) } } }, { merge: true });
}

// ─── Incident ────────────────────────────────────────────────────────

/** Track consecutive failed runs and fire / clear the alert. Never throws. */
async function updateIncident(failed: boolean, fatalReason: string | null): Promise<void> {
  try {
    const ref = adminDb.doc(STATE_DOC);
    const prev = Number((await ref.get()).get('runFailures') ?? 0);
    const failures = failed ? prev + 1 : 0;
    await ref.set({ runFailures: failures, lastRunAt: FieldValue.serverTimestamp(), lastRunOk: !failed }, { merge: true });
    if (!failed) {
      await clearOpsAlert(FAILING_ALERT_KEY);
      return;
    }
    if (fatalReason) {
      await sendOpsAlertOnce(FAILING_ALERT_KEY, notifications.onlymonsterSyncFailing(fatalReason));
    } else if (failures >= FAILURES_BEFORE_ALERT) {
      await sendOpsAlertOnce(
        FAILING_ALERT_KEY,
        notifications.onlymonsterSyncFailing(`The OnlyMonster sync has failed ${failures} runs in a row.`),
      );
    }
  } catch (err) {
    console.error('[onlymonster] incident tracking failed', err);
  }
}

// ─── Run ─────────────────────────────────────────────────────────────

export interface OnlyMonsterRunResult {
  runId: string;
  ran: OnlyMonsterStage[];
  failed: OnlyMonsterStage[];
  counts: Record<string, number>;
  errors: string[];
  warnings: string[];
  requestCount: number;
  durationMs: number;
  partial: boolean;
}

export type OnlyMonsterRunOutcome =
  | { status: 'ran'; result: OnlyMonsterRunResult }
  | { status: 'skipped'; reason: 'running' | 'not-configured' | 'idle' };

const BACKFILL_DOC = `${COLLECTIONS.meta}/backfill`;

async function runStage(stage: OnlyMonsterStage, ctx: LedgerContext): Promise<void> {
  switch (stage) {
    case 'directory': {
      const directory = await syncDirectory();
      for (const [k, v] of Object.entries(directory.counts)) ctx.counts[`directory.${k}`] = v;
      ctx.warnings.push(...directory.warnings);
      // The rest of the run works on what the directory just mapped.
      ctx.accounts = await loadMappedAccounts();
      return;
    }
    case 'transactions':
      return syncTransactionsStage(ctx);
    case 'subscriptions':
      return syncSubscriptionsStage(ctx);
    case 'massMessages':
      return syncMassMessagesStage(ctx);
    case 'metrics':
      return syncMetricsStage(ctx);
    case 'rollups':
      return rollupTouched(ctx);
    case 'derive':
      return derivePayStage(ctx);
    case 'reconcile':
      return reconcileStage(ctx);
    case 'balances':
      return syncBalancesStage(ctx);
    default: {
      // Exhaustiveness: a stage added to ONLYMONSTER_STAGES without a branch here
      // is a compile error, not a stage that silently does nothing.
      const never: never = stage;
      throw new Error(`No runner for stage ${String(never)}`);
    }
  }
}

/**
 * The stages a run executes. The 21:01 UTC run also reconciles (D5). A
 * continuation runs only what an interrupted run left pending.
 */
function stagesFor(trigger: string, now: number, pending: OnlyMonsterStage[]): OnlyMonsterStage[] {
  if (trigger === 'continue') return pending;
  // Reconciliation and payout balances run once a day, with the 21:01 run (D5, plan §12).
  const daily = new Date(now).getUTCHours() === RECONCILE_HOUR_UTC;
  return ONLYMONSTER_STAGES.filter(s => (s !== 'reconcile' && s !== 'balances') || daily);
}

/**
 * One run. `trigger: 'cron'` is a scheduled run (all stages). `trigger:
 * 'continue'` is the every-ten-minutes continuation (D21): it resumes stages an
 * interrupted run left pending, then advances the backfill, and when there is
 * nothing to do it costs **one document read** and returns `idle`.
 */
export async function runOnlyMonsterSync(params: { trigger: 'cron' | 'continue' | string }): Promise<OnlyMonsterRunOutcome> {
  if (!isOnlyMonsterConfigured()) return { status: 'skipped', reason: 'not-configured' };

  const isContinue = params.trigger === 'continue';
  let pending: OnlyMonsterStage[] = [];
  let pendingTouched: Record<string, string[]> = {};
  let storedWindowStart: number | null = null;
  let backfill: { jobs?: BackfillJob[]; next?: number; done?: boolean; failures?: Record<string, number>; skipped?: number[] } = {};
  if (isContinue) {
    const [stateSnap, backfillSnap] = await adminDb.getAll(adminDb.doc(STATE_DOC), adminDb.doc(BACKFILL_DOC));
    pending = ((stateSnap.get('pendingStages') as string[] | undefined) ?? []).filter((s): s is OnlyMonsterStage =>
      (ONLYMONSTER_STAGES as readonly string[]).includes(s),
    );
    pendingTouched = (stateSnap.get('pendingTouched') as Record<string, string[]> | undefined) ?? {};
    storedWindowStart = (stateSnap.get('windowStart') as number | undefined) ?? null;
    backfill = backfillSnap.data() ?? {};
    // The backfill starts after the first successful scheduled run has mapped accounts.
    const backfillOpen = !backfill.done && stateSnap.get('stages.directory.lastSuccessAt');
    if (pending.length === 0 && !backfillOpen) return { status: 'skipped', reason: 'idle' };
  }

  const runRef = adminDb.collection(COLLECTIONS.runs).doc();
  if (!(await acquireLock(runRef.id))) return { status: 'skipped', reason: 'running' };

  const startedAt = Date.now();
  resetRequestCount();
  const ctx: LedgerContext & { runId: string } = {
    runId: runRef.id,
    now: startedAt,
    deadline: startedAt + SYNC_TIME_BUDGET_MS,
    window: { start: startedAt, end: startedAt },
    accounts: [],
    // An interrupted run's touched days survive to its continuation, or their rollups would
    // be lost: later runs find those buckets unchanged and never touch them again.
    touched: new Map(Object.entries(pendingTouched).map(([k, v]) => [k, new Set(v)])),
    counts: {},
    warnings: [],
  };
  const stages = stagesFor(params.trigger, startedAt, pending);
  const ran: OnlyMonsterStage[] = [];
  const failed: OnlyMonsterStage[] = [];
  const errors: string[] = [];
  let leftPending: OnlyMonsterStage[] = [];
  let fatalReason: string | null = null;
  let partial = false;

  try {
    // The payroll window costs a salary build for every agent still pending; a continuation
    // tick reuses the one its scheduled run resolved.
    ctx.window = isContinue && storedWindowStart !== null ? { start: storedWindowStart, end: startedAt } : await payrollWindow(startedAt);
    if (!isContinue) await adminDb.doc(STATE_DOC).set({ windowStart: ctx.window.start }, { merge: true });
    if (!stages.includes('directory')) ctx.accounts = await loadMappedAccounts();

    for (const [i, stage] of stages.entries()) {
      if (fatalReason) break;
      try {
        await runStage(stage, ctx);
        ran.push(stage);
        await markStage(stage, null);
      } catch (err) {
        if (err instanceof BudgetExceeded) {
          // Left for the continuation cron; rollups always follow so nothing touched is lost.
          partial = true;
          const rest = stages.slice(i);
          leftPending = rest.includes('rollups') ? rest : [...rest, 'rollups'];
          break;
        }
        failed.push(stage);
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${stage}: ${message}`);
        console.error(`[onlymonster] ${stage} failed`, err);
        await markStage(stage, message.slice(0, 300));
        if (isOnlyMonsterError(err) && err.isFatal) fatalReason = err.alertReason;
        if (stage === 'directory') ctx.accounts = await loadMappedAccounts();
      }
    }

    // ── Backfill job list: a scheduled run appends jobs for accounts mapped since it was built ──
    if (!isContinue && ran.includes('directory')) {
      const snap = await adminDb.doc(BACKFILL_DOC).get();
      if (snap.exists) {
        const jobs = (snap.get('jobs') ?? []) as BackfillJob[];
        const known = new Set(jobs.flatMap(j => ('accountId' in j ? [j.accountId] : [])));
        const added = backfillJobs(ctx.accounts.filter(a => !known.has(a.accountId)), ctx.window.start).filter(j => j.kind !== 'metrics');
        if (added.length) {
          await adminDb.doc(BACKFILL_DOC).set({ jobs: [...jobs, ...added], total: jobs.length + added.length, done: false }, { merge: true });
          ctx.counts['backfill.appended'] = added.length;
        }
      }
    }

    // ── Backfill: continuation ticks only. Progress is saved after EVERY job, and no job
    // starts in the last minute of the budget, so a tick can never be killed before saving. ──
    if (isContinue && !partial && !fatalReason && !backfill.done) {
      const memberUid = await memberUids(ctx);
      const jobs = backfill.jobs ?? backfillJobs(ctx.accounts, ctx.window.start);
      // The job list is written once; each job then saves only its progress.
      if (!backfill.jobs) await adminDb.doc(BACKFILL_DOC).set({ jobs, total: jobs.length }, { merge: true });
      const failures = { ...(backfill.failures ?? {}) };
      const skipped = [...(backfill.skipped ?? [])];
      let next = backfill.next ?? 0;
      const save = () =>
        adminDb.doc(BACKFILL_DOC).set({ next, done: next >= jobs.length, failures, skipped, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      while (next < jobs.length && Date.now() < ctx.deadline - 60_000 && !fatalReason) {
        try {
          await runBackfillJob(ctx, jobs[next], memberUid);
          if (ctx.touched.size) await rollupTouched({ ...ctx, deadline: Number.POSITIVE_INFINITY });
          next += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (isOnlyMonsterError(err) && err.isFatal) {
            fatalReason = err.alertReason;
            errors.push(`backfill job ${next}: ${message}`);
            break;
          }
          // A failing job is retried on the next tick, and skipped (and listed) after three tries,
          // so one bad month never blocks the rest of the history or pages anyone.
          failures[next] = (failures[next] ?? 0) + 1;
          ctx.warnings.push(`backfill job ${next} (attempt ${failures[next]}): ${message}`);
          if (failures[next] >= 3) {
            skipped.push(next);
            next += 1;
          } else {
            await save();
            break;
          }
        }
        await save();
      }
      ctx.counts['backfill.next'] = next;
      ctx.counts['backfill.total'] = jobs.length;
      if (skipped.length) ctx.counts['backfill.skipped'] = skipped.length;
    }
  } finally {
    // `mergeFields` replaces both fields whole, so a stale day never lingers in the map.
    const touchedOut = leftPending.length ? Object.fromEntries([...ctx.touched].map(([k, v]) => [k, [...v].sort()])) : {};
    await adminDb
      .doc(STATE_DOC)
      .set({ pendingStages: leftPending, pendingTouched: touchedOut }, { mergeFields: ['pendingStages', 'pendingTouched'] })
      .catch(err => console.error('[onlymonster] pending write failed', err));
    await runRef
      .set({
        trigger: params.trigger,
        stages,
        startedAt: Timestamp.fromMillis(startedAt),
        durationMs: Date.now() - startedAt,
        requestCount: requestCount(),
        counts: ctx.counts,
        errors,
        warnings: ctx.warnings,
        partial,
        expireAt: Timestamp.fromMillis(startedAt + RUN_LOG_TTL_MS),
      })
      .catch(err => console.error('[onlymonster] run log write failed', err));
    await releaseLock(runRef.id).catch(err => console.error('[onlymonster] lock release failed', err));
  }

  await updateIncident(failed.length > 0 || errors.length > 0, fatalReason);

  return {
    status: 'ran',
    result: {
      runId: runRef.id,
      ran,
      failed,
      counts: ctx.counts,
      errors,
      warnings: ctx.warnings,
      requestCount: requestCount(),
      durationMs: Date.now() - startedAt,
      partial,
    },
  };
}

// ─── Read side ───────────────────────────────────────────────────────

export interface OnlyMonsterStatus {
  configured: boolean;
  /** The oldest `lastSuccessAt` across stages: the age of the least fresh data. */
  updatedAt: string | null;
  nextRunAt: string;
  lastRunOk: boolean | null;
  stages: Record<string, { lastSuccessAt: string | null; lastAttemptAt: string | null; lastError: string | null }>;
}

/** One document read. Safe for any page header to call. */
export async function getOnlyMonsterStatus(): Promise<OnlyMonsterStatus> {
  const snap = await adminDb.doc(STATE_DOC).get();
  const state = (snap.data() ?? {}) as OnlyMonsterStateDocument;
  const stages: OnlyMonsterStatus['stages'] = {};
  let oldest: number | null = null;
  for (const stage of ONLYMONSTER_STAGES) {
    const s = state.stages?.[stage];
    stages[stage] = {
      lastSuccessAt: serializeTimestamp(s?.lastSuccessAt),
      lastAttemptAt: serializeTimestamp(s?.lastAttemptAt),
      lastError: s?.lastError ?? null,
    };
    const ms = s?.lastSuccessAt?.toMillis?.() ?? null;
    oldest = ms === null ? oldest : oldest === null ? ms : Math.min(oldest, ms);
  }
  return {
    configured: isOnlyMonsterConfigured(),
    updatedAt: oldest === null ? null : new Date(oldest).toISOString(),
    nextRunAt: new Date(nextScheduledRun(Date.now())).toISOString(),
    lastRunOk: typeof state.lastRunOk === 'boolean' ? state.lastRunOk : null,
    stages,
  };
}

/** The last N runs, for CA Admin → Sales → OnlyMonster. */
export async function getRecentOnlyMonsterRuns(limit = 10) {
  const snap = await adminDb.collection(COLLECTIONS.runs).orderBy('startedAt', 'desc').limit(limit).get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      runId: d.id,
      trigger: String(data.trigger ?? ''),
      startedAt: serializeTimestamp(data.startedAt),
      durationMs: Number(data.durationMs ?? 0),
      requestCount: Number(data.requestCount ?? 0),
      counts: (data.counts ?? {}) as Record<string, number>,
      errors: (data.errors ?? []) as string[],
      warnings: (data.warnings ?? []) as string[],
      partial: data.partial === true,
    };
  });
}

// ─── Config (rule 9c: server-read switches) ──────────────────────────

const CONFIG_DOC = `${COLLECTIONS.meta}/config`;
let configCache: { at: number; value: Required<Pick<OnlyMonsterConfigDocument, 'salesWriteEnabled'>> } | null = null;

/** Cached 30 s per instance: page reads ask on every request, and it changes a handful of times ever. */
export async function getOnlyMonsterConfig(): Promise<{ salesWriteEnabled: boolean }> {
  if (configCache && Date.now() - configCache.at < 30_000) return configCache.value;
  const snap = await adminDb.doc(CONFIG_DOC).get();
  const value = {
    salesWriteEnabled: snap.get('salesWriteEnabled') === true,
  };
  configCache = { at: Date.now(), value };
  return value;
}

export async function setOnlyMonsterConfig(patch: { salesWriteEnabled: boolean }, actorUid: string): Promise<void> {
  await adminDb.doc(CONFIG_DOC).set({ ...patch, updatedBy: actorUid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  configCache = null;
}

/** Backfill progress and the latest reconciliation, for CA Admin → Sales → OnlyMonster. */
export async function getMigrationOverview() {
  const [backfillSnap, reconSnap] = await Promise.all([
    adminDb.doc(BACKFILL_DOC).get(),
    adminDb.collection(COLLECTIONS.reconciliation).orderBy('checkedAt', 'desc').limit(60).get(),
  ]);
  return {
    backfill: backfillSnap.exists
      ? { next: Number(backfillSnap.get('next') ?? 0), total: Number(backfillSnap.get('total') ?? 0), done: backfillSnap.get('done') === true }
      : null,
    reconciliation: reconSnap.docs.map(d => ({
      creatorId: String(d.get('creatorId')),
      month: String(d.get('month')),
      om: d.get('om') as { gross: number; net: number },
      ledger: d.get('ledger') as { gross: number; net: number },
      diff: d.get('diff') as { gross: number; net: number },
      checkedAt: serializeTimestamp(d.get('checkedAt')),
    })),
  };
}
