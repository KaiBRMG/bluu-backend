"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  inMemoryPersistence,
  setPersistence,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import { auth } from '@/firebase-config';
import { CreatorAuthProvider, useCreatorAuth } from '@/components/CreatorAuthProvider';
import { Loader } from '@/components/ui/loader';
import {
  clearTelegramInitData,
  loadTelegramWebApp,
  readTelegramInitData,
} from '@/lib/telegramWebApp';
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
 *  1. Telegram launches the webview with `initData` — a query string signed with
 *     the bot token, naming the Telegram user — in the URL fragment. Read via
 *     `readTelegramInitData`, not the SDK; see `telegramWebApp.ts`.
 *  2. `POST /api/creator/telegram/session` verifies that signature server-side,
 *     resolves the Telegram id to a creator through the link index, and returns
 *     a Firebase custom token carrying a **`tg: true` claim**. **The client
 *     never says who it is.**
 *  3. `signInWithCustomToken` starts the Firebase session `CreatorAuthProvider`
 *     and every `withCreatorAuth` route already understand — nothing downstream
 *     of this file changed.
 *
 * ── The session lock has three parts, and this file is the weakest ───────────
 *
 * **The enforcement is the `tg` claim**, checked in `withCreatorAuth` and in the
 * Firestore rules. Only step 2 above can mint it, so a session obtained any
 * other way — a leftover email/password credential, a refresh token predating
 * the cutover — reaches nothing, whatever this component renders.
 *
 * The two client-side parts stop the UI from lying about that:
 *
 *  - **`inMemoryPersistence`, set before anything else can run.** Firebase's
 *    default writes a refresh token into the webview's storage, which would keep
 *    working if the same URL were later opened in an ordinary browser on that
 *    device — a session outliving the Telegram context that authorised it. In
 *    memory, the session dies with the webview and every launch re-proves
 *    `initData`. One extra round trip per launch, which is the right trade.
 *  - **A restored session is discarded, never adopted.** `onAuthStateChanged`
 *    hands us any locally persisted user before we get a say, so `established`
 *    gates the render: a `creatorUser` this mount did not itself mint is not
 *    trusted, and the bootstrap signs it out. Gating the bootstrap on
 *    `!creatorUser` — the obvious shape — is precisely how such a session would
 *    be let through.
 *
 * ── The failure screens are not decoration ───────────────────────────────────
 * A creator who cannot get in has no support channel inside the app, so each
 * refusal says which thing went wrong — not in Telegram at all, not yet linked,
 * linked as a staff account, or account not active — and what to do about it.
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
  /**
   * True only once THIS mount has exchanged a verified Telegram launch for a
   * session. It is the client half of the session lock: without it, a Firebase
   * user restored from browser storage would satisfy `creatorUser` and render
   * the portal to someone who never came through Telegram.
   *
   * It is not the security boundary — `withCreatorAuth` and the Firestore rules
   * are, and they check the `tg` claim on the token itself. This just stops the
   * UI from showing a shell that every request behind it would refuse.
   */
  const [established, setEstablished] = useState(false);
  // One attempt per mount. `initData` does not change while the Mini App is
  // open, so a retry with the same blob would fail identically — retrying is an
  // explicit user action (the button on the error screen reloads).
  const attempted = useRef(false);

  // Every `setStatus` below sits after an await on purpose: the effect that
  // calls this must not set state synchronously (cascading renders), and
  // 'booting' already renders the loader, so there is nothing to say up front.
  const bootstrap = useCallback(async () => {
    try {
      // ── Discard anything we did not just establish ────────────────────
      // A creator signed in during the password era still has a refresh token
      // in this browser's storage, and `onAuthStateChanged` restores it before
      // we get here. Rendering the portal for that session would be the whole
      // Telegram requirement bypassed by simply having been signed in before,
      // so the session is thrown away and re-earned from `initData`.
      //
      // Order matters: persistence is switched to in-memory FIRST so that
      // nothing written from here on can outlive the webview, and only then is
      // the restored user signed out. `setPersistence` migrates the current
      // user rather than clearing it, so the explicit `signOut` is required —
      // it is not belt-and-braces.
      await setPersistence(auth, inMemoryPersistence);
      if (auth.currentUser) {
        console.warn('[CreatorPortalShell] discarding a session not minted by Telegram');
        await signOut(auth);
      }

      // The launch payload comes from the URL, not from the SDK — see
      // telegramWebApp.ts for why depending on the script is fragile. Read it
      // FIRST and synchronously, before anything can navigate and drop the
      // fragment it lives in.
      const initData = readTelegramInitData();

      // The SDK is loaded only for ready()/expand(), and its failure is not
      // ours: a webview that never chromes correctly still signs the user in.
      void loadTelegramWebApp().then((webApp) => {
        webApp?.ready();
        webApp?.expand();
      });

      if (!initData) {
        console.warn('[CreatorPortalShell] no tgWebAppData in URL, cache or SDK');
        setStatus('no-telegram');
        return;
      }

      const res = await fetch('/api/creator/telegram/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        console.warn('[CreatorPortalShell] session refused:', res.status, error);
        if (error === 'NOT_LINKED') setStatus('not-linked');
        else if (error === 'NOT_A_CREATOR') setStatus('not-a-creator');
        else if (error === 'INVALID_INIT_DATA') {
          // Expired or malformed. Drop the cached copy so a reload re-reads the
          // URL instead of replaying a payload that will never verify again.
          clearTelegramInitData();
          setStatus('no-telegram');
        } else setStatus('error');
        return;
      }

      const { customToken } = (await res.json()) as { customToken?: string };
      if (!customToken) {
        setStatus('error');
        return;
      }

      // Persistence was already set to in-memory above, before anything could
      // be restored — see the top of this function.
      await signInWithCustomToken(auth, customToken);
      // `CreatorAuthProvider`'s listener takes it from here. `established` is
      // what licenses rendering the portal: a `creatorUser` this shell did not
      // just mint is never trusted (see the render branch below).
      setEstablished(true);
    } catch (error: unknown) {
      console.error('[CreatorPortalShell] sign-in failed:', error);
      setStatus('error');
    }
  }, []);

  // Runs on mount, unconditionally. It deliberately does NOT wait for the auth
  // provider or skip when a `creatorUser` is already present: a restored session
  // is the thing this is here to discard, and gating on its absence is exactly
  // how it would be let through.
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    // Deferred out of the effect body rather than called from it: every state
    // update here belongs to the async exchange that follows, and running it
    // inline makes the mount render cascade for no benefit.
    queueMicrotask(() => void bootstrap());
  }, [bootstrap]);


  // BOTH conditions, always. `creatorUser` alone would admit a session restored
  // from storage; `established` is the assertion that this shell minted it from
  // a verified Telegram launch in this very mount.
  if (established && creatorUser) return <>{children}</>;

  // Signed in, but the provider found no active creator record for the uid and
  // signed the user straight back out — otherwise the shell would wait forever
  // on a `creatorUser` that is never coming. Derived rather than held in state:
  // it is a function of what we already know, and an effect that set it would
  // just be a synchronous re-render.
  if (established && !loading && !creatorUser) {
    return (
      <Screen
        title="Account unavailable"
        body="Your creator profile is not active at the moment. Please contact your Bluu Rock contact."
      />
    );
  }

  if (status === 'booting') return loader;

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
