'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Check, Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import { shouldPromptEmailMigration } from '@/lib/emailMigrationConfig';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';

/**
 * The one-time prompt moving a user off their `@bluurock.com` address onto their
 * own Google account.
 *
 * **Who sees it is decided entirely by `emailMigrationConfig.ts`** — this
 * component only renders the decision. The card is non-dismissible, but the
 * gating is deliberately gentle in two ways:
 *
 *  1. **Never mid-shift.** Like `UpdateAvailableBanner`, the decision latches
 *     once per app start and only when the user is clocked out. Someone working
 *     is left alone until their next launch.
 *  2. **Self-clearing.** The gate tests `workEmail` for the company domain, so
 *     the card disappears the moment the migration lands — `useUserData` is a
 *     live snapshot, so that happens without a reload.
 *
 * ── How the browser round-trip works without an Electron build ──────────────
 * `window.open` on a `_blank` target is intercepted by the shell's
 * `setWindowOpenHandler` and opened in the system browser; the existing
 * `/auth/callback` page deep-links the code back as `bluu://callback?code=…`,
 * which the main process forwards to the renderer as `oauth-callback`. So this
 * component listens on the *same* IPC channel `Login` uses.
 *
 * That is safe only because the two never coexist: `Login` renders when there is
 * no session, this card only when there is one. `removeOAuthListeners` is
 * `removeAllListeners` on those channels, so if they ever did overlap, whichever
 * unmounted last would tear out the other's handler. Keep them mutually
 * exclusive.
 */

type Phase = 'intro' | 'waiting' | 'saving' | 'done' | 'error';

export default function EmailMigrationDialog() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const { displayState, isHydrating } = useTimeTrackingContext();

  const [armed, setArmed] = useState(false);
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState<string | null>(null);
  const decidedRef = useRef(false);

  const shouldPrompt = shouldPromptEmailMigration(userData);

  // Latch ONCE per app start, after session state settles, and only for a
  // clocked-out user. Mirrors UpdateAvailableBanner: because it never re-runs,
  // clocking in later cannot retroactively dismiss the card, and clocking out
  // later cannot spring it on someone mid-task.
  useEffect(() => {
    if (decidedRef.current || isHydrating) return;
    decidedRef.current = true;
    if (!shouldPrompt) return;
    if (displayState !== 'clocked-out') return;
    setArmed(true);
  }, [isHydrating, displayState, shouldPrompt]);

  const handleCode = useCallback(async (code: string) => {
    setPhase('saving');
    setError(null);
    try {
      if (!user) throw new Error('Your session expired. Please sign in again.');
      const idToken = await user.getIdToken();
      const res = await fetch('/api/auth/migrate-email', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setPhase('error');
        return;
      }

      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setPhase('error');
    }
  }, [user]);

  // Listen for the code coming back from the system browser.
  useEffect(() => {
    if (!armed) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.auth) return;

    api.auth.onOAuthCallback((code: string) => { void handleCode(code); });
    api.auth.onOAuthError((oauthError: string) => {
      setError(`Google sign-in failed: ${oauthError}`);
      setPhase('error');
    });

    return () => api.auth.removeOAuthListeners();
  }, [armed, handleCode]);

  const startOAuth = () => {
    setPhase('waiting');
    setError(null);
    // `_blank` → setWindowOpenHandler → shell.openExternal. No native change
    // needed, which is why this whole migration ships as a web deploy.
    window.open('/auth/google?mode=migrate', '_blank', 'noopener,noreferrer');
  };

  if (!armed) return null;

  return (
    <AlertDialog open>
      <AlertDialogContent
        className="dark"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {phase === 'done' ? (
              <>
                <Check className="size-5 text-green-400" />
                You&apos;re all set
              </>
            ) : (
              <>
                <Mail className="size-5" />
                Switch to your personal email
              </>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {phase === 'done' ? (
              <>
                Bluu Backend now uses <strong className="text-foreground">{userData?.workEmail}</strong>.
                Use that account the next time you sign in — your{' '}
                <span className="whitespace-nowrap">@bluurock.com</span> address will no longer work.
              </>
            ) : (
              <>
                We&apos;re moving everyone off company email addresses. Sign in with your own
                Google account and we&apos;ll switch your Bluu Backend login over to it.
                <span className="mt-2 block">
                  You&apos;ll stay signed in — nothing else about your account changes.
                </span>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {phase === 'waiting' && (
          <p className="flex items-center gap-2 text-sm text-foreground-secondary">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            Waiting for you to finish in your browser…
          </p>
        )}

        {phase === 'saving' && (
          <p className="flex items-center gap-2 text-sm text-foreground-secondary">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            Updating your account…
          </p>
        )}

        {phase === 'error' && error && (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border p-3"
            style={{
              borderColor: 'rgba(239,68,68,0.30)',
              background: 'rgba(239,68,68,0.10)',
            }}
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" style={{ color: '#ef4444' }} />
            <p className="text-sm text-foreground-secondary">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {phase === 'done' ? (
            // No action needed: the gate stops matching as soon as the snapshot
            // lands, so the card closes itself. This button is just an
            // acknowledgement for anyone who wants one.
            <Button onClick={() => setArmed(false)}>Continue to Bluu Backend</Button>
          ) : (
            <Button onClick={startOAuth} disabled={phase === 'waiting' || phase === 'saving'}>
              {phase === 'error' ? 'Try again' : 'Continue with Google'}
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
