import { NextResponse } from 'next/server';
import { COOKIE_NAME, COOKIE_OPTIONS } from '@/lib/services/trainingAuthService';

/** PUBLIC — clears the candidate cookie. Not cacheable: it sets a cookie. */
export async function POST() {
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(COOKIE_NAME, '', { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
