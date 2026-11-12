"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * Where `TermsUpdateSignOut` lands a user it has signed out because the Terms of
 * Use were updated. Same shape as `/auth/displaced` and `/auth/revoked`: the user
 * is signed out already, and "Back to Login" is the one action. Signing in again
 * is their acceptance of the new text, which is exactly what Login says.
 */
export default function TermsUpdatedPage() {
  const router = useRouter();

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background bg-cover bg-center bg-no-repeat px-4"
      style={{ backgroundImage: "url('/backgrounds/2_blur.png')" }}
    >
      <div className="w-full max-w-md rounded-xl border border-[#2a2a2a] bg-[#171717] p-10 text-center">
        <div className="mb-6 flex justify-center">
          <img src="/logo/HQ2.webp" alt="Bluu" width={1374} height={868} className="h-12 w-auto" />
        </div>
        <h1 className="mb-3 text-lg font-semibold text-white">Our terms have been updated</h1>
        <p className="mb-3 text-sm text-zinc-400">
          We have updated our Terms of Use &amp; Privacy Policy, so you have been signed out. You
          were not clocked in, and nothing was lost.
        </p>
        <p className="mb-8 text-sm text-zinc-400">
          Please read the updated terms, then sign in again. Signing in means you agree to them.
        </p>
        <div className="flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              Read the updated terms
            </a>
          </Button>
          <Button className="w-full" onClick={() => router.replace('/')}>
            Back to Login
          </Button>
        </div>
      </div>
    </div>
  );
}
