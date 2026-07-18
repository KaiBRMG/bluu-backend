import type { Metadata } from "next";
import googleFonts from "google-fonts";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

// Google Sans is served from the Google Fonts CDN via the `google-fonts`
// helper. This is the single, app-wide typeface — no other fonts are used.
// The helper returns a full `<link>` string; we pull out the href and force
// https (it is protocol-relative by default) so it resolves inside Electron.
const googleSansHref = googleFonts({
  "Google Sans": ["400", "500", "600", "700", "400italic"],
})
  .match(/href="([^"]+)"/)![1]
  .replace(/^\/\//, "https://");

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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link rel="stylesheet" href={googleSansHref} />
      </head>
      <body
        className="font-sans antialiased bg-background text-foreground"
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
