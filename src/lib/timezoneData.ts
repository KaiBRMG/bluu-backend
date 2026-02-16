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

/**
 * Country name → default IANA timezone mapping.
 * Covers all countries in countryData.ts. For multi-timezone countries,
 * uses the most common / capital timezone.
 */
const COUNTRY_TIMEZONE_MAP: Record<string, string> = {
  'Afghanistan': 'Asia/Kabul',
  'Albania': 'Europe/Tirane',
  'Algeria': 'Africa/Algiers',
  'Argentina': 'America/Argentina/Buenos_Aires',
  'Australia': 'Australia/Sydney',
  'Austria': 'Europe/Vienna',
  'Bangladesh': 'Asia/Dhaka',
  'Belgium': 'Europe/Brussels',
  'Brazil': 'America/Sao_Paulo',
  'Bulgaria': 'Europe/Sofia',
  'Canada': 'America/Toronto',
  'Chile': 'America/Santiago',
  'China': 'Asia/Shanghai',
  'Colombia': 'America/Bogota',
  'Croatia': 'Europe/Zagreb',
  'Czech Republic': 'Europe/Prague',
  'Denmark': 'Europe/Copenhagen',
  'Egypt': 'Africa/Cairo',
  'Finland': 'Europe/Helsinki',
  'France': 'Europe/Paris',
  'Germany': 'Europe/Berlin',
  'Greece': 'Europe/Athens',
  'Hong Kong': 'Asia/Hong_Kong',
  'Hungary': 'Europe/Budapest',
  'India': 'Asia/Kolkata',
  'Indonesia': 'Asia/Jakarta',
  'Ireland': 'Europe/Dublin',
  'Israel': 'Asia/Jerusalem',
  'Italy': 'Europe/Rome',
  'Japan': 'Asia/Tokyo',
  'Kenya': 'Africa/Nairobi',
  'South Korea': 'Asia/Seoul',
  'Kuwait': 'Asia/Kuwait',
  'Sri Lanka': 'Asia/Colombo',
  'Malaysia': 'Asia/Kuala_Lumpur',
  'Maldives': 'Indian/Maldives',
  'Mexico': 'America/Mexico_City',
  'Netherlands': 'Europe/Amsterdam',
  'New Zealand': 'Pacific/Auckland',
  'Nigeria': 'Africa/Lagos',
  'Norway': 'Europe/Oslo',
  'Pakistan': 'Asia/Karachi',
  'Philippines': 'Asia/Manila',
  'Poland': 'Europe/Warsaw',
  'Portugal': 'Europe/Lisbon',
  'Qatar': 'Asia/Qatar',
  'Romania': 'Europe/Bucharest',
  'Russia': 'Europe/Moscow',
  'Saudi Arabia': 'Asia/Riyadh',
  'Singapore': 'Asia/Singapore',
  'South Africa': 'Africa/Johannesburg',
  'Spain': 'Europe/Madrid',
  'Sweden': 'Europe/Stockholm',
  'Switzerland': 'Europe/Zurich',
  'Taiwan': 'Asia/Taipei',
  'Thailand': 'Asia/Bangkok',
  'Turkey': 'Europe/Istanbul',
  'Ukraine': 'Europe/Kyiv',
  'United Arab Emirates': 'Asia/Dubai',
  'United Kingdom': 'Europe/London',
  'United States': 'America/New_York',
  'Vietnam': 'Asia/Ho_Chi_Minh',
};

// Common aliases for country names
const COUNTRY_ALIASES: Record<string, string> = {
  'US': 'United States',
  'USA': 'United States',
  'UK': 'United Kingdom',
  'UAE': 'United Arab Emirates',
  'Czechia': 'Czech Republic',
  'Korea': 'South Korea',
};

/**
 * Resolves timezone from an address object (city + country).
 * Returns null if country is empty or not found in the map.
 */
export function resolveTimezoneFromAddress(
  address: { city?: string; country?: string }
): { timezone: string; timezoneOffset: string } | null {
  const country = address.country?.trim();
  if (!country) return null;

  // Try direct lookup (case-insensitive)
  const normalized = Object.keys(COUNTRY_TIMEZONE_MAP).find(
    k => k.toLowerCase() === country.toLowerCase()
  );

  // Try aliases
  const aliasKey = Object.keys(COUNTRY_ALIASES).find(
    k => k.toLowerCase() === country.toLowerCase()
  );
  const resolvedName = normalized || (aliasKey ? COUNTRY_ALIASES[aliasKey] : null);

  if (!resolvedName) return null;

  const timezone = COUNTRY_TIMEZONE_MAP[resolvedName];
  if (!timezone) return null;

  return {
    timezone,
    timezoneOffset: getOffsetForTimezone(timezone),
  };
}
