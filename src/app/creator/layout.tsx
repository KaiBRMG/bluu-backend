import type { Metadata, Viewport } from 'next';
import { CreatorPortalShell } from './CreatorPortalShell';
import { portalMono } from './fonts';
import { COLOR } from './theme';
import './creator.css';

/**
 * The creator portal is the one surface read almost entirely on a phone, and it
 * runs **inside Telegram** as a Mini App. Everything below is scoped to the
 * `/creator` segment on purpose — the root layout is shared with the internal
 * Electron console, which must not inherit a mobile viewport, the portal's
 * stylesheet, or its second typeface.
 *
 * **The PWA install path is gone.** The portal used to ship a web manifest and
 * an install prompt so a creator could add it to her home screen; with Telegram
 * as the only way in, an installed copy would open outside Telegram with no
 * `initData` and therefore no session — an icon that leads to a dead end.
 * Telegram's own "add to home screen" covers the same need and launches back
 * through the bot. `InstallPrompt` and `manifest.webmanifest` were removed with
 * it; the icons are kept as ordinary favicons for the webview.
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
  // real fix for zoom-on-focus is 16px field text, which the portal uses.
  themeColor: COLOR.void,
};

export default function CreatorPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    // The mono variable is applied here, on the segment's own wrapper, so the
    // console never inherits it. `min-h-dvh` (not `min-h-screen`): `100vh` on a
    // mobile browser excludes the collapsing URL bar, and Telegram resizes the
    // webview when it expands.
    <div
      className={`${portalMono.variable} min-h-dvh`}
      style={{ background: COLOR.void, color: COLOR.ink }}
    >
      <CreatorPortalShell>{children}</CreatorPortalShell>
    </div>
  );
}
