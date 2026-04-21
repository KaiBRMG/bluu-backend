'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function CallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      // Redirect back to Electron with error
      window.location.href = `bluu://callback?error=${encodeURIComponent(error)}`;
      return;
    }

    if (code) {
      // Redirect back to Electron with authorization code
      window.location.href = `bluu://callback?code=${encodeURIComponent(code)}`;
    } else {
      // No code or error - something went wrong
      window.location.href = `bluu://callback?error=no_code_received`;
    }
  }, [searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <div className="text-center">
        <div className="text-white text-xl mb-4">Authorization successful!</div>
        <div className="text-zinc-500 text-sm mt-4">
          If you're not redirected automatically, you can close this window.
        </div>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-white text-xl">Processing...</div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
