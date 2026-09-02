import { countryCodes } from '@/lib/countryData';
import { TIMEZONE_COUNTRY } from './timezoneCountries';

/**
 * Best-effort home country for the applicant, from the browser alone.
 *
 * **Time zone first, language second.** The time zone is the only free signal
 * that tracks where the machine physically is: `Africa/Johannesburg` is South
 * Africa no matter what language the OS is set to. Language is a much weaker
 * proxy and was the earlier defect here — an applicant in Johannesburg running
 * an `en-GB` Windows install was offered `+44`, because the region subtag of a
 * *language* tag describes a locale, not a location.
 *
 * Language stays as the fallback for the case the table can't answer (an
 * unlisted zone, or a browser that reports none).
 *
 * It is a *guess* either way, and it only ever pre-fills a control the applicant
 * can see and change. `''` — leaving the placeholder — is the correct answer
 * whenever nothing matches; a confidently wrong country is worse than none.
 */
export function guessCountryCode(): string {
  const fromZone = supported(TIMEZONE_COUNTRY[timeZone()]);
  if (fromZone) return fromZone;

  if (typeof navigator === 'undefined') return '';
  for (const tag of [...(navigator.languages ?? []), navigator.language].filter(Boolean)) {
    const region = supported(regionOf(tag));
    if (region) return region;
  }
  return '';
}

/** Only a country we can actually offer a dial code for counts as a match. */
function supported(code: string | undefined): string {
  if (!code) return '';
  return countryCodes.some((c) => c.code === code) ? code : '';
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/** `en-ZA` → `ZA`; `pt` → `BR` (CLDR likely-subtags, shipped with the engine). */
function regionOf(tag: string): string {
  try {
    const locale = new Intl.Locale(tag);
    return (locale.region || locale.maximize().region || '').toUpperCase();
  } catch {
    // `Intl.Locale` throws on a malformed tag, and older Safari has no
    // `maximize()`. Fall back to a region subtag if the tag spells one out.
    const region = tag.split('-').slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
    return region?.toUpperCase() ?? '';
  }
}
