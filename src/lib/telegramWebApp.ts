/**
 * Client-side access to the Telegram Mini App SDK.
 *
 * `window.Telegram.WebApp` only exists once Telegram's own script has loaded,
 * and that script is injected here rather than through `next/script`: the shell
 * needs an explicit await point ("is the SDK ready, and is there an `initData`
 * to exchange?") before it can decide between signing in and showing the
 * "open in Telegram" screen, and `beforeInteractive` in a nested layout is not
 * that. One injection per document, memoised on the promise.
 *
 * Everything this returns is **untrusted**. `initData` is a signed blob that the
 * server verifies against the bot token (`verifyTelegramInitData`);
 * `initDataUnsafe` is the same content *without* the signature check, which is
 * why it is only ever read for cosmetics, never for identity. Do not add a call
 * site that trusts it.
 */

const SDK_SRC = 'https://telegram.org/js/telegram-web-app.js';

export interface TelegramWebApp {
  /** The signed launch payload. Empty string when there is none. */
  initData: string;
  ready: () => void;
  expand: () => void;
  colorScheme?: string;
  openTelegramLink?: (url: string) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

let pending: Promise<TelegramWebApp | null> | null = null;

export function loadTelegramWebApp(): Promise<TelegramWebApp | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  if (pending) return pending;

  pending = new Promise<TelegramWebApp | null>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    const script = existing ?? document.createElement('script');

    const settle = () => resolve(window.Telegram?.WebApp ?? null);
    script.addEventListener('load', settle);
    // A blocked or offline script must resolve null, not hang — the portal has a
    // real screen for "you are not in Telegram", and a spinner forever is not it.
    script.addEventListener('error', () => resolve(null));

    if (!existing) {
      script.src = SDK_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return pending;
}
