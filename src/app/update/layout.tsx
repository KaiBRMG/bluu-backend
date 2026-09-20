import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Update · Bluu Backend',
  description:
    'Get the newest Bluu Backend desktop build. For machines that already have the app installed.',
  // Internal software, handed out as a link. Not for distribution, so not for
  // search results either — same posture as `/download`.
  robots: { index: false, follow: false, nocache: true },
};

export default function UpdateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
