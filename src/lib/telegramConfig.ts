/**
 * Telegram identifiers that are safe on the client.
 *
 * **Nothing secret lives here.** The bot token, the webhook secret and every
 * call to the Bot API belong to `lib/services/telegramService.ts`, which is
 * server-only. This file holds the public names — the ones that appear in a
 * `t.me` URL a user clicks — so a component can render a link without importing
 * the service and dragging `TELEGRAM_BOT_TOKEN` into the bundle.
 *
 * ▸ **`BOT_USERNAME` is the deep-link namespace.** `t.me/<bot>?start=<payload>`
 *   is how a one-time link hands its token to the bot: Telegram delivers the
 *   payload as `/start <payload>` in the first message, which the webhook then
 *   consumes. That is the whole linking mechanism.
 *
 * ▸ **`MINI_APP_SHORT_NAME` is a different address to the same bot** — the Mini
 *   App, configured in BotFather. Opening `t.me/<bot>/<shortName>` loads the
 *   creator portal inside Telegram's webview with a signed `initData` payload.
 *   The URL BotFather points it at must be on `PUBLIC_APP_ORIGIN`, not the
 *   vercel.app host: `setChatMenuButton` refuses a `web_app` URL on a domain the
 *   bot has not had registered, and Electron's `BASE_URL` host is not that
 *   domain. See `publicOrigin.ts` and electron.md.
 */

export const TELEGRAM_BOT_USERNAME = 'BluuRockBot';

/** The Mini App's short name as registered in BotFather. */
export const TELEGRAM_MINI_APP_SHORT_NAME = 'BluuBackend';

export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

/** Direct link to the creator portal Mini App. */
export const TELEGRAM_MINI_APP_URL = `${TELEGRAM_BOT_URL}/${TELEGRAM_MINI_APP_SHORT_NAME}`;

/**
 * The one-time link a user clicks to bind their Telegram account.
 *
 * Telegram caps the `start` payload at 64 characters from `[A-Za-z0-9_-]`, which
 * is exactly why the token is base64url rather than hex-with-padding or a UUID
 * with dashes-and-braces. `mintTelegramLinkToken` produces 43 characters; do not
 * widen it without re-checking that limit — Telegram silently drops an
 * over-long payload rather than erroring, which would look like a token that
 * simply never works.
 */
export function buildTelegramStartLink(token: string): string {
  return `${TELEGRAM_BOT_URL}?start=${token}`;
}
