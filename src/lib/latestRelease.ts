/**
 * The newest release whose **installers are actually uploaded** — the version
 * the public `/download` page prints on its download buttons.
 *
 * ▸ **It is not the same question as `APP_UPDATE.latestVersion`.** That one is a
 *   *policy*: who gets prompted, per platform, per cohort, and it reads `null`
 *   for a platform nobody is being nudged about (Windows, most of the time).
 *   This one is a *fact about the Drive folders*: what a person downloading
 *   today will get. A visitor needs the fact, not the policy.
 *
 * ▸ **It lives in its own module on purpose.** `/download` is a public client
 *   component, and importing `appUpdateConfig.ts` there would bundle
 *   `APP_UPDATE` — including its `uids`/`groups` cohort lists — into a page
 *   served to anyone with the link. The whole point of resolving cohorts
 *   server-side is that those lists never cross the wire.
 *
 * ▸ **Bump it when the files land in the Drive folders**, not when the tag is
 *   pushed. Cross-cutting rule 14's ordering applies for the same reason it
 *   applies to `latestVersion`: a number here that the folder cannot honour
 *   sends someone looking for a file that is not there.
 */
export const LATEST_RELEASE_VERSION = '0.12.0';

/** Display form, for a button or a chip: `v0.12.0`. */
export const LATEST_RELEASE_LABEL = `v${LATEST_RELEASE_VERSION}`;
