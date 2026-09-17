import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Download · Bluu Backend',
  description:
    'Installers and first-time setup for the Bluu Backend desktop app, for Windows and macOS.',
  // Internal software, handed out as a link. Not for distribution, so not for
  // search results either — same posture as the model application form.
  robots: { index: false, follow: false, nocache: true },
};

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
