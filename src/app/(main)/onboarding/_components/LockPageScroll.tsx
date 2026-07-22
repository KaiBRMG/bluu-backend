"use client";

import { useEffect } from 'react';

/**
 * Pins `html`/`body` to `overflow: hidden` for as long as onboarding is mounted.
 *
 * The onboarding shell is already `fixed inset-0`, so it contributes no document
 * height of its own. This exists because it is not the only thing in the tree:
 * `(main)/layout.tsx` mounts providers, banners and analytics as siblings, and
 * any one of them rendering something in normal flow gives the document more
 * height than the viewport — which is exactly the dead scroll region that kept
 * reappearing under the details card.
 *
 * Locking the document is the only fix that doesn't depend on auditing every
 * current and future sibling. Restores the previous values on unmount so the
 * rest of the app is untouched.
 */
export default function LockPageScroll() {
  useEffect(() => {
    const { documentElement: html, body } = document;
    const previousHtml = html.style.overflow;
    const previousBody = body.style.overflow;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      html.style.overflow = previousHtml;
      body.style.overflow = previousBody;
    };
  }, []);

  return null;
}
