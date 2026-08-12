import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI || 'http://localhost:3000/auth/callback';

  if (!clientId) {
    return NextResponse.json(
      { error: 'Google Client ID not configured' },
      { status: 500 }
    );
  }

  // Build Google OAuth URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    // Always show the account chooser: staff sign in with personal Google
    // accounts and many are signed into several at once.
    prompt: 'select_account',
    // No `hd` — the company-domain restriction is gone. Authorisation is the
    // allowlist in /api/auth/exchange-code, not Google's domain filter.
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return NextResponse.json({ url: authUrl });
}
