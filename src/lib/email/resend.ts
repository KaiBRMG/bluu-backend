import 'server-only';
import { Resend } from 'resend';

/**
 * Resend, the project's one email provider.
 *
 * TWO KEYS, deliberately:
 *   - `RESEND_API_KEY` — a **sending-only** key. Everything that sends mail uses
 *     it, so a leaked key can send as us but can read nothing.
 *   - `RESEND_INBOUND_API_KEY` — a **full-access** key, used ONLY to read a
 *     received email's body (`GET /emails/receiving/{id}`), which a sending-only
 *     key is refused (`restricted_api_key`). Kept separate so the broad key
 *     lives in exactly one code path. Falls back to `RESEND_API_KEY` for a
 *     deployment that chose to run one full-access key.
 *
 * Clients are created lazily: `new Resend()` with no key throws, and a missing
 * key must fail the one request that needed it, not the module import of every
 * route that happens to share a bundle with it.
 *
 * See documentation/creator-onboarding.md → Email.
 */

/** Every outbound message is from the address applicants already wrote to. */
export const EMAIL_FROM = 'Bluu Rock <hello@bluurock.com>';
export const EMAIL_REPLY_TO = 'hello@bluurock.com';

let sender: Resend | null = null;
let reader: Resend | null = null;

export function resendSender(): Resend {
  if (!sender) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not configured');
    sender = new Resend(key);
  }
  return sender;
}

export function resendReader(): Resend {
  if (!reader) {
    const key = process.env.RESEND_INBOUND_API_KEY || process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_INBOUND_API_KEY is not configured');
    reader = new Resend(key);
  }
  return reader;
}

export interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend dedupes on this for 24h — pass one for anything a retry could repeat. */
  idempotencyKey?: string;
  headers?: Record<string, string>;
  /** Filterable in the Resend dashboard. `[a-zA-Z0-9_-]` only. */
  tags?: { name: string; value: string }[];
}

/** Sends one message. Resolves to the Resend email id; throws on refusal. */
export async function sendEmail(args: SendArgs): Promise<string> {
  const { data, error } = await resendSender().emails.send(
    {
      from: EMAIL_FROM,
      to: [args.to],
      replyTo: EMAIL_REPLY_TO,
      subject: args.subject,
      html: args.html,
      text: args.text,
      headers: args.headers,
      tags: args.tags,
    },
    args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
  );
  if (error || !data) {
    throw new Error(`Resend refused the message: ${error?.message ?? 'no id returned'}`);
  }
  return data.id;
}
