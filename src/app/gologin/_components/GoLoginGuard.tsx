'use client';

import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import ConnectingScreen from './ConnectingScreen';
import Notice from './Notice';

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
    return <ConnectingScreen stage="session" />;
  }

  if (!user) {
    return <Notice title="Not signed in" body="Sign in from the main Bluu window, then reopen GoLogin." />;
  }

  if (!userData?.permittedPageIds?.includes('apps-gologin')) {
    return <Notice title="Access denied" body="You do not have access to GoLogin." />;
  }

  return <>{children}</>;
}
