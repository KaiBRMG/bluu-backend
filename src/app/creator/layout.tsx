import type { Metadata, Viewport } from 'next';
import { CreatorPortalShell } from './CreatorPortalShell';

/**
 * The creator portal is the one surface read almost entirely on a phone, and it
 * now runs **inside Telegram** as a Mini App. Everything below is scoped to the
 * `/creator` segment on purpose — the root layout is shared with the internal
 * Electron console, which must not inherit a mobile viewport.
 *
 * **The PWA install path is gone.** The portal used to ship a web manifest and
 * an install prompt so a creator could add it to their home screen; with
 * Telegram as the only way in, an installed copy would open outside Telegram
 * with no `initData` and therefore no session — an icon that leads to a dead
 * end. Telegram's own "add to home screen" covers the same need and launches
 * back through the bot. `InstallPrompt` and `manifest.webmanifest` were removed
 * with it; the icons are kept as ordinary favicons for the webview.
 */
export const metadata: Metadata = {
  title: 'Bluu Creator Portal',
  description: 'Your custom requests, content plan and upload links.',
  icons: {
    apple: '/creator/apple-touch-icon.png',
    icon: '/creator/icon-192.png',
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
