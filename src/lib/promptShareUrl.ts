import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';

/**
 * The public URL for a shared prompt.
 *
 * Built from {@link PUBLIC_APP_ORIGIN}, never from `window.location.origin` —
 * inside Electron that resolves to the host the shell is pinned to, and this
 * link is specifically for people who are not inside Electron.
 *
 * The `/p/` prefix is allowlisted in `src/middleware.ts`; without that entry
 * every recipient would be rewritten to `/desktop-only`.
 */
export function promptShareUrl(shareId: string): string {
  return `${PUBLIC_APP_ORIGIN}/p/${shareId}`;
}

/** The deep link that hands a prompt back to the desktop app. */
export function promptDeepLink(promptId: string): string {
  return `bluu://prompt?id=${encodeURIComponent(promptId)}`;
}
