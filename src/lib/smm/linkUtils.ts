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
