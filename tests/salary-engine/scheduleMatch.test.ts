/**
 * The "off schedule" anomaly on CA Admin → Sales: a sale held by someone the
 * shift schedule does not put on that creator account at that moment.
 */
import { matchSalesToSchedule, SCHEDULE_GRACE_MS } from '@/lib/salary/scheduleMatch';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 10, 8);
const iso = (ms: number) => new Date(ms).toISOString();

const shifts = [
  { userId: 'a', creatorIds: ['cole'], occurrenceStart: T0, occurrenceEnd: T0 + 8 * H },
  { userId: 'b', creatorIds: ['cole', 'cole-fansly'], occurrenceStart: T0 + 8 * H, occurrenceEnd: T0 + 16 * H },
];

const sale = (saleId: string, userId: string | null, at: number, creatorId: string | null = 'cole') => ({
  saleId,
  userId,
  creatorId,
  occurredAt: iso(at),
  removedAt: null,
});

describe('matchSalesToSchedule', () => {
  it('passes a sale held by the scheduled agent', () => {
    const out = matchSalesToSchedule([sale('s1', 'a', T0 + H)], shifts);
    expect(out.get('s1')).toEqual({ scheduled: ['a'], offSchedule: false });
  });

  it('flags a sale held by someone else while the account is scheduled to another agent', () => {
    const out = matchSalesToSchedule([sale('s1', 'a', T0 + 10 * H)], shifts);
    expect(out.get('s1')).toEqual({ scheduled: ['b'], offSchedule: true });
  });

  it('flags an unassigned sale on a scheduled account, naming who was on it', () => {
    expect(matchSalesToSchedule([sale('s1', null, T0 + H)], shifts).get('s1')).toEqual({ scheduled: ['a'], offSchedule: true });
  });

  it('allows the holder a grace either side of their own shift — handovers are not anomalies', () => {
    const justAfter = T0 + 8 * H + SCHEDULE_GRACE_MS - 60_000;
    expect(matchSalesToSchedule([sale('s1', 'a', justAfter)], shifts).get('s1')?.offSchedule).toBe(false);
    const wellAfter = T0 + 8 * H + SCHEDULE_GRACE_MS + 60_000;
    expect(matchSalesToSchedule([sale('s1', 'a', wellAfter)], shifts).get('s1')?.offSchedule).toBe(true);
  });

  it('treats a sub-account as its own assignable account (rule 9h)', () => {
    const out = matchSalesToSchedule([sale('s1', 'a', T0 + 9 * H, 'cole-fansly')], shifts);
    expect(out.get('s1')).toEqual({ scheduled: ['b'], offSchedule: true });
  });

  it('leaves out a sale nobody was scheduled on, a sale with no creator, and a removed row', () => {
    const out = matchSalesToSchedule(
      [
        sale('nobody', 'a', T0 + 20 * H),
        sale('no-creator', 'a', T0 + H, null),
        { ...sale('removed', 'z', T0 + H), removedAt: iso(T0) },
      ],
      shifts,
    );
    expect(out.size).toBe(0);
  });

  it('lists every agent scheduled on the account at once', () => {
    const both = [...shifts, { userId: 'c', creatorIds: ['cole'], occurrenceStart: T0, occurrenceEnd: T0 + 2 * H }];
    expect(matchSalesToSchedule([sale('s1', 'c', T0 + H)], both).get('s1')).toEqual({ scheduled: ['a', 'c'], offSchedule: false });
  });
});
