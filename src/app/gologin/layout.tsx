import { AuthProvider } from '@/components/AuthProvider';
import { NetworkStatusProvider } from '@/contexts/NetworkStatusContext';
import { UserDataProvider } from '@/hooks/useUserData';
import PresenceReporter from '@/components/PresenceReporter';
import GoLoginGuard from './_components/GoLoginGuard';

/**
 * GoLogin runs in its **own Electron window**, so — exactly like `/of-manager`,
 * and for the same reason — it deliberately does not use `(main)`'s layout: no
 * sidebar, no top bar, and critically no `TimeTrackingProvider`. A second
 * time-tracking context in a second window would run a second heartbeat, a
 * second screenshot scheduler and a second clock-out flush against the same
 * session.
 *
 * It keeps only what an authenticated surface needs: Firebase auth, the user-doc
 * snapshot (which carries `permittedPageIds`), and network status. Auth is
 * shared with the main window for free — Firebase persists to IndexedDB, which
 * is per-origin, and both windows load the same origin.
 */
export default function GoLoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <NetworkStatusProvider>
        <UserDataProvider>
          {/* This window being open is the app being open, so it reports
              presence exactly like the main one. Duplicate pings from a user
              running both are collapsed server-side. */}
          <PresenceReporter />
          {/*
            `fixed inset-0` — deliberately, and never `h-screen w-screen`. On
            Windows Electron the scrollbars are classic (space-consuming), so a
            `100vw`/`100vh` shell oscillates: 100vw exceeds the client width the
            moment any vertical scrollbar exists, the horizontal scrollbar that
            follows eats height, and the two flip each other on and off forever.
            See documentation/onlyfans-crm.md § The window.
          */}
          <div className="fixed inset-0 overflow-hidden">
            <GoLoginGuard>{children}</GoLoginGuard>
          </div>
        </UserDataProvider>
      </NetworkStatusProvider>
    </AuthProvider>
  );
}
