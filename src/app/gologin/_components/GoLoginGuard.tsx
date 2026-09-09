'use client';

import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Client-side gate for the GoLogin window.
 *
 * The **third** layer, not the only one: the Electron main process verifies the
 * permission server-side (`/api/gologin/access`) before creating the window, and
 * the profiles route re-checks it. This exists so a window that somehow opens —
 * a stale window after access was revoked, a direct URL — shows a refusal rather
 * than an empty console.
 */
export default function GoLoginGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { userData, loading: userDataLoading } = useUserData();

  if (loading || (user && userDataLoading)) {
    return (
      <div
        className="flex h-full w-full flex-col gap-3 bg-background p-6"
        role="status"
        aria-label="Loading GoLogin"
      >
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-full w-full rounded-xl" />
      </div>
    );
  }

  if (!user) {
    return <Notice title="Not signed in" body="Sign in from the main Bluu window, then reopen GoLogin." />;
  }

  if (!userData?.permittedPageIds?.includes('apps-gologin')) {
    return <Notice title="Access denied" body="You do not have access to GoLogin." />;
  }

  return <>{children}</>;
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background px-8 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-zinc-400">{body}</p>
    </div>
  );
}
