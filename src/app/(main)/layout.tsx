import { AuthProvider } from "@/components/AuthProvider";
import { NetworkStatusProvider } from "@/contexts/NetworkStatusContext";
import { UserDataProvider } from "@/hooks/useUserData";
import { BootLoaderProvider } from "@/contexts/BootLoaderContext";
import AuthWrapper from "@/components/AuthWrapper";
import ErrorLogger from "@/components/ErrorLogger";
import UpdateBanner from "@/components/UpdateBanner";
import LazyProviders from "@/components/LazyProviders";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <NetworkStatusProvider>
        <UserDataProvider>
          <ErrorLogger />
          <LazyProviders>
            <BootLoaderProvider>
              <AuthWrapper>
                {children}
              </AuthWrapper>
            </BootLoaderProvider>
            <UpdateBanner />
            <SpeedInsights />
            <Analytics />
          </LazyProviders>
        </UserDataProvider>
      </NetworkStatusProvider>
    </AuthProvider>
  );
}
