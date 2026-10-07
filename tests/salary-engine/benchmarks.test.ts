/**
 * The anonymous team benchmark — no benchmark below three active agents, and
 * reply time is the one metric where lower is better.
 */
import { computeBenchmarks, percentile } from '@/lib/buddyx/benchmarks';
import type { ChatterMetrics } from '@/lib/buddyx/analyticsTypes';

function m(over: Partial<ChatterMetrics> = {}): ChatterMetrics {
  return {
    ppvGross: 100, tipsGross: 0, tipsCount: 0, ppvsSent: 10, ppvsUnlocked: 5, unlockRate: 50, ppvRate: 0.1,
    fansChatted: 10, totalMessages: 100, onlineMs: 3_600_000, medianResponseTimeMs: 60_000, p75ResponseTimeMs: 90_000,
    revenuePerOnlineHour: 100, ...over,
  };
}

describe('percentile', () => {
  it('interpolates', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('computeBenchmarks', () => {
  it('withholds the benchmark below three active agents', () => {
    const team = [
      { uid: 'me', metrics: m() },
      { uid: 'b', metrics: m() },
      { uid: 'c', metrics: m({ onlineMs: 0 }) },
    ];
    expect(computeBenchmarks(m(), team, 'me')).toBeNull();
  });

  it('counts whom I beat, direction-aware', () => {
    const me = m({ ppvGross: 300, medianResponseTimeMs: 30_000 });
    const team = [
      { uid: 'me', metrics: me },
      { uid: 'b', metrics: m({ ppvGross: 100, medianResponseTimeMs: 60_000 }) },
      { uid: 'c', metrics: m({ ppvGross: 200, medianResponseTimeMs: 20_000 }) },
      { uid: 'd', metrics: m({ ppvGross: 400, medianResponseTimeMs: 90_000 }) },
    ];
    const out = computeBenchmarks(me, team, 'me')!;
    const ppv = out.find(b => b.key === 'ppvGross')!;
    expect(ppv).toMatchObject({ beats: 2, of: 3, median: 250, lowerIsBetter: false });
    const reply = out.find(b => b.key === 'medianResponseTimeMs')!;
    expect(reply).toMatchObject({ beats: 2, of: 3, lowerIsBetter: true });
  });
});
