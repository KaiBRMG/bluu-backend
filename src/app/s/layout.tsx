import type { Metadata } from 'next';
import { preconnect } from 'react-dom';

export const metadata: Metadata = {
  // "Capture", not "Screenshot": this shell serves recordings too, and the
  // title is what a recipient reads in their browser tab and what a chat
  // client shows when the link is pasted. Calling a two-minute video a
  // screenshot is wrong in the one place the sender cannot correct it.
  title: 'Shared capture · Bluu Rock',
  // The URL is handed to a specific person and the token in it IS the access
  // control, so it must not appear in search results, previews or any crawler's
  // cache — an indexed link is a leaked screenshot. Same posture as `/p`.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The public, unauthenticated shell for a shared snip.
 *
 * Deliberately outside `(main)/` — no AuthProvider, no AppLayout, no sidebar, no
 * time tracking. A recipient may be anyone the link was forwarded to, and this
 * route has to render for them with no session and no Electron.
 */
export default function SharedSnipLayout({ children }: { children: React.ReactNode }) {
  // Every picture and recording on this route comes from Cloud Storage, which
  // is a host the page has never talked to — a DNS lookup, a TCP connect and a
  // TLS handshake the visitor otherwise pays AFTER the HTML says where to look.
  // Opened now, in parallel with the page. (The root layout warms
  // `firebasestorage.googleapis.com`, which is a different host: signed URLs
  // are served from `storage.googleapis.com`.) No `crossOrigin`: <img> and
  // <video> fetch in no-cors mode, and a connection opened in CORS mode is
  // not reused by them.
  preconnect('https://storage.googleapis.com');

  // Tokens, not literals. `dark` is applied on the root <html> by the theme
  // provider and never toggled, so these resolve to the same near-black the
  // hexes spelled out by hand — with the difference that changing the app's
  // ground changes this too.
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
