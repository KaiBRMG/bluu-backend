import { ONBOARDING_STEPS } from './steps';

/**
 * Per-step resume for the onboarding flow.
 *
 * Every step records itself here on mount (via `OnboardingCard`), and the guard
 * in `AuthWrapper` reads it back when an incomplete user re-enters the app — so
 * closing the window, a macOS "Quit & Reopen" after granting Screen Recording,
 * or a crash lands the user back on the step they left, not at the start.
 *
 * **localStorage, keyed by uid, is deliberate.** The permission steps are
 * per-machine facts (an OS grant on this Mac says nothing about another), so a
 * device-local store is the right granularity, and it costs no Firestore write
 * per step (rule 9). Keyed by uid so a second account on the same machine does
 * not inherit someone else's position.
 *
 * It is a convenience, never a gate: an unreadable or missing entry falls back
 * to the start of the permissions leg, and nothing here can skip a step that
 * writes a flag — `hasAcceptedTerms` and `hasCompletedOnboarding` are still
 * decided by the user doc alone.
 */

const RESUME_KEY_PREFIX = 'bluu_onboarding_step:';

/** The first permissions-leg step — the fallback once terms are accepted. */
export const ONBOARDING_RESUME_FALLBACK = '/onboarding/permissions';

/**
 * Steps a user may be resumed onto once terms are accepted. Excludes `welcome`
 * (terms are already done) and `done` (only reachable after completion, at
 * which point the guard never fires).
 */
const RESUMABLE_PATHS: ReadonlySet<string> = new Set(
  ONBOARDING_STEPS.map((s) => s.path).filter(
    (p) => p !== '/onboarding/welcome' && p !== '/onboarding/done',
  ),
);

export function saveOnboardingStep(uid: string, path: string): void {
  try {
    localStorage.setItem(RESUME_KEY_PREFIX + uid, path);
  } catch {
    /* non-fatal: worst case the user resumes at the permissions step */
  }
}

/** Where a terms-accepted, not-yet-complete user should land on re-entry. */
export function getOnboardingResumePath(uid: string): string {
  try {
    const saved = localStorage.getItem(RESUME_KEY_PREFIX + uid);
    if (saved && RESUMABLE_PATHS.has(saved)) return saved;
  } catch {
    /* fall through */
  }
  return ONBOARDING_RESUME_FALLBACK;
}

export function clearOnboardingStep(uid: string): void {
  try {
    localStorage.removeItem(RESUME_KEY_PREFIX + uid);
  } catch {
    /* non-fatal */
  }
}

/* -------------------------------------------------------------------------- */
/* Screen-capture step: per-MACHINE state (not per uid — an OS grant belongs   */
/* to the machine).                                                            */
/* -------------------------------------------------------------------------- */

const SCREEN_PROMPTED_KEY = 'bluu_onboarding_screen_prompted';

/**
 * TEMPORARY (see CLAUDE.md, screenshot TCC repair): the onboarding-step
 * `tccutil reset` must fire at most ONCE per machine. It used to fire on every
 * mount of the screen step — so after the user granted Screen Recording and
 * macOS relaunched the app ("Quit & Reopen"), returning to the step wiped the
 * grant they had just made, removed the app from the Screen Recording list,
 * and looped them forever.
 */
const TCC_RESET_DONE_KEY = 'bluu_onboarding_tcc_reset_done';

export function hasPromptedScreenCapture(): boolean {
  try {
    return localStorage.getItem(SCREEN_PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markScreenCapturePrompted(): void {
  try {
    localStorage.setItem(SCREEN_PROMPTED_KEY, '1');
  } catch {
    /* non-fatal */
  }
}

/**
 * Claims the once-per-machine onboarding TCC reset. Returns true exactly once;
 * the marker is written BEFORE the reset runs, so a crash or relaunch mid-reset
 * can never cause a second one. If storage is unreadable it returns false —
 * skipping a repair is harmless, repeating it is the loop this exists to stop.
 */
export function claimOnboardingTccReset(): boolean {
  try {
    if (localStorage.getItem(TCC_RESET_DONE_KEY) === '1') return false;
    localStorage.setItem(TCC_RESET_DONE_KEY, '1');
    return localStorage.getItem(TCC_RESET_DONE_KEY) === '1';
  } catch {
    return false;
  }
}
