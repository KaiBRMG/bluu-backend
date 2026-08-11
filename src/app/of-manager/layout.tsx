import { AuthProvider } from '@/components/AuthProvider';
import { NetworkStatusProvider } from '@/contexts/NetworkStatusContext';
import { UserDataProvider } from '@/hooks/useUserData';
import OfManagerGuard from './_components/OfManagerGuard';

/**
 * OF Manager runs in its **own Electron window**, so it deliberately does not
 * use `(main)`'s layout: no sidebar, no top bar, and — critically — no
 * `TimeTrackingProvider`. A second time-tracking context in a second window
 * would run a second heartbeat, a second screenshot scheduler and a second
 * clock-out flush against the same session.
 *
 * It keeps only what an authenticated surface genuinely needs: Firebase auth,
 * the user-doc snapshot (which carries `permittedPageIds`), and network status.
 * Auth is shared with the main window for free — Firebase persists to IndexedDB,
 * which is per-origin, and both windows load the same origin.
 */
export default function OfManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <NetworkStatusProvider>
        <UserDataProvider>
          <OfManagerGuard>{children}</OfManagerGuard>
        </UserDataProvider>
      </NetworkStatusProvider>
    </AuthProvider>
  );
}
