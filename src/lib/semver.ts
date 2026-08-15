/**
 * The one version comparison in the app. Shared because two different gates now
 * read the same version numbers out of `appUpdateConfig.ts` — the update prompt
 * (client) and the release-note notification (server) — and a fleet-wide gate
 * that compared versions two slightly different ways would be a bug waiting for
 * the first release with a two-digit patch number.
 *
 * Returns >0 if a>b, <0 if a<b, 0 if equal. Tolerant of non-numeric/partial
 * versions: anything unparseable reads as 0 rather than NaN-poisoning the
 * comparison.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
