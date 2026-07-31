/**
 * Public, browser-facing origin for the app.
 *
 * The Vercel project serves two domains: `bluu-backend.vercel.app` (pinned by
 * the Electron shell — see `BASE_URL` in `electron/main.js`) and
 * `app.bluurock.com` (the domain external users get). Staff run the app inside
 * Electron, so `window.location.origin` there resolves to the vercel.app host —
 * never use it to build a link that leaves the app. Build creator-facing URLs
 * from this constant instead.
 */
export const PUBLIC_APP_ORIGIN = 'https://bluu-backend.vercel.app';
