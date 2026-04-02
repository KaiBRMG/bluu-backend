import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next"
import { Analytics } from "@vercel/analytics/next"
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { NetworkStatusProvider } from "@/contexts/NetworkStatusContext";
import { UserDataProvider } from "@/hooks/useUserData";
import AuthWrapper from "@/components/AuthWrapper";
import ErrorLogger from "@/components/ErrorLogger";
import UpdateBanner from "@/components/UpdateBanner";
import LazyProviders from "@/components/LazyProviders";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

const googleSans = localFont({
  src: [
    {
      path: "../public/fonts/GoogleSans-VariableFont_GRAD,opsz,wght.ttf",
      style: "normal",
    },
    {
      path: "../public/fonts/GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf",
      style: "italic",
    },
  ],
  variable: "--font-geist-sans",
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
        className={`${googleSans.variable} font-sans antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <AuthProvider>
          <NetworkStatusProvider>
            <UserDataProvider>
              <ErrorLogger />
              <LazyProviders>
                <AuthWrapper>
                  {children}
                </AuthWrapper>
                <UpdateBanner />
                <Toaster />
                <SpeedInsights />
                <Analytics />
              </LazyProviders>
            </UserDataProvider>
          </NetworkStatusProvider>
        </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
