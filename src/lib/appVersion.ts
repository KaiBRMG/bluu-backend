// Client-side accessor for the installed Electron app version + platform.
// Returns nulls in a plain browser or on older Electron builds that don't yet
// expose app.getVersion (feature-detected). Cached after the first resolve.

export interface AppInfo {
  appVersion: string | null;
  platform: string | null;
}

let cached: AppInfo | null = null;
let inflight: Promise<AppInfo> | null = null;

export async function getAppInfo(): Promise<AppInfo> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    let appVersion: string | null = null;
    let platform: string | null = null;
    try {
      if (api?.app?.getVersion) appVersion = await api.app.getVersion();
      if (api?.app?.getPlatform) platform = await api.app.getPlatform();
    } catch {
      // Non-critical — leave as nulls
    }
    cached = { appVersion, platform };
    return cached;
  })();

  return inflight;
}

/** Synchronous best-effort read; returns nulls until getAppInfo() has resolved once. */
export function getCachedAppInfo(): AppInfo {
  return cached ?? { appVersion: null, platform: null };
}

// ─── Version floors ──────────────────────────────────────────────────
//
// Comparing the installed shell against a minimum. This is a real question in
// this app, not a defensive nicety: the web bundle updates the moment Vercel
// deploys, while the native shell only changes when a user quits and reinstalls
// — and some of them do not quit for weeks (rule 9c). So a page whose feature
// needs main-process code that shipped in build N is routinely rendered by a
// renderer running inside build N−2.
//
// These lived privately in `Sidebar.tsx`, where the GoLogin satellite used them.
// They moved here when the Snipping Tool needed the same comparison from a page
// as well as from the rail — two copies of version arithmetic is exactly the
// kind of thing that drifts into disagreeing about what "0.13.0" means.

/** `1.2.3` → comparable tuple. Ignores any pre-release suffix. */
export function parseVersion(value: string): number[] {
  return String(value)
    .split('-')[0]
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
}

/**
 * True when `version` is at least `minimum`.
 *
 * **Returns false when the version is unknown** — no IPC, no answer, an
 * unparseable string. A feature gated on a version is gated because the build
 * has to carry specific main-process code, and "I could not tell" is not
 * evidence that it does. Callers that must distinguish "too old" from "still
 * asking" need to track that themselves; see `useAppVersion`.
 */
export function meetsMinVersion(version: string | null | undefined, minimum: string): boolean {
  if (!version) return false;
  const actual = parseVersion(version);
  const required = parseVersion(minimum);
  for (let i = 0; i < Math.max(actual.length, required.length); i++) {
    const a = actual[i] ?? 0;
    const b = required[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}
