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
          {/*
            `fixed inset-0` — deliberately, and not `h-screen w-screen`.
            On Windows Electron the scrollbars are classic (space-consuming), so
            a `100vw`/`100vh` shell is self-reinforcing: 100vw exceeds the client
            width the moment any vertical scrollbar exists, the resulting
            horizontal scrollbar eats height, 100vh then exceeds the client
            height, and the two scrollbars flip each other on and off forever.
            That is the over-scroll past the bottom and the flicker under the
            cursor. A fixed inset-0 box is measured against the client area, adds
            nothing to the document's scroll height, and cannot feed the loop.
          */}
          <div className="fixed inset-0 overflow-hidden">
            <OfManagerGuard>{children}</OfManagerGuard>
          </div>
        </UserDataProvider>
      </NetworkStatusProvider>
    </AuthProvider>
  );
}
