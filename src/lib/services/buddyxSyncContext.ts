/**
 * The state one BuddyX sync run carries between its scopes. Its own module so
 * the orchestrator and the analytics scopes can share it without importing
 * each other.
 */
import type { BuddyxMaps } from './buddyxMappingService';

export interface SyncContext {
  runId: string;
  now: number;
  /** Wall-clock instant past which a scope stops starting new work. */
  deadline: number;
  dryRun: boolean;
  maps: BuddyxMaps;
  counts: Record<string, number>;
  errors: string[];
  /** Set by a scope that stopped early on the time budget; it resumes next run. */
  partial: boolean;
}

export function bump(ctx: SyncContext, key: string, by = 1): void {
  ctx.counts[key] = (ctx.counts[key] ?? 0) + by;
}

/** True once the run's time budget is spent — and marks the run partial. */
export function outOfTime(ctx: SyncContext): boolean {
  if (Date.now() < ctx.deadline) return false;
  ctx.partial = true;
  return true;
}
