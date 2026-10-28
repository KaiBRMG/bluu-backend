'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShareError, captureSupported, requestScreenShare, type ShareProblem } from './screenCapture';

export interface ScreenShare {
  supported: boolean;
  /** The live share, or null — never shared, stopped from the browser's bar, or released. */
  stream: MediaStream | null;
  busy: boolean;
  problem: ShareProblem | null;
  /** Must run from a click: `getDisplayMedia` needs a user gesture. */
  request: () => Promise<MediaStream | null>;
  /** Ends `stream` (the current share when omitted). A share started since is left alone. */
  release: (stream?: MediaStream | null) => void;
}

/**
 * Holds the candidate's screen share across the briefing and the task room. It
 * lives in `ModuleView`, above the room, so the share outlives the room's
 * unmount long enough for the recorder to flush its last segment.
 */
export function useScreenShare(): ScreenShare {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ShareProblem | null>(null);
  // Read once on the client; `navigator` is absent while rendering on the server.
  const [supported] = useState(() => typeof window === 'undefined' || captureSupported());
  const current = useRef<MediaStream | null>(null);

  const release = useCallback((target?: MediaStream | null) => {
    const s = target === undefined ? current.current : target;
    if (s && current.current === s) {
      current.current = null;
      setStream(null);
    }
    s?.getTracks().forEach((t) => t.stop());
  }, []);

  const request = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      const next = await requestScreenShare();
      current.current?.getTracks().forEach((t) => t.stop());
      current.current = next;
      // "Stop sharing" in the browser's bar, or the screen going away.
      next.getVideoTracks()[0].addEventListener('ended', () => {
        if (current.current !== next) return;
        current.current = null;
        setStream(null);
      });
      setStream(next);
      return next;
    } catch (error) {
      setProblem(error instanceof ShareError ? error.problem : 'failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  // Leaving the page ends the share; the browser would otherwise keep its bar up.
  useEffect(() => () => current.current?.getTracks().forEach((t) => t.stop()), []);

  return { supported, stream, busy, problem, request, release };
}

/** What each problem means for the candidate, and what to do about it. Rendered by `ShareButton`. */
export const SHARE_PROBLEM_TEXT: Record<ShareProblem, string> = {
  unsupported:
    'This browser cannot share your screen. Use Chrome, Edge, Firefox or Safari on a laptop or desktop computer. Phones and tablets cannot take this test.',
  denied:
    'Screen sharing was cancelled or blocked. Choose Share your screen and allow it. On a Mac, if your browser is not allowed to record the screen, open System Settings → Privacy & Security → Screen & System Audio Recording, turn your browser on, then quit and reopen it.',
  'not-screen': 'Choose your entire screen in the sharing window, not a single window or tab.',
  blank:
    'We received a black screen. On a Mac, open System Settings → Privacy & Security → Screen & System Audio Recording, turn your browser on, then quit and reopen it.',
  failed: 'Screen sharing did not start. Try again, or try another browser.',
};
