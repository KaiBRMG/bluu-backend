/**
 * Growth Tracking — X post identity.
 *
 * Turns a pasted post URL into the tweet id that identifies it. That id is the
 * Firestore document id, the value sent to the scraper as `tweetIDs`, and the
 * key every snapshot hangs off — so a change here changes the identity of every
 * tracked post, exactly as `parseProfileUrl` does for accounts.
 *
 * DELIBERATELY INDEPENDENT of `src/lib/smm/linkUtils.ts`, whose
 * `normalizePostLink` answers the same question for the SMM bonus engine. RULE 0
 * of documentation/growth-tracking.md forbids a relationship between the two
 * subsystems, and a shared normalizer is precisely such a relationship: the SMM
 * one would then be unable to change without silently re-identifying every
 * tracked post here. The duplication is the point.
 */

/** Hosts an X post link can legitimately arrive on. */
const POST_HOSTS = new Set([
  'x.com',
  'twitter.com',
  'mobile.twitter.com',
  'mobile.x.com',
  'm.twitter.com',
]);

/**
 * A tweet id is a numeric snowflake — 19 digits today, 18 historically. The
 * range is deliberately loose at both ends: too tight and a legitimate older or
 * future id is rejected, and the scraper is the real validator anyway (an id
 * that does not resolve writes nothing, see the add route).
 */
const TWEET_ID_PATTERN = /^\d{8,25}$/;

export interface ParsedPostLink {
  /** The tweet id — the document id and the value sent as `tweetIDs`. */
  tweetId: string;
  /**
   * The author handle when the URL carried one. `x.com/i/status/123` does not,
   * and neither does a bare id, so this is a hint for the optimistic UI only —
   * the authoritative handle is whatever the scraper returns.
   */
  handleHint: string | null;
  /** Canonical link, stored and rendered regardless of what was pasted. */
  canonicalUrl: string;
}

/**
 * Parse an X post URL, or a bare tweet id.
 *
 * Returns `null` for anything unusable. The caller turns that into a 400 and
 * writes nothing — a typo that became a tracked document would bill on every
 * refresh cycle forever while showing an empty chart, which is the same failure
 * the account-add route was built to prevent.
 *
 * Folds every variant that turns up in practice: `http` vs `https`, `www.`,
 * `twitter.com` vs `x.com`, the `/photo/1` and `/video/1` suffixes the mobile
 * apps append, and the `?s=20&t=…` share parameters.
 */
export function parsePostLink(input: string): ParsedPostLink | null {
  const raw = input.trim();
  if (!raw) return null;

  // A bare id, which is what someone pasting from the scraper's own output has.
  if (TWEET_ID_PATTERN.test(raw)) return built(raw, null);

  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!POST_HOSTS.has(host)) return null;

  // `/{handle}/status/{id}` — and `/i/status/{id}`, where `i` is X's own
  // placeholder rather than a handle, so it is read as "no handle" instead of
  // being stored as one.
  const segments = url.pathname.split('/').filter(Boolean);
  const statusIndex = segments.findIndex((s) => s === 'status' || s === 'statuses');
  if (statusIndex === -1) return null;

  const tweetId = segments[statusIndex + 1];
  if (!tweetId || !TWEET_ID_PATTERN.test(tweetId)) return null;

  const handleSegment = statusIndex > 0 ? segments[statusIndex - 1] : null;
  const handleHint = handleSegment && handleSegment.toLowerCase() !== 'i'
    ? handleSegment.replace(/^@/, '')
    : null;

  return built(tweetId, handleHint && /^[A-Za-z0-9_]{1,15}$/.test(handleHint) ? handleHint : null);
}

function built(tweetId: string, handleHint: string | null): ParsedPostLink {
  return { tweetId, handleHint, canonicalUrl: postUrlFor(tweetId, handleHint) };
}

/**
 * Canonical link for a post. `i` is X's own handle-less form and redirects to
 * the real one, so a post whose author we do not yet know still links correctly.
 */
export function postUrlFor(tweetId: string, handle: string | null): string {
  return `https://x.com/${handle ?? 'i'}/status/${tweetId}`;
}
