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
import DeploymentRefresher from "@/components/DeploymentRefresher";
import NavigationWatchdog from "@/components/NavigationWatchdog";
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
