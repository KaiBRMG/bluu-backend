/**
 * Classifying a notification's `actionUrl` — internal app route vs. somewhere
 * else entirely.
 *
 * Pure and dependency-free on purpose: both the client
 * (`notificationNavigation.ts`, which is `'use client'` and pulls in the
 * navigation watchdog) and the server (`/api/admin/notifications`, which
 * normalises before storing) must agree on this, and neither can import the
 * other.
 *
 * ── Why this is not just `startsWith('http')` ────────────────────────────────
 * It used to be. An admin who typed `www.example.com` into the external-URL
 * field stored exactly that, the check missed it, and the tray called
 * `router.push('www.example.com')` — which navigates the Electron window to a
 * path that does not exist and 404s, instead of opening the browser. A
 * scheme-less host is the *normal* way people type a URL, so the classifier has
 * to recognise it rather than treat it as an app route.
 *
 * The rule: an internal route is a path starting with `/`. Everything else that
 * names a host is external. Every `actionUrl` this app produces (see
 * `notificationContent.ts` and the app-page picker in the create dialog) is an
 * absolute path, so nothing internal is misread.
 */

export type NotificationActionTarget =
  /** An app route to hand to the App Router. Always starts with `/`. */
  | { kind: 'internal'; href: string }
  /** An absolute URL to open outside the app. Always carries a safe scheme. */
  | { kind: 'external'; href: string }
  /** Nothing to do — empty, or a scheme we refuse to act on. */
  | { kind: 'none' };

/** Schemes we are willing to hand to the OS. Mirrors `openExternalSafe` in `electron/main.js`. */
const SAFE_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Looks like a bare host (`example.com`, `www.example.com/path`, `a.co:8080`)
 * rather than a relative app path: there is a dot before the first `/`, `?` or
 * `#`. Deliberately conservative — a scheme-less value that does *not* look like
 * a host is treated as an app path, not force-fed to the browser.
 */
function looksLikeBareHost(value: string): boolean {
  const authority = value.split(/[/?#]/, 1)[0];
  return authority.includes('.') && !authority.endsWith('.');
}

/**
 * Decide what a stored `actionUrl` means. Never throws.
 *
 * `javascript:`, `file:`, `data:` and friends resolve to `none`: they are
 * neither a route to push nor a URL we will pass to the shell. (Electron's
 * `openExternalSafe` blocks them too — this stops them one layer earlier, and
 * stops the App Router being handed one.)
 */
export function classifyNotificationAction(
  actionUrl: string | null | undefined,
): NotificationActionTarget {
  const raw = actionUrl?.trim();
  if (!raw) return { kind: 'none' };

  // Protocol-relative (`//example.com`) — external, and must never be pushed as
  // a route. Checked before the `/` test, which it would otherwise satisfy.
  if (raw.startsWith('//')) return { kind: 'external', href: `https:${raw}` };

  if (raw.startsWith('/')) return { kind: 'internal', href: raw };

  if (HAS_SCHEME.test(raw)) {
    try {
      const { protocol } = new URL(raw);
      return SAFE_EXTERNAL_SCHEMES.has(protocol)
        ? { kind: 'external', href: raw }
        : { kind: 'none' };
    } catch {
      return { kind: 'none' };
    }
  }

  // Scheme-less. A bare host is what an admin typing a URL by hand produces.
  if (looksLikeBareHost(raw)) return { kind: 'external', href: `https://${raw}` };

  // A relative-ish path with no leading slash. Treat as an app route.
  return { kind: 'internal', href: `/${raw}` };
}

/**
 * The canonical form to persist, or `null` for "no action".
 *
 * Call this before writing an `actionUrl` so the value in Firestore is already
 * unambiguous — a stored `https://…` cannot later be misread as a route, no
 * matter which surface reads it.
 */
export function normalizeActionUrl(actionUrl: string | null | undefined): string | null {
  const target = classifyNotificationAction(actionUrl);
  return target.kind === 'none' ? null : target.href;
}
