import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BROWSER_ALLOWED_PREFIXES = [
  '/creator-portal',
  '/desktop-only',
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

export const config = {
  matcher: ['/((?!_next|api|.*\\.[a-zA-Z0-9]+$).*)'],
};
