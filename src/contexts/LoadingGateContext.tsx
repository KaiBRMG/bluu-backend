"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";

interface LoadingGateApi {
  /** Add/remove a keyed gate. While any gate is registered, the app's boot
   *  LoadingScreen stays up. */
  setGate: (key: string, loading: boolean) => void;
}

const LoadingGateContext = createContext<LoadingGateApi | null>(null);

/**
 * Lets descendant widgets hold the boot LoadingScreen until their own async data
 * has loaded. AppLayout provides this and is notified (via `onPendingChange`)
 * whenever the set of pending gates becomes empty/non-empty.
 */
export function LoadingGateProvider({
  children,
  onPendingChange,
}: {
  children: React.ReactNode;
  onPendingChange: (hasPending: boolean) => void;
}) {
  const pending = useRef<Set<string>>(new Set());
  // Keep the latest callback in a ref so `setGate` stays referentially stable and
  // doesn't churn the `useLoadingGate` effect on every render.
  const onChange = useRef(onPendingChange);
  onChange.current = onPendingChange;

  const setGate = useCallback((key: string, loading: boolean) => {
    const set = pending.current;
    const had = set.has(key);
    if (loading === had) return; // no change
    if (loading) set.add(key);
    else set.delete(key);
    onChange.current(set.size > 0);
  }, []);

  return (
    <LoadingGateContext.Provider value={{ setGate }}>
      {children}
    </LoadingGateContext.Provider>
  );
}

/**
 * Registers a loading gate. While `loading` is true, the boot LoadingScreen
 * (rendered by AppLayout) stays up. The gate is cleared automatically on unmount.
 */
export function useLoadingGate(key: string, loading: boolean) {
  const ctx = useContext(LoadingGateContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setGate(key, loading);
    return () => ctx.setGate(key, false);
  }, [ctx, key, loading]);
}
