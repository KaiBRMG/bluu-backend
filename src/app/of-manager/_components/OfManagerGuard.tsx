'use client';

import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Client-side gate for the OF Manager window.
 *
 * This is the **third** layer, not the only one: the Electron main process
 * verifies the permission server-side (`/api/onlyfans/access`) before creating
 * the window, and every OnlyFans API route re-checks it. This layer exists so a
 * window that somehow opens — a stale window after access is revoked, a direct
 * URL — shows a refusal instead of an empty console.
 */
export default function OfManagerGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { userData, loading: userDataLoading } = useUserData();

  if (loading || (user && userDataLoading)) {
    return (
      <div
        className="flex h-screen w-screen gap-px bg-background p-0"
        role="status"
        aria-label="Loading OF Manager"
      >
        <Skeleton className="h-full w-[340px] rounded-none" />
        <Skeleton className="h-full flex-1 rounded-none" />
      </div>
    );
  }

  if (!user) return <Notice title="Not signed in" body="Sign in from the main Bluu window, then reopen OF Manager." />;

  if (!userData?.permittedPageIds?.includes('apps-ofmanager')) {
    return <Notice title="Access denied" body="You do not have access to OF Manager." />;
  }

  return <>{children}</>;
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-2 bg-background px-8 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-zinc-400">{body}</p>
    </div>
  );
}
