/**
 * Growth Tracking — platform identity.
 *
 * The single source of truth for turning a pasted profile URL into the values
 * that identify a tracked account. Everything downstream (the document id, the
 * duplicate check, the Apify payload, the CSV importer) derives from here, so a
 * change to this file changes the identity of every account.
 *
 * DELIBERATELY INDEPENDENT of `src/lib/smm/linkUtils.ts` and of the
 * `twitterx-accounts` collection. Growth Tracking must have no relationship to
 * the SMM bonus data (see GROWTH_TRACKING.md); sharing the normalizer would be
 * exactly such a relationship, and the two answer different questions anyway —
 * `normalizePostLink` identifies a *tweet*, this identifies an *account*.
 */

export const GROWTH_PLATFORMS = ['facebook', 'twitter'] as const;
export type GrowthPlatform = (typeof GROWTH_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<GrowthPlatform, string> = {
  facebook: 'Facebook',
  twitter: 'X',
};

/**
 * Path segments that are never an account handle. A URL like
 * `facebook.com/profile.php?id=…` or `x.com/i/status/…` has no usable handle,
 * so it is rejected rather than silently tracked under a nonsense id.
 */
const RESERVED_SEGMENTS = new Set([
  'i', 'home', 'search', 'explore', 'settings', 'notifications', 'messages',
  'profile.php', 'pages', 'groups', 'events', 'watch', 'marketplace', 'people',
  'sharer', 'login', 'signup', 'privacy', 'help', 'about',
]);

/** Facebook handles allow a dot; X handles do not. Both are ASCII-only. */
const HANDLE_PATTERN: Record<GrowthPlatform, RegExp> = {
  facebook: /^[A-Za-z0-9.]{3,60}$/,
  twitter: /^[A-Za-z0-9_]{1,15}$/,
};

const HOSTS: Record<GrowthPlatform, readonly string[]> = {
  facebook: ['facebook.com', 'fb.com', 'm.facebook.com', 'web.facebook.com'],
  twitter: ['x.com', 'twitter.com', 'mobile.twitter.com'],
};

export interface ParsedProfile {
  handle: string;
  /** Lower-cased handle — the identity. Two URLs sharing this are one account. */
  handleNormalized: string;
  /** The canonical form we store and link to, regardless of what was pasted. */
  canonicalUrl: string;
}

/**
 * Parse a profile URL (or a bare handle) for `platform`.
 *
 * Returns `null` for anything unusable — an unknown host, a reserved path, a
 * handle that cannot exist on that platform. The caller turns that into a 400;
 * nothing is ever written from an unparsed URL, because a typo would otherwise
 * become a permanently-failing nightly line item that still costs money.
 *
 * Folds every variant in the seed list: `http` vs `https`, `www.`, a trailing
 * slash, `twitter.com` vs `x.com`, a leading `@`.
 */
export function parseProfileUrl(platform: GrowthPlatform, input: string): ParsedProfile | null {
  const raw = input.trim();
  if (!raw) return null;

  let handle: string;

  // A bare handle ("@TwinkLoad" or "TwinkLoad") is accepted — it is what the
  // sheet records and what people paste half the time.
  if (!raw.includes('/') && !raw.includes('.')) {
    handle = raw.replace(/^@/, '');
  } else {
    let url: URL;
    try {
      url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!HOSTS[platform].includes(host)) return null;

    const segment = url.pathname.split('/').filter(Boolean)[0];
    if (!segment) return null;
    handle = decodeURIComponent(segment).replace(/^@/, '');
  }

  if (RESERVED_SEGMENTS.has(handle.toLowerCase())) return null;
  if (!HANDLE_PATTERN[platform].test(handle)) return null;

  return {
    handle,
    handleNormalized: handle.toLowerCase(),
    canonicalUrl: platform === 'facebook'
      ? `https://www.facebook.com/${handle}`
      : `https://x.com/${handle}`,
  };
}

/**
 * The Firestore document id. Deterministic, so the duplicate check is a single
 * `get()` rather than a query, and so the CSV importer is idempotent for free.
 */
export function growthAccountId(platform: GrowthPlatform, handleNormalized: string): string {
  return `${platform}_${handleNormalized}`;
}

/** Profile URL for display/linking — always the canonical form. */
export function profileUrlFor(platform: GrowthPlatform, handle: string): string {
  return platform === 'facebook'
    ? `https://www.facebook.com/${handle}`
    : `https://x.com/${handle}`;
}

/** `YYYY-MM-DD` in UTC — the key format for a day in a series document. */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The series document a day key belongs to (one document per account per year). */
export function seriesDocIdFor(dayKey: string): string {
  return dayKey.slice(0, 4);
}
