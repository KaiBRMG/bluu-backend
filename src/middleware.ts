import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BROWSER_ALLOWED_PREFIXES = [
  '/auth',
  '/creator',
  '/desktop-only',
  '/download',
  // The public model application form. Handed out as a link to prospective
  // models, who have no desktop app — it must resolve in a normal browser.
  '/model-submissions',
  // Shared prompts. The whole point of the link is that it resolves for someone
  // who does not have the desktop app — a recipient rewritten to /desktop-only
  // would make sharing useless. Read-only, and reachable only with the 160-bit
  // share token in the path.
  '/p',
  '/raffle',
  // Onboarding links the terms of use out to the system browser (Electron routes
  // target=_blank through shell.openExternal), so it must resolve without the
  // Electron user agent. Public, read-only, no user data.
  '/terms',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  for (const prefix of BROWSER_ALLOWED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return NextResponse.next();
    }
  }

  const userAgent = request.headers.get('user-agent') ?? '';
  if (/Electron\//i.test(userAgent)) {
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
