/**
 * Client-side access to the Telegram Mini App launch data.
 *
 * The thing we actually need is `initData` — the signed query string naming the
 * Telegram user — which the server verifies against the bot token
 * (`verifyTelegramInitData`). Everything here is about getting hold of it
 * reliably, because there are three ways it can go missing and only one of them
 * is "the user is not in Telegram".
 *
 * ── Why this does not just use `window.Telegram.WebApp` ─────────────────────
 *
 * The SDK is a convenience wrapper over data Telegram has *already* put in the
 * URL: it launches the webview at `…#tgWebAppData=<initData>&tgWebAppVersion=…`
 * and the script simply parses that fragment. Depending on the script alone adds
 * two failure modes for no benefit — the CDN can be slow or blocked, and the
 * fragment can be lost before the script ever runs.
 *
 * So the fragment is read **directly and first**, and the SDK is used only for
 * the things it genuinely owns (`ready()`, `expand()`).
 *
 * ── The three ways it goes missing ──────────────────────────────────────────
 *
 *  1. **A redirect ate the fragment.** A fragment is client-side only and is
 *     re-attached across a 3xx by the browser — *usually*. Telegram's in-app
 *     webviews are not reliable about it. Fixed at the source by pointing the
 *     chat menu button straight at `/creator/dashboard` instead of `/creator`,
 *     which used to 307 (see `setCreatorPortalMenuButton`), but a stale menu
 *     button on an already-linked creator still points at the old URL — so this
 *     must survive it.
 *  2. **A client-side navigation replaced the URL.** The App Router rewrites
 *     `location` on navigation and the fragment does not come along. The first
 *     read is therefore cached in `sessionStorage`.
 *  3. **A reload inside the webview.** Firebase persistence is `inMemoryPersistence`
 *     (deliberately — see `CreatorPortalShell`), so any reload re-runs the
 *     exchange and needs the blob again. Same cache covers it.
 *
 * **Caching it is not a widening of the session.** `sessionStorage` dies with
 * the webview exactly as the in-memory Firebase session does, it is scoped to
 * this origin, and the blob is re-verified server-side on every exchange —
 * signature *and* `auth_date` freshness. It cannot outlive the launch it
 * belongs to in any way the token itself could not.
 */

const SDK_SRC = 'https://telegram.org/js/telegram-web-app.js';
const CACHE_KEY = 'tg_init_data';

export interface TelegramWebApp {
  initData: string;
  ready: () => void;
  expand: () => void;
  colorScheme?: string;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** Pull `tgWebAppData` out of the fragment or the query string. */
function readFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  for (const source of [window.location.hash.replace(/^#/, ''), window.location.search.replace(/^\?/, '')]) {
    if (!source) continue;
    const value = new URLSearchParams(source).get('tgWebAppData');
    if (value) return value;
  }
  return null;
}

function readCache(): string | null {
  try {
    return window.sessionStorage.getItem(CACHE_KEY);
  } catch {
    // Storage can throw outright in a locked-down webview. Not fatal — it only
    // means a reload will not find it.
    return null;
  }
}

function writeCache(value: string): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY, value);
  } catch {
    /* see readCache */
  }
}

/**
 * The signed launch payload, or null when this is genuinely not a Mini App
 * launch. Cheap and synchronous — no network, no SDK.
 */
export function readTelegramInitData(): string | null {
  if (typeof window === 'undefined') return null;

  const fromUrl = readFromUrl();
  if (fromUrl) {
    writeCache(fromUrl);
    return fromUrl;
  }

  const cached = readCache();
  if (cached) return cached;

  // Last resort: the SDK, if it happens to have loaded and parsed something we
  // did not. Should never win, but costs nothing to ask.
  const fromSdk = window.Telegram?.WebApp?.initData;
  return fromSdk || null;
}

/** Clear the cached blob. Called when the server rejects it, so a stale or
 *  expired payload cannot be retried forever on every reload. */
export function clearTelegramInitData(): void {
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* see readCache */
  }
}

let pending: Promise<TelegramWebApp | null> | null = null;

/**
 * Load Telegram's SDK, for `ready()` / `expand()` only — **never** as the source
 * of `initData` (see the header). Resolves null on failure rather than hanging;
 * the portal must be able to sign someone in with the SDK blocked entirely.
 */
export function loadTelegramWebApp(): Promise<TelegramWebApp | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  if (pending) return pending;

  pending = new Promise<TelegramWebApp | null>((resolve) => {
    const settle = () => resolve(window.Telegram?.WebApp ?? null);

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    if (existing) {
      // It may already have finished, in which case no `load` event is coming.
      if (window.Telegram?.WebApp) return settle();
      existing.addEventListener('load', settle);
      existing.addEventListener('error', () => resolve(null));
      return;
    }

    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.addEventListener('load', settle);
    script.addEventListener('error', () => resolve(null));
    document.head.appendChild(script);

    // A blocked CDN can leave a request hanging without firing `error`. The
    // portal does not need the SDK to sign anyone in, so cap the wait rather
    // than letting it hold the loader open.
    setTimeout(settle, 4000);
  });

  return pending;
}
