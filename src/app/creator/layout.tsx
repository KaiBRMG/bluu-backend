import type { Metadata, Viewport } from 'next';
import { CreatorPortalShell } from './CreatorPortalShell';

/**
 * The creator portal is the one surface read almost entirely on a phone, and the
 * only one a user can install to their home screen. Everything below is scoped to
 * the `/creator` segment on purpose — the root layout is shared with the internal
 * Electron console, which must not inherit a manifest or a mobile viewport.
 *
 * The manifest is a static file (`public/creator/manifest.webmanifest`), not a
 * service worker: an installed home-screen app is the whole benefit here, and
 * offline caching would actively hurt a portal whose every screen is a live
 * Firestore subscription. See DESIGN.md § Creator Portal — Installed app.
 */
export const metadata: Metadata = {
  title: 'Bluu Creator Portal',
  description: 'Your custom requests, content plan and upload links.',
  manifest: '/creator/manifest.webmanifest',
  applicationName: 'Bluu Creator',
  appleWebApp: {
    capable: true,
    title: 'Bluu Creator',
    // `black` keeps the iOS status bar opaque so page content starts below it.
    // `black-translucent` would slide the sticky headers under the clock and
    // require a safe-area inset on every one of them.
    statusBarStyle: 'black',
  },
  icons: {
    apple: '/creator/apple-touch-icon.png',
    icon: '/creator/icon-192.png',
  },
  other: {
    // Next emits only the standard `mobile-web-app-capable`. iOS honours the
    // manifest's `display: standalone` from 16.4 on, but anything older still
    // needs this legacy name to launch full screen instead of inside Safari.
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deliberately NOT `maximumScale: 1` / `userScalable: false`. Blocking zoom
  // fails WCAG 1.4.4 and iOS Safari has ignored it since iOS 10 anyway — the
  // real fix for zoom-on-focus is 16px input text, which the login form sets.
  themeColor: '#09090b',
};

export default function CreatorPortalLayout({ children }: { children: React.ReactNode }) {
  return <CreatorPortalShell>{children}</CreatorPortalShell>;
}
