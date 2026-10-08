import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { LEGACY_APP_HOST, PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';

const BROWSER_ALLOWED_PREFIXES = [
  '/auth',
  '/creator',
  '/desktop-only',
  '/download',
  // The public model application form. Handed out as a link to prospective
  // models, who have no desktop app — it must resolve in a normal browser.
  '/model-submissions',
  // An approved applicant's personal onboarding form, linked from the
  // "Welcome to BLUU ROCK" email. Opened in a phone browser by someone with no
  // desktop app; the 160-bit secret in the path is the access control.
  '/join',
  // Shared prompts. The whole point of the link is that it resolves for someone
  // who does not have the desktop app — a recipient rewritten to /desktop-only
  // would make sharing useless. Read-only, and reachable only with the 160-bit
  // share token in the path.
  '/p',
  '/raffle',
  // Shared snips. Same reasoning as `/p` above: the entire purpose of the link
  // is that it opens for a recipient who does not have the desktop app.
  // Read-only, and reachable only with the 160-bit token in the path.
  '/s',
  // The update landing page. `APP_UPDATE.downloadUrl` points here, and the
  // Windows update prompt opens it in the SYSTEM browser via shell.openExternal
  // — so it has to resolve without the Electron user agent, same as '/download'.
  '/update',
  // Onboarding links the terms of use out to the system browser (Electron routes
  // target=_blank through shell.openExternal), so it must resolve without the
  // Electron user agent. Public, read-only, no user data.
  '/terms',
];

/**
 * Paths a browser keeps using on the legacy host instead of being redirected.
 *
 * - `/auth` — `NEXT_PUBLIC_REDIRECT_URI` (the OAuth callback Google returns to)
 *   is still registered on the legacy host. Redirect it only once that env var
 *   and the Google client both point at the official domain.
 * - `/creator` — the Telegram Mini App. Telegram launches it with its signed
 *   `initData` in the URL fragment, and in-app webviews do not reliably carry a
 *   fragment across a redirect (see `scripts/fix-creator-menu-buttons.js`), so
 *   a creator whose menu button still names the legacy host must be served in
 *   place.
 */
const LEGACY_HOST_PASSTHROUGH_PREFIXES = ['/auth', '/creator'];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function middleware(request: NextRequest) {
  const { pathname, search, hostname } = request.nextUrl;
  const isElectron = /Electron\//i.test(request.headers.get('user-agent') ?? '');

  // The legacy host is being phased out: a browser following an old link (a
  // shared snip or prompt, a /join email, a bookmark) lands on the same page on
  // the official domain. Desktop shells older than 0.16.0 are still pinned to
  // this host and must never be redirected — the shell compares every load
  // against its BASE_URL, and a foreign origin breaks navigation and offline
  // recovery (documentation/electron.md). `/api` never reaches this function,
  // so webhooks and old shells' API calls keep answering here.
  if (
    hostname === LEGACY_APP_HOST &&
    !isElectron &&
    !matchesPrefix(pathname, LEGACY_HOST_PASSTHROUGH_PREFIXES)
  ) {
    return NextResponse.redirect(new URL(`${pathname}${search}`, PUBLIC_APP_ORIGIN), 308);
  }

  if (matchesPrefix(pathname, BROWSER_ALLOWED_PREFIXES) || isElectron) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/desktop-only';
  url.search = '';
  return NextResponse.rewrite(url);
}

/**
 * Page traffic only, and **document requests only** — never RSC requests.
 *
 * Rule 9i. This middleware ran on all ~61k origin requests a day to compare one
 * user-agent string, and middleware is billed as Fast Origin Transfer on both
 * the request and the response. The overwhelming majority of those were RSC
 * payload fetches (`<Link>` navigations and prefetches), which carry an `RSC`
 * header that a browser address-bar navigation never does.
 *
 * **Skipping them is safe, and is not a hole in the desktop-only gate.** An RSC
 * request can only be issued by an App Router client that is already running,
 * which means its own document request came through here first and a browser
 * was already rewritten to `/desktop-only`. There is nothing to gate on the
 * second hop.
 *
 * **It is not an authorization boundary either**, so nothing security-relevant
 * rides on it (rule 10). Every page renders behind `AuthProvider`/`withAuth`
 * and every API route behind `withAuth`; these routes are client components
 * whose RSC payload is a module graph with no user data in it. This gate
 * decides where a *browser* lands, not what anyone is allowed to read.
 */
export const config = {
  matcher: [
    {
      source: '/((?!_next|api|.*\\.[a-zA-Z0-9]+$).*)',
      missing: [{ type: 'header', key: 'RSC' }],
    },
  ],
};
