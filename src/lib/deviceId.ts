/**
 * The client half of device identity.
 *
 * A device id is a random UUID minted once per browser profile (or per Electron
 * renderer install) and kept in localStorage forever. It is the thing that
 * associates *this* client with a `users` doc in the database, and it is what
 * replaced "one session token per user" as the unit of session enforcement —
 * see `sessionService.ts` and `useUserData`.
 *
 * Two properties matter and are easy to break:
 *
 *  • It is minted LAZILY, on first read, not only at login. A share page opened
 *    by someone who has never signed in on this browser still needs an id to ask
 *    "is this device registered?" with.
 *
 *  • Minting one grants nothing. An id only means something once the server has
 *    bound it to a uid (`device-sessions/{deviceId}`), which only ever happens
 *    behind a completed Google sign-in. A forged or copied id resolves to
 *    nothing, so this is an identifier, never a credential.
 */

const DEVICE_ID_KEY = 'bluu_device_id';

/** Where this client is running. Decides the session policy the server applies. */
export type DeviceKind = 'desktop' | 'web';

function mint(): string {
  // `randomUUID` is unavailable on insecure origins and in a few older WebViews;
  // the fallback is only an id, not a secret, so `Math.random` is acceptable
  // there — see the note above about ids granting nothing on their own.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * This client's device id, minting and persisting one on first call.
 *
 * Returns `null` on the server and in any browser that refuses storage (private
 * mode, blocked site data). Every caller must treat that as "unidentifiable"
 * and fall back to the legacy behaviour rather than failing — a user with
 * cookies disabled must still be able to sign in.
 */
export function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const next = mint();
    window.localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return null;
  }
}

/** Whether this client is the Electron shell or an ordinary browser. */
export function getDeviceKind(): DeviceKind {
  if (typeof window === 'undefined') return 'web';
  return window.electronAPI?.isElectron ? 'desktop' : 'web';
}

/**
 * A human label for the session list, derived from the user agent.
 *
 * Deliberately coarse — this is for "Chrome on Windows", not fingerprinting.
 */
export function getDeviceLabel(): string {
  if (typeof window === 'undefined') return 'Unknown device';
  const ua = window.navigator.userAgent;
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua)
      ? 'macOS'
      : /Android/i.test(ua)
        ? 'Android'
        : /iPhone|iPad|iPod/i.test(ua)
          ? 'iOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Unknown OS';

  if (getDeviceKind() === 'desktop') return `Bluu desktop app · ${os}`;

  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\//i.test(ua)
      ? 'Opera'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Chrome\//i.test(ua)
          ? 'Chrome'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : 'Browser';
  return `${browser} · ${os}`;
}
