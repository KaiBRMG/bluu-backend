/**
 * Turns an `electron-updater` failure into something a person can read.
 *
 * `updater:status` carries `err.message` straight from `electron-updater`, and
 * for a missing release asset that message is a full HTTP dump — the URL, the
 * response headers, and a stack of `node_modules` paths. Rendered verbatim it is
 * a wall of red text that tells the user nothing and leaks build internals.
 * Every surface that shows an updater error goes through here instead; the raw
 * text still reaches the console (main logs it) for support.
 *
 * ▸ **`transient`** means "not the user's problem, and it will fix itself": the
 *   release is mid-build (its `latest-mac.yml` is not uploaded yet — the 404 a
 *   user saw during the v0.16.0 re-release) or the machine is offline.
 *
 * ▸ Classified by message text, not by a code from main, so it also works for
 *   every shell already installed — those predate any structured error field.
 */
export type UpdateErrorKind = 'not-ready' | 'offline' | 'other';

export interface DescribedUpdateError {
  kind: UpdateErrorKind;
  /** One short sentence, safe to render. Never contains URLs, headers or paths. */
  message: string;
  /** Self-healing: nothing for the user to do but wait or reconnect. */
  transient: boolean;
}

// electron-updater's own wording for "the release exists but the manifest does
// not" (`Cannot find latest-mac.yml in the latest release artifacts`), plus the
// bare 404 a draft or half-uploaded release produces.
const NOT_READY = /cannot find .*\.yml|latest(-mac)?\.yml|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|\b404\b|no published versions|not found/i;
const OFFLINE = /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|net::ERR_|network|offline|socket hang up|getaddrinfo/i;

export function describeUpdateError(raw: string | null | undefined): DescribedUpdateError {
  const text = raw ?? '';
  if (NOT_READY.test(text)) {
    return {
      kind: 'not-ready',
      message: 'The new version is still being prepared. Try again in a few minutes.',
      transient: true,
    };
  }
  if (OFFLINE.test(text)) {
    return {
      kind: 'offline',
      message: 'Couldn’t reach the update server. Check your connection and try again.',
      transient: true,
    };
  }
  return {
    kind: 'other',
    message: 'Something went wrong while updating. Try again in a moment.',
    transient: false,
  };
}
