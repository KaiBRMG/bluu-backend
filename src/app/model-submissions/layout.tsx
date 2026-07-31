import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Model Application · Bluu Rock',
  description:
    'Apply to be represented by Bluu Rock. Everything you send is confidential and is never shared externally.',
  // The link is handed out directly. It is not a page we want indexed, and the
  // form collects personal data — keep it out of search results and previews.
  robots: { index: false, follow: false, nocache: true },
};

export default function ModelSubmissionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
