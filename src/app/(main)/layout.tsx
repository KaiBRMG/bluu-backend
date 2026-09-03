import { Suspense } from "react";
import { AuthProvider } from "@/components/AuthProvider";
import { NetworkStatusProvider } from "@/contexts/NetworkStatusContext";
import { UserDataProvider } from "@/hooks/useUserData";
import { BootLoaderProvider } from "@/contexts/BootLoaderContext";
import AuthWrapper from "@/components/AuthWrapper";
import ErrorLogger from "@/components/ErrorLogger";
import AppVersionReporter from "@/components/AppVersionReporter";
import UpdateBanner from "@/components/UpdateBanner";
import UpdateAvailableBanner from "@/components/UpdateAvailableBanner";
import EmailMigrationDialog from "@/components/migration/EmailMigrationDialog";
import AnnouncementCard from "@/components/announcements/AnnouncementCard";
import DeploymentRefresher from "@/components/DeploymentRefresher";
import NavigationWatchdog from "@/components/NavigationWatchdog";
import NavigationProgress from "@/components/NavigationProgress";
import DeepLinkRouter from "@/components/DeepLinkRouter";
import LazyProviders from "@/components/LazyProviders";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <NetworkStatusProvider>
        <UserDataProvider>
          <ErrorLogger />
          <AppVersionReporter />
          {/* Outside LazyProviders on purpose: it needs no context, and a
              navigation can be clicked (and stall) before the lazily-imported
              providers have finished loading. Mounted on the layout, not in
              AppLayout, so the timer survives navigations instead of being torn
              down with the page. */}
          <NavigationWatchdog />
          {/* Outside LazyProviders for the same reason as the watchdog: a
              `bluu://` link can arrive before the lazily-imported providers
              have loaded — a cold launch from a shared prompt link is exactly
              that case. Renders nothing; it only routes. */}
          <DeepLinkRouter />
          {/* Reads the watchdog's state, so it must sit outside LazyProviders
              with it — a slow navigation is exactly when the lazily-imported
              providers may not have arrived yet, and that is the moment the
              user most needs to be told something is loading.

              The Suspense boundary is required, not decorative: it subscribes
              to an external store, which Cache Components counts as uncached
              dynamic data, and prerendering the route fails outright without a
              boundary to stream it into. `null` is the right fallback — there
              is nothing to show before the first navigation anyway. */}
          <Suspense fallback={null}>
            <NavigationProgress />
          </Suspense>
          <LazyProviders>
            <BootLoaderProvider>
              <AuthWrapper>
                {children}
              </AuthWrapper>
            </BootLoaderProvider>
            <UpdateBanner />
            <UpdateAvailableBanner />
            {/* Inside LazyProviders because it reads clock state — the card must
                never interrupt a shift. Renders nothing unless the user's cohort
                is armed in emailMigrationConfig.ts. */}
            <EmailMigrationDialog />
            {/* Inside LazyProviders because it reads clock state — a clock-out
                is what re-arms a "remind me later". Mounted on the layout, not
                in AppLayout, so the card persists across navigations instead of
                being torn down with the page. Renders nothing unless an entry
                in announcementConfig.ts is armed for this user. */}
            <AnnouncementCard />
            {/* Also inside LazyProviders, and for the same reason: it reads
                clock state to make sure a forced reload never lands mid-shift.
                Main window only — a satellite must not reload under an
                operator. */}
            <DeploymentRefresher />
            <SpeedInsights />
            <Analytics />
          </LazyProviders>
        </UserDataProvider>
      </NetworkStatusProvider>
    </AuthProvider>
  );
}
