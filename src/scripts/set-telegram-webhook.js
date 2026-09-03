#!/usr/bin/env node
/**
 * Point the Telegram bot at our webhook. Run once per environment, and again
 * whenever the URL or the secret changes.
 *
 *   cd src && node scripts/set-telegram-webhook.js
 *   cd src && node scripts/set-telegram-webhook.js --url https://staging.example.com
 *   cd src && node scripts/set-telegram-webhook.js --info      # just show current state
 *   cd src && node scripts/set-telegram-webhook.js --delete    # unhook the bot
 *
 * A script rather than an admin route on purpose: this is a once-per-environment
 * setup step, and an HTTP endpoint that can re-point the bot is a redirect of
 * every future account link to wherever the caller says — not a button worth
 * having in the product for a thing done twice.
 *
 * Reads `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` from `src/.env.local`.
 * **The secret is what authenticates every delivery** — the route rejects any
 * request without it — so it must be set here and in Vercel to the same value,
 * and it must not be blank. Generate one with:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ORIGIN = 'https://bluu-backend.vercel.app';

function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? true;
}

async function call(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  return res.json();
}

async function main() {
  loadEnvLocal();

  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set (src/.env.local).');
    process.exit(1);
  }

  if (arg('info')) {
    console.log(JSON.stringify(await call(token, 'getWebhookInfo'), null, 2));
    return;
  }

  if (arg('delete')) {
    console.log(JSON.stringify(await call(token, 'deleteWebhook'), null, 2));
    return;
  }

  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    console.error(
      'TELEGRAM_WEBHOOK_SECRET is not set. Without it the webhook route rejects\n' +
      'every delivery, so registering the URL now would just break linking.\n' +
      'Generate one:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
    process.exit(1);
  }

  const origin = (typeof arg('url') === 'string' ? arg('url') : DEFAULT_ORIGIN).replace(/\/$/, '');
  const url = `${origin}/api/telegram/webhook`;

  const result = await call(token, 'setWebhook', {
    url,
    secret_token: secret,
    // Only the update type the webhook handles. Anything else is bandwidth and
    // log noise for a route that ignores it.
    allowed_updates: ['message'],
    // Telegram queues updates while a webhook is unset; adopting that backlog on
    // first registration would replay stale `/start`s against live tokens.
    drop_pending_updates: true,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
  console.log(`\nWebhook set: ${url}`);
  console.log('Set the SAME TELEGRAM_WEBHOOK_SECRET in Vercel, or deliveries will 401.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
