import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PAGE_GROUND_STYLE, PRIMARY_BTN, SURFACE } from '@/app/creator/theme';
import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';

export const metadata = {
  title: 'Creator Portal — Bluu Rock',
};

// This page is the browser-facing fallback for every internal console route
// (see src/middleware.ts). Almost everyone who lands here is a creator who
// followed a link into the app, so the creator portal is the primary path;
// staff — who belong in the Electron console — are pointed at the download page
// underneath. Skinned with the creator-portal tokens, not the console's.
export default function DesktopOnlyPage() {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-6 py-16"
      style={PAGE_GROUND_STYLE}
    >
      <div className={`w-full max-w-md rounded-xl p-8 text-center ${SURFACE.panel}`}>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/bluu_long.svg" alt="Bluu Rock" className="h-8 w-auto" />
        </div>

        <h1 className="mt-8 text-lg font-semibold text-white">
          Welcome to the Creator Portal
        </h1>
        <p className="mt-3 text-sm text-zinc-400">
          Sign in to see your workspace.
        </p>

        {/* Brand azure at full strength lands on exactly one element per page: the
            action the page exists for. Staff below stay neutral, so the one colour
            on screen always points a creator at their own path. */}
        <Button asChild className={`mt-6 w-full ${PRIMARY_BTN}`}>
          <Link href="/creator/dashboard">Go to the creator portal</Link>
        </Button>

        <div className="mt-8 border-t border-white/[0.07] pt-6">
          <p className="text-xs text-zinc-400">
            Bluu Rock staff? The management console only runs in the desktop app — open it
            to sign in, or{' '}
            <a
              href={`${PUBLIC_APP_ORIGIN}/download`}
              className="rounded-sm text-zinc-200 underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              download it here
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
