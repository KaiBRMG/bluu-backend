"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { inMemoryPersistence, setPersistence, signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/firebase-config';
import { CreatorAuthProvider, useCreatorAuth } from '@/components/CreatorAuthProvider';
import { Loader } from '@/components/ui/loader';
import { loadTelegramWebApp } from '@/lib/telegramWebApp';
import { TELEGRAM_MINI_APP_URL } from '@/lib/telegramConfig';
import { PRIMARY_BTN } from './theme';

/**
 * The creator portal's front door.
 *
 * **Telegram is the only way in.** There is no email/password screen any more:
 * the portal is a Telegram Mini App, and a session exists only for someone who
 * opened it from inside Telegram as an account bound to a creator record.
 *
 * ── How a session is established ─────────────────────────────────────────────
 *
 *  1. Telegram's SDK exposes `WebApp.initData` — a query string signed with the
 *     bot token, naming the Telegram user who launched the app.
 *  2. `POST /api/creator/telegram/session` verifies that signature server-side,
 *     resolves the Telegram id to a creator through the link index, and returns
 *     a Firebase custom token. **The client never says who it is.**
 *  3. `signInWithCustomToken` starts the Firebase session `CreatorAuthProvider`
 *     and every `withCreatorAuth` route already understand — nothing downstream
 *     of this file changed.
 *
 * ── Why persistence is in-memory ─────────────────────────────────────────────
 *
 * This is the line that makes "the portal opens only via the Telegram account
 * accessing it" actually true. Firebase's default (`browserLocalPersistence`)
 * writes a refresh token into the webview's storage, which would keep working if
 * the same URL were later opened in an ordinary browser on that device — a
 * session outliving the Telegram context that authorised it. In memory, the
 * session dies with the webview and every launch re-proves `initData`.
 *
 * The cost is one extra round trip per launch, which is the right trade: this is
 * the whole security property of the portal.
 *
 * ── The failure screens are not decoration ───────────────────────────────────
 * A creator who cannot get in has no support channel inside the app, so each
 * refusal says which of the three things went wrong — not in Telegram at all,
 * not yet linked, or linked as a staff account — and what to do about it.
 */

type Status =
  /** Loading the SDK and exchanging initData. Renders the loader. */
  | 'booting'
  /** Opened outside Telegram (a plain browser, or the SDK failed to load). */
  | 'no-telegram'
  /** Verified Telegram user, but no creator is bound to it. */
  | 'not-linked'
  /** Bound — to an employee account, not a creator. */
  | 'not-a-creator'
  /** Network or server failure. Retryable. */
  | 'error';

function Screen({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-black px-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900/80 p-8 text-center backdrop-blur-md">
        <img src="/logo/bluu_long.svg" alt="Bluu" className="mx-auto mb-6 h-10 w-auto" />
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">{body}</p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className={`mt-6 w-full rounded-lg px-6 py-3 font-semibold transition-colors ${PRIMARY_BTN}`}
          >
            {action.label}
          </button>
        )}
      </div>
    </main>
  );
}

const loader = (
  <div className="flex min-h-dvh items-center justify-center bg-black">
    <Loader />
  </div>
);

function CreatorAuthWrapper({ children }: { children: React.ReactNode }) {
  const { creatorUser, loading } = useCreatorAuth();
  const [status, setStatus] = useState<Status>('booting');
  // One attempt per mount. `initData` does not change while the Mini App is
  // open, so a retry with the same blob would fail identically — retrying is an
  // explicit user action (the button on the error screen reloads).
  const attempted = useRef(false);

  // Every `setStatus` below sits after an await on purpose: the effect that
  // calls this must not set state synchronously (cascading renders), and
  // 'booting' already renders the loader, so there is nothing to say up front.
  const bootstrap = useCallback(async () => {
    try {
      const webApp = await loadTelegramWebApp();
      if (!webApp || !webApp.initData) {
        setStatus('no-telegram');
        return;
      }

      webApp.ready();
      webApp.expand();

      const res = await fetch('/api/creator/telegram/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: webApp.initData }),
      });

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        if (error === 'NOT_LINKED') setStatus('not-linked');
        else if (error === 'NOT_A_CREATOR') setStatus('not-a-creator');
        else if (error === 'INVALID_INIT_DATA') setStatus('no-telegram');
        else setStatus('error');
        return;
      }

      const { customToken } = (await res.json()) as { customToken?: string };
      if (!customToken) {
        setStatus('error');
        return;
      }

      // Before the sign-in, always — see the header comment.
      await setPersistence(auth, inMemoryPersistence);
      await signInWithCustomToken(auth, customToken);
      // `CreatorAuthProvider`'s listener takes it from here.
    } catch (error: unknown) {
      console.error('[CreatorPortalShell] sign-in failed:', error);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (creatorUser) return;
    if (attempted.current) return;
    attempted.current = true;
    // Deferred out of the effect body rather than called from it: every state
    // update here belongs to the async exchange that follows, and running it
    // inline makes the mount render cascade for no benefit.
    queueMicrotask(() => void bootstrap());
  }, [loading, creatorUser, bootstrap]);

  if (creatorUser) return <>{children}</>;
  if (loading || status === 'booting') return loader;

  const openInTelegram = () => window.open(TELEGRAM_MINI_APP_URL, '_blank', 'noopener,noreferrer');

  switch (status) {
    case 'no-telegram':
      return (
        <Screen
          title="Open in Telegram"
          body="The Creator Portal now runs inside Telegram. Open it from the Bluu Rock bot — or tap the Creator Portal button in your chat with the bot."
          action={{ label: 'Open in Telegram', onClick: openInTelegram }}
        />
      );
    case 'not-linked':
      return (
        <Screen
          title="Account not connected"
          body="This Telegram account isn't connected to a Bluu Rock creator profile yet. Ask your Bluu Rock contact to send you your personal connection link."
        />
      );
    case 'not-a-creator':
      return (
        <Screen
          title="Staff account"
          body="This Telegram account is connected to a Bluu Backend staff account. The Creator Portal is for creator profiles only."
        />
      );
    default:
      return (
        <Screen
          title="Something went wrong"
          body="We couldn't sign you in just now. Check your connection and try again."
          action={{ label: 'Try again', onClick: () => window.location.reload() }}
        />
      );
  }
}

export function CreatorPortalShell({ children }: { children: React.ReactNode }) {
  return (
    <CreatorAuthProvider>
      <CreatorAuthWrapper>{children}</CreatorAuthWrapper>
    </CreatorAuthProvider>
  );
}
