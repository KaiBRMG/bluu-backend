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
        {/* Creator avatars normally render from an inlined `data:` thumbnail and
            touch no network at all. This covers the fallback path — a creator
            whose thumbnail has not been backfilled yet — where the first avatar
            would otherwise pay DNS + TLS to a host nothing else in the app
            talks to. `crossOrigin` because the images are fetched anonymously;
            omitting it opens a connection the image load cannot reuse. */}
        <link
          rel="preconnect"
          href="https://firebasestorage.googleapis.com"
          crossOrigin="anonymous"
        />
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
