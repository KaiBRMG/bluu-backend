import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shared Screenshot · Bluu Rock',
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
  return <div className="min-h-screen bg-[#09090b] text-white">{children}</div>;
}
