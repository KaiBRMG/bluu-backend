/**
 * Marks the current app run as one the user explicitly logged into.
 *
 * `sessionStorage` is deliberate: it survives in-app navigation and reloads, but
 * a relaunched app gets a fresh renderer and therefore a clean slate. That is
 * exactly the distinction the incomplete-onboarding discard needs — "did this
 * run begin with a login, or with a session restored from disk?"
 *
 * Set it in `Login` immediately *before* signing in, since `onAuthStateChanged`
 * fires synchronously and `AuthWrapper` reads this on the very first snapshot.
 */
export const LOGIN_SESSION_KEY = 'bluu_login_session';

export function markLoginSession(): void {
  try {
    sessionStorage.setItem(LOGIN_SESSION_KEY, '1');
  } catch {
    /* non-fatal: worst case the user is asked to sign in again */
  }
}

export function hasLoginSession(): boolean {
  try {
    return sessionStorage.getItem(LOGIN_SESSION_KEY) === '1';
  } catch {
    // Unreadable storage must not strand a half-onboarded user in a sign-out
    // loop — assume they logged in and let them continue.
    return true;
  }
}

export function clearLoginSession(): void {
  try {
    sessionStorage.removeItem(LOGIN_SESSION_KEY);
  } catch {
    /* non-fatal */
  }
}
