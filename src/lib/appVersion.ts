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
