/**
 * Timezone resolution.
 *
 * ## The regression this exists for
 *
 * `ensureUserExists` seeds `timezone: ''`, and only the onboarding profile step
 * fills it in — so **an empty string is a normal state**, not corruption. `??`
 * does not catch it (`''` is not nullish) and neither does a bare pass-through,
 * and `Intl.DateTimeFormat` rejects it with
 * `RangeError: Invalid time zone specified:` rather than ignoring it.
 *
 * That took down the CA dashboard for a user who had never set one. The whole
 * class of bug is "a falsy-but-not-nullish timezone reaching Intl", so these
 * tests pin the guard rather than any one call site.
 */

import { safeTimezone } from '@/lib/utils/timezone';
import { formatSaleTime, formatSaleDateTime } from '@/lib/salary/salaryFormat';

describe('safeTimezone', () => {
  it('falls back to UTC for the value an un-onboarded user actually has', () => {
    expect(safeTimezone('')).toBe('UTC');
  });

  it('falls back for nullish values too', () => {
    expect(safeTimezone(null)).toBe('UTC');
    expect(safeTimezone(undefined)).toBe('UTC');
  });

  it('falls back for a zone Intl does not recognise', () => {
    expect(safeTimezone('Mars/Olympus_Mons')).toBe('UTC');
    expect(safeTimezone('GMT+2')).toBe('UTC');
    expect(safeTimezone('   ')).toBe('UTC');
  });

  it('passes a real IANA zone through untouched', () => {
    for (const tz of ['Africa/Harare', 'Asia/Manila', 'America/New_York', 'UTC', 'Europe/London']) {
      expect(safeTimezone(tz)).toBe(tz);
    }
  });

  it('never returns something Intl will reject', () => {
    const inputs = ['', '   ', null, undefined, 'nonsense', 'Africa/Harare', 'Etc/GMT+5'];
    for (const input of inputs) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: safeTimezone(input) })).not.toThrow();
    }
  });
});

describe('salary formatters with no timezone set', () => {
  const iso = '2026-08-31T21:52:34.000Z';

  // The exact crash: formatSaleTime(iso, '') from a user with no timezone.
  it('renders rather than throwing', () => {
    expect(() => formatSaleTime(iso, '')).not.toThrow();
    expect(() => formatSaleDateTime(iso, '')).not.toThrow();
  });

  it('shows UTC when there is nothing better', () => {
    expect(formatSaleTime(iso, '')).toBe(formatSaleTime(iso, 'UTC'));
    expect(formatSaleDateTime(iso, '')).toBe(formatSaleDateTime(iso, 'UTC'));
  });

  it('still honours a real timezone — the fallback must not swallow a good value', () => {
    // 21:52 UTC is 23:52 in Harare (+2) and 05:52 the next morning in Manila (+8).
    expect(formatSaleTime(iso, 'Africa/Harare')).toBe('11:52 PM');
    expect(formatSaleTime(iso, 'Asia/Manila')).toBe('5:52 AM');
    expect(formatSaleTime(iso, 'Africa/Harare')).not.toBe(formatSaleTime(iso, 'UTC'));
  });
});
