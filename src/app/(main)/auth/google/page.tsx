import { redirect } from 'next/navigation';

/**
 * Server-side redirect into Google's consent screen. Opened in the user's
 * system browser (Electron hands it off via `shell.openExternal`), never in-app.
 *
 * Two modes:
 *  • default — normal sign-in.
 *  • `?mode=migrate` — the one-time move from a company address to a personal
 *    one. Identical parameters plus a forced re-consent, because the user is
 *    already signed into Google as their *work* self and we need the chooser to
 *    behave like a fresh decision rather than silently reusing that session.
 *    The "you picked your work email again" gate is enforced server-side after
 *    the exchange (Google has no way to exclude a domain), so this only affects
 *    how insistently the chooser is shown.
 */
export default async function GoogleAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI || 'http://localhost:3000/auth/callback';

  if (!clientId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-center">
          <div className="text-red-500 text-xl mb-4">Configuration Error</div>
          <div className="text-zinc-400">Google Client ID not configured</div>
          <div className="text-zinc-500 text-sm mt-4">
            Please check your environment variables.
          </div>
        </div>
      </div>
    );
  }

  // Build Google OAuth URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: mode === 'migrate' ? 'select_account consent' : 'select_account',
    // No `hd` — see /api/auth/google-url. Access is decided by our allowlist.
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  // Server-side redirect - no intermediate page shown
  redirect(authUrl);
}
