export interface TimezoneOption {
  value: string;    // "Africa/Johannesburg"
  label: string;    // "(UTC+02:00) Africa/Johannesburg"
  offset: string;   // "+02"
}

/**
 * Parses the GMT offset string from Intl (e.g. "GMT+2", "GMT-5:30", "GMT")
 * into a normalized short form (e.g. "+02", "-05:30", "+00").
 */
function parseGMTOffset(gmtString: string): string {
  // "GMT", "GMT+2", "GMT-5:30", "GMT+5:45"
  const match = gmtString.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/);
  if (!match) return '+00';

  const sign = match[1] || '+';
  const hours = match[2].padStart(2, '0');
  const minutes = match[3];

  if (minutes && minutes !== '00') {
    return `${sign}${hours}:${minutes}`;
  }
  return `${sign}${hours}`;
}

/**
 * Formats GMT offset string into a UTC label (e.g. "UTC+02:00").
 */
function formatOffsetLabel(gmtString: string): string {
  const match = gmtString.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 'UTC+00:00';

  const sign = match[1] || '+';
  const hours = match[2].padStart(2, '0');
  const minutes = match[3] || '00';

  return `UTC${sign}${hours}:${minutes}`;
}

/**
 * Converts offset string ("+02", "-05:30") to total minutes for sorting.
 */
function offsetToMinutes(offset: string): number {
  const match = offset.match(/([+-])(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3] || '0', 10);

  return sign * (hours * 60 + minutes);
}

/**
 * Returns a sorted list of all IANA timezones with labels and offsets.
 * Uses browser Intl API — no external dependencies.
 */
export function getTimezoneList(): TimezoneOption[] {
  const timezones = Intl.supportedValuesOf('timeZone');
  const now = new Date();

  return timezones.map(tz => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const gmtString = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';

    const offset = parseGMTOffset(gmtString);
    const offsetLabel = formatOffsetLabel(gmtString);
    const displayName = tz.replace(/_/g, ' ');

    return {
      value: tz,
      label: `(${offsetLabel}) ${displayName}`,
      offset,
    };
  }).sort((a, b) => {
    const diff = offsetToMinutes(a.offset) - offsetToMinutes(b.offset);
    if (diff !== 0) return diff;
    return a.value.localeCompare(b.value);
  });
}

/**
 * Returns the short offset string for a given IANA timezone (e.g. "+02").
 */
export function getOffsetForTimezone(tz: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  });
  const parts = formatter.formatToParts(new Date());
  const gmtString = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
  return parseGMTOffset(gmtString);
}
