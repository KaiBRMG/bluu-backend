/**
 * Pure link helpers shared by client and server — no Firebase imports.
 */

/**
 * Normalize a Twitter/X post link for equality comparison. Stored alongside
 * the raw link (`postLinkNormalized` / `originalLinkNormalized`) so the bonus
 * wizard's duplicate lookup can use a plain equality query — Firestore cannot
 * suffix-match at query time, so links must be normalized at write time.
 *
 * Handles: whitespace, query strings/fragments, a trailing `/photo/N` or
 * `/video/N` segment, trailing slashes, and scheme/host casing.
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

export function normalizePostLink(url: string): string {
  let link = url.trim();
  if (!link) return '';
  link = link.split('#')[0].split('?')[0];
  link = link.replace(/\/(photo|video)\/\d+\/?$/i, '');
  link = link.replace(/\/+$/, '');
  const schemeHost = link.match(/^(https?:\/\/[^/]+)(.*)$/i);
  if (schemeHost) link = schemeHost[1].toLowerCase() + schemeHost[2];
  return link;
}
