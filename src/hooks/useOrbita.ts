'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GoLoginOrbitaState } from '@/types/electron';

const IDLE: GoLoginOrbitaState = {
  phase: 'idle',
  version: null,
  receivedBytes: 0,
  totalBytes: 0,
  error: null,
};

/** The two phases during which the window must not let anyone do anything else. */
export function isOrbitaBusy(state: GoLoginOrbitaState): boolean {
  return state.phase === 'downloading' || state.phase === 'installing';
}

/**
 * Orbita's install state, straight from the main process.
 *
 * **Why this is not only an onboarding concern.** The Orbita major version a
 * profile needs is read from that profile's own user agent, so a perfectly
 * onboarded operator can click Launch and find themselves waiting on a
 * several-hundred-megabyte download. Main reports it either way, and
 * `isOrbitaBusy` is what the window blocks on — see `OrbitaGate`.
 *
 * Main is the source of truth: this reads a snapshot on mount and then follows
 * `gologin:orbita-changed`. Nothing polls.
 */
export function useOrbita() {
  const api = typeof window !== 'undefined' ? window.electronAPI?.gologin : undefined;
  // `orbitaStatus` is absent on builds before v0.11.0, so the whole feature is
  // feature-detected rather than assumed — an old shell shows "update Bluu".
  const supported = !!api?.orbitaStatus;
  const [state, setState] = useState<GoLoginOrbitaState>(IDLE);
  const [installedVersions, setInstalledVersions] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Derived, not an effect that writes `false` on an unsupported build — that
  // write is a cascading render (`react-hooks/set-state-in-effect`). An old
  // shell has nothing to load, so it is never loading.
  const loading = supported && !loaded;

  useEffect(() => {
    if (!api?.orbitaStatus || !api.onOrbitaChanged) return;
    let alive = true;

    void api.orbitaStatus().then((current) => {
      if (!alive || !current) return;
      setState(current);
      setInstalledVersions(current.installedVersions ?? []);
      setLoaded(true);
    });

    api.onOrbitaChanged((next) => {
      if (!alive) return;
      setState(next);
      // A finished install adds a version; re-reading the whole status here
      // would be a second IPC round trip per progress tick.
      if (next.phase === 'ready' && typeof next.version === 'number') {
        setInstalledVersions((prev) => (prev.includes(next.version as number) ? prev : [...prev, next.version as number]));
      }
    });

    return () => {
      alive = false;
      // `removeAllListeners` on the channel — safe only because this hook is
      // mounted once per window. Two subscribers would tear out each other's
      // handlers, the same trap as the OAuth callback channel.
      api.removeOrbitaChangedListeners?.();
    };
  }, [api]);

  /** Download Orbita if it is missing. Idempotent; a second call adopts the first. */
  const ensure = useCallback(
    async (version?: number) => {
      if (!api?.ensureOrbita) return { success: false, error: 'unsupported' };
      return api.ensureOrbita(version);
    },
    [api],
  );

  return {
    state,
    supported,
    loading,
    installedVersions,
    installed: installedVersions.length > 0,
    busy: isOrbitaBusy(state),
    ensure,
  };
}
