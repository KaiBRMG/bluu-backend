import type { Metadata } from 'next';
import { NoTranslate } from '@/app/model-submissions/_components/NoTranslate';

export const metadata: Metadata = {
  title: 'Welcome · Bluu Rock',
  description: 'Your personal Bluu Rock onboarding.',
  // A personal link. Never indexed, never cached, never previewed with content.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The personal onboarding link (`/join/<token>`), sent in the "Welcome to
 * BLUU ROCK 🎉" email. Same skin and same crash guard as `/model-submissions`
 * (DESIGN.md §8): `NoTranslate` stops a browser translator rewriting text nodes
 * under React, which killed that form's root once — and this form is longer.
 */
export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NoTranslate />
      {children}
    </>
  );
}
