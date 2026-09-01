import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shared Prompt · Bluu Rock',
  // The URL is handed to a specific person. It carries the token that IS the
  // access control, so it must not appear in search results, previews or any
  // crawler's cache — a leaked index entry is a leaked prompt.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The public, unauthenticated shell for a shared prompt.
 *
 * Deliberately outside `(main)/` — no AuthProvider, no AppLayout, no sidebar, no
 * time tracking. A recipient may be anyone the link was forwarded to, and this
 * route must render for them with no session and no Electron.
 */
export default function SharedPromptLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#09090b] text-white">{children}</div>;
}
