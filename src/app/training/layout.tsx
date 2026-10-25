import type { Metadata } from 'next';
import { NoTranslate } from '@/app/model-submissions/_components/NoTranslate';

export const metadata: Metadata = {
  title: 'Training · Bluu Rock',
  description: 'Bluu Rock training for approved candidates.',
  // A link handed to specific people. Never indexed, cached or previewed.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * `/training` — the public surface for candidates on a trial (DESIGN.md §11).
 *
 * `NoTranslate` is load-bearing here for the same reason as on the application
 * form: a browser translator rewrites text nodes under React and a Radix
 * dialog's unmount then throws, killing the root. On this surface that would
 * kill a live timed task, so the opt-out lives in the layout and covers the
 * error boundary too.
 */
export default function TrainingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NoTranslate />
      {children}
    </>
  );
}
