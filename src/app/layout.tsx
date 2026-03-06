import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next"
import { Analytics } from "@vercel/analytics/next"
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { NetworkStatusProvider } from "@/contexts/NetworkStatusContext";
import { UserDataProvider } from "@/hooks/useUserData";
import { TimeTrackingProvider } from "@/contexts/TimeTrackingContext";
import { NotificationsProvider } from "@/hooks/useNotifications";
import AuthWrapper from "@/components/AuthWrapper";
import ErrorLogger from "@/components/ErrorLogger";
import UpdateBanner from "@/components/UpdateBanner";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bluu Backend",
  description: "Internal company application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <AuthProvider>
          <NetworkStatusProvider>
            <UserDataProvider>
              <ErrorLogger />
              <NotificationsProvider>
                <TimeTrackingProvider>
                  <AuthWrapper>
                    {children}
                  </AuthWrapper>
                  <UpdateBanner />
                  <SpeedInsights />
                  <Analytics />
                </TimeTrackingProvider>
              </NotificationsProvider>
            </UserDataProvider>
          </NetworkStatusProvider>
        </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
