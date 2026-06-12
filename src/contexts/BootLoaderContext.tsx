"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import LoadingScreen from "@/components/LoadingScreen";

// Minimum time the boot loader stays up so its animation plays at least one full
// cycle, even if everything is ready sooner. Aesthetic floor, not a fixed
// duration — if loading takes longer, the loader simply stays until it's ready.
// Also bridges the brief hand-offs between boot phases (auth → data → widgets)
// so the loader never blinks while one phase clears before the next registers.
const MIN_LOADER_MS = 3000;

interface BootLoaderApi {
  /** Add/remove a keyed loading phase. While any phase is pending (or the
   *  minimum display time hasn't elapsed), the boot loader stays up. */
  setPhase: (key: string, loading: boolean) => void;
}

const BootLoaderContext = createContext<BootLoaderApi | null>(null);

/**
 * Renders a single, persistent boot LoadingScreen above the entire app so the
 * loader's <video> element stays mounted for the whole boot — no remount, no
 * animation restart, no flicker. The loader covers the app until every
 * registered phase (auth, user data, page permissions, home widgets) has
 * cleared and the minimum display time has elapsed. Once that first boot
 * completes, the loader never reappears (in-app navigation uses each view's own
 * skeletons) until a full app reload.
 */
export function BootLoaderProvider({ children }: { children: React.ReactNode }) {
  const phases = useRef<Set<string>>(new Set());
  // Start pending: the app always boots in a loading state, before any phase
  // has had a chance to register.
  const [hasPending, setHasPending] = useState(true);
  const [minElapsed, setMinElapsed] = useState(false);
  const [booted, setBooted] = useState(false);

  const setPhase = useCallback((key: string, loading: boolean) => {
    const set = phases.current;
    const had = set.has(key);
    if (loading === had) return; // no change
    if (loading) set.add(key);
    else set.delete(key);
    setHasPending(set.size > 0);
  }, []);

  // Minimum-display timer, anchored to app start (when the loader first appears).
  useEffect(() => {
    const id = setTimeout(() => setMinElapsed(true), MIN_LOADER_MS);
    return () => clearTimeout(id);
  }, []);

  const show = !booted && (hasPending || !minElapsed);

  // Latch the boot as complete the first time everything is ready, so the loader
  // never reappears for the rest of the session.
  useEffect(() => {
    if (!show) setBooted(true);
  }, [show]);

  return (
    <BootLoaderContext.Provider value={{ setPhase }}>
      {children}
      {show && <LoadingScreen />}
    </BootLoaderContext.Provider>
  );
}

/**
 * Registers a boot loading phase. While `loading` is true during the initial
 * boot, the persistent LoadingScreen stays up. Cleared automatically on unmount.
 * After boot completes this is a no-op as far as the loader is concerned.
 */
export function useBootPhase(key: string, loading: boolean) {
  const ctx = useContext(BootLoaderContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setPhase(key, loading);
    return () => ctx.setPhase(key, false);
  }, [ctx, key, loading]);
}
