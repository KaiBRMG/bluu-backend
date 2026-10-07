/**
 * The anonymous team benchmark on Chatter Analytics (D8). Pure.
 *
 * An agent sees where they sit against the team — the median, the top
 * quartile, and "faster than 3 of 4" — and never any colleague's figure or
 * name. Two rules keep it anonymous:
 *
 * - **Only agents who were online** (`onlineMs > 0`) are in the population; a
 *   chatter who never logged in is not a benchmark, just a zero.
 * - **At least three of them**, or there is no benchmark at all. With two, the
 *   "median" is the other person's number.
 */
import type { Benchmark, BenchmarkKey, ChatterMetrics } from './analyticsTypes';

export const MIN_BENCHMARK_POPULATION = 3;

const LOWER_IS_BETTER: Partial<Record<BenchmarkKey, true>> = { medianResponseTimeMs: true };

export const BENCHMARK_KEYS: BenchmarkKey[] = [
  'ppvGross',
  'tipsGross',
  'unlockRate',
  'medianResponseTimeMs',
  'fansChatted',
  'totalMessages',
  'onlineMs',
  'revenuePerOnlineHour',
];

/** Linear-interpolated percentile (0–100) of an ascending-sorted list. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Benchmarks for `me` against `team` (which includes `me`). `null` when fewer
 * than {@link MIN_BENCHMARK_POPULATION} agents were online, or when `me` was not.
 */
export function computeBenchmarks(
  me: ChatterMetrics | null,
  team: Array<{ uid: string; metrics: ChatterMetrics }>,
  meUid: string,
): Benchmark[] | null {
  const population = team.filter(t => t.metrics.onlineMs > 0);
  if (population.length < MIN_BENCHMARK_POPULATION || !me) return null;

  return BENCHMARK_KEYS.map(key => {
    const lowerIsBetter = LOWER_IS_BETTER[key] === true;
    const values = population
      .map(t => t.metrics[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    const value = typeof me[key] === 'number' ? (me[key] as number) : null;

    const others = population
      .filter(t => t.uid !== meUid)
      .map(t => t.metrics[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const beats =
      value === null ? 0 : others.filter(v => (lowerIsBetter ? value < v : value > v)).length;

    return {
      key,
      value,
      median: percentile(values, 50),
      topQuartile: percentile(values, lowerIsBetter ? 25 : 75),
      lowerIsBetter,
      beats,
      of: others.length,
    };
  });
}
