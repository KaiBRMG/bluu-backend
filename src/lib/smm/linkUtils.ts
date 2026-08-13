/**
 * Pure link helpers shared by client and server — no Firebase imports.
 */

/**
 * The account handle inside a Twitter/X profile link — the first path segment
 * of an x.com/twitter.com URL. Used by the viral-page suggestion flow, which
 * stores the handle as `accountName` so it can be matched against
 * `twitterx-accounts`. Returns '' when the link isn't a recognisable profile.
 *
 * https://x.com/example, https://twitter.com/example/media → 'example'
 */
export function extractAccountHandle(url: string): string {
  const link = url.trim();
  if (!link) return '';
  const match = link.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)/i);
  const handle = match?.[1] ?? '';
  // Reserved path prefixes that are never a profile.
  if (!handle || /^(i|home|search|explore|notifications|messages|settings)$/i.test(handle)) return '';
  return handle.replace(/^@/, '');
}

/**
 * The handle an account is known by. `accountName` is *supposed* to equal the
 * handle in `accountLink` (see smm-portal.md), but a hand-typed display name
 * can drift, so the link wins and the name is only the fallback.
 */
export function accountHandle(account: { accountName?: string; accountLink?: string }): string {
  return (
    extractAccountHandle(account.accountLink ?? '')
    || (account.accountName ?? '').trim().replace(/^@/, '')
  );
}

/**
 * True when `url` is a Twitter/X link posted on `handle`. Used to keep a post's
 * link and its selected account in agreement — a post filed under one page but
 * linking to another can't be verified by an admin, and the account is what
 * decides the bonus tier.
 *
 * Matches any variant/route: x.com or twitter.com, with or without scheme/www,
 * `/status/123`, `/photo/1`, query strings and fragments.
 */
export function linkMatchesHandle(url: string, handle: string): boolean {
  const linkHandle = extractAccountHandle(url).toLowerCase();
  const target = handle.trim().replace(/^@/, '').toLowerCase();
  return !!linkHandle && !!target && linkHandle === target;
}

/**
 * The tweet's unique status id — the only part of a Twitter/X post URL that
 * identifies the post. Everything around it varies freely: scheme, `www.`,
 * `x.com` vs `twitter.com`, the handle (which changes on a rename), a trailing
 * `/photo/1` or `/video/2`, `?t=…&s=20` tracking params, a `#fragment`.
 *
 * https://x.com/KaydenGrayXXX/status/1680207693380833280/video/1 → '1680207693380833280'
 */
export function extractStatusId(url: string): string {
  const link = url.trim();
  if (!link) return '';
  return link.split('#')[0].split('?')[0].match(/\/status(?:es)?\/(\d+)/i)?.[1] ?? '';
}

/**
 * Canonical identity of a Twitter/X link, for equality comparison. Stored
 * alongside the raw link (`postLinkNormalized` / `originalLinkNormalized`) so
 * lookups can use a plain equality query — Firestore cannot suffix-match at
 * query time, so links must be normalized at write time.
 *
 * **This is the one and only way a link may be compared or looked up.** Never
 * compare raw `postLink`/`originalLink` strings, and never build a query off
 * anything but this function's output.
 *
 * For a post link the identity is the {@link extractStatusId} status id, so
 * every variant of the same tweet collapses to one value. A non-status link (a
 * bare profile) falls back to a host/scheme/`www.`-stripped form with
 * `twitter.com` folded onto `x.com`.
 */
export function normalizePostLink(url: string): string {
  let link = url.trim();
  if (!link) return '';
  link = link.split('#')[0].split('?')[0];

  const statusId = extractStatusId(link);
  if (statusId) return `x.com/i/status/${statusId}`;

  link = link.replace(/\/(photo|video)\/\d+\/?$/i, '');
  link = link.replace(/\/+$/, '');
  link = link.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const [host, ...rest] = link.split('/');
  return [host.toLowerCase().replace(/^twitter\.com$/, 'x.com'), ...rest].join('/');
}

/**
 * True when two links point at the same post, whatever form each was pasted
 * in. Empty/unparseable links never match — "no link" is not "the same link".
 */
export function isSameLink(a: string, b: string): boolean {
  const na = normalizePostLink(a);
  return !!na && na === normalizePostLink(b);
}
