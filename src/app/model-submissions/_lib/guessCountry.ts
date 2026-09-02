import { countryCodes } from '@/lib/countryData';

/**
 * Best-effort home country for the applicant, from the browser alone.
 *
 * The cheap, dependency-free signal is the language tags the browser already
 * holds: `en-ZA` carries the region outright, and a bare `pt` maximises to
 * `pt-Latn-BR` through `Intl.Locale`, which is CLDR's likely-subtags data
 * shipped with every modern engine. No geo-IP call, no library, no request.
 *
 * It is a *guess*, and it is wrong for anyone whose phone locale doesn't match
 * their number — so it only ever pre-fills a control the applicant can see and
 * change, never a value hidden from them. Returns `''` when nothing matches,
 * which leaves the select on its placeholder rather than on a confidently wrong
 * country.
 *
 * Only countries present in `countryCodes` can be returned; that list is a
 * subset of the world, so a miss is normal and must stay harmless.
 */
export function guessCountryCode(): string {
  if (typeof navigator === 'undefined') return '';

  const tags = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  for (const tag of tags) {
    const region = regionOf(tag);
    if (region && countryCodes.some((c) => c.code === region)) return region;
  }
  return '';
}

/** `en-ZA` → `ZA`; `pt` → `BR`. Empty when the tag carries no usable region. */
function regionOf(tag: string): string {
  try {
    const locale = new Intl.Locale(tag);
    return (locale.region || locale.maximize().region || '').toUpperCase();
  } catch {
    // `Intl.Locale` throws on a malformed tag, and older Safari has no
    // `maximize()`. Fall back to a region subtag if the tag spells one out.
    const parts = tag.split('-');
    const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
    return region?.toUpperCase() ?? '';
  }
}
