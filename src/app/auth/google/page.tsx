import { redirect } from 'next/navigation';

export default function GoogleAuthPage() {
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
    prompt: 'select_account',
    hd: 'bluurock.com',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  // Server-side redirect - no intermediate page shown
  redirect(authUrl);
}
