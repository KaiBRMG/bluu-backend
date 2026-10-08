/**
 * Public, browser-facing origin for the app — and, from Electron build 0.16.0,
 * the origin the desktop shell loads too (`BASE_URL` in `electron/main.js`).
 *
 * `app.bluurock.com` is the official domain. Build every user-facing URL from
 * this constant, never from `window.location.origin`: a desktop shell older
 * than 0.16.0 is still pinned to the legacy host below, so the current origin
 * there is the one being phased out.
 */
export const PUBLIC_APP_ORIGIN = 'https://app.bluurock.com';

/**
 * The legacy `*.vercel.app` host, being phased out. Same deployment, so it
 * still serves everything — `src/middleware.ts` redirects browser page traffic
 * on it to {@link PUBLIC_APP_ORIGIN}, and leaves alone the traffic that must
 * keep answering in place (pre-0.16 desktop shells, OAuth, the Telegram Mini
 * App, every `/api` route). See documentation/electron.md#two-domains-one-deployment.
 */
export const LEGACY_APP_HOST = 'bluu-backend.vercel.app';
