import 'server-only';
import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';

/**
 * THE email template. Every message Resend sends is built here — `sendEmail`
 * accepts only a `RenderedEmail`, and only `renderEmail` can mint one, so an
 * email that skips the template does not type-check.
 *
 * An email is described as a list of BLOCKS, and both parts are rendered from
 * that one list: the HTML through the template below, the plain-text part by
 * hand-tuned rules (a button becomes "Label: url" on its own line, not a bare
 * URL mid-sentence, which is what Resend's auto-generated text would do). So a
 * new email is copy + blocks; it never writes markup.
 *
 * The look is deliberately LIGHT, with plain colours and no tricks. Every mail
 * app's dark mode (Gmail, Outlook, Apple Mail…) is built to turn a light
 * email dark — and does it cleanly. A dark-designed email is the case those
 * modes get wrong (Gmail iOS inverts it back into grey-on-grey), so this
 * template does not fight them: it gives them the input they expect.
 *
 * Three rules keep that true — keep them when adding a block:
 *   - Solid colours only, set inline. No `background-image` fills, no blend
 *     modes, no per-client dark-mode CSS.
 *   - Colour-on-colour only where it survives inversion either way: the
 *     button is white on `BUTTON` (#007db0), which reads 4.6:1 as authored and
 *     becomes dark-on-light-blue when inverted. Brand azure (#00b8f5) with dark
 *     ink would invert to light-on-azure at ~2:1, so it is not used here.
 *   - Brand that must not change lives in an IMAGE, which no client recolours:
 *     the lockup PNG carries its own dark plate (`public/email/wordmark.png`,
 *     built by `scripts/build-email-wordmark.js`).
 *
 * Contrast on white: INK 18:1 · SOFT 9.6:1 · MUTED 5.9:1 · LINK 6:1 · button 4.6:1.
 */

// ─── Tokens ──────────────────────────────────────────────────────────────────

const PAGE = '#ffffff';
const PANEL = '#f3f5f8';
const PANEL_EDGE = '#dde2e8';
const HAIRLINE = '#e3e7ec';
const INK = '#12171d';
const SOFT = '#3d4650';
const MUTED = '#5b6570';
const LINK = '#0068a0';
/** Button fill — white on it reads 4.6:1. */
const BUTTON = '#007db0';
const WHITE = '#ffffff';

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace`;
const WIDTH = 560;

// ─── Blocks ──────────────────────────────────────────────────────────────────

/**
 * Inline text accepts one markup: `**bold**`. Everything else is escaped, so
 * names and other user-supplied values can be interpolated straight in.
 */
export type EmailBlock =
  /** The one large line at the top of a message. At most one per email. */
  | { kind: 'heading'; text: string }
  | { kind: 'p'; text: string }
  /** Secondary copy: reassurance, small print, "ignore this if…". */
  | { kind: 'note'; text: string }
  /** The single primary action. Pair it with a `fallbackLink` further down. */
  | { kind: 'button'; href: string; label: string }
  /** "Button not working?" — the raw URL, for clients that strip the button. HTML only. */
  | { kind: 'fallbackLink'; href: string }
  /** A short value the reader types somewhere else: a sign-in code. */
  | { kind: 'code'; value: string }
  | { kind: 'list'; items: { label: string; text: string }[] }
  /** The closing lines, e.g. ['Welcome aboard,', 'The Bluu Rock Team']. */
  | { kind: 'signoff'; lines: string[] };

/**
 * Who the email is from — chosen per email, because it decides whether a reply
 * reaches anyone:
 *   - `team`   — `hello@bluurock.com`, the address applicants already write to.
 *                For mail that invites a reply (the enquiry reply threads with
 *                the sender's own email).
 *   - `system` — `backend@bluurock.com`, a NO-REPLY address for everything
 *                automated (sign-in codes, security and staff alerts). The
 *                footer says so and points to hello@ instead.
 */
export type EmailSender = 'team' | 'system';

const SENDERS: Record<EmailSender, { from: string; replyTo: string | null }> = {
  team: { from: 'Bluu Rock <hello@bluurock.com>', replyTo: 'hello@bluurock.com' },
  system: { from: 'Bluu Rock <backend@bluurock.com>', replyTo: null },
};

export interface EmailSpec {
  sender: EmailSender;
  subject: string;
  /** The inbox preview line. Write it; never let a client scrape the first paragraph. */
  preheader: string;
  blocks: EmailBlock[];
  /** One honest sentence in the footer saying why this person got this email. */
  reason: string;
}

declare const rendered: unique symbol;

/** What `sendEmail` takes. Only `renderEmail` produces one. */
export interface RenderedEmail {
  readonly from: string;
  /** Null for the no-reply sender: nothing is set, and the footer says so. */
  readonly replyTo: string | null;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly [rendered]: true;
}

export const SUPPORT_EMAIL = 'hello@bluurock.com';

// ─── Rendering ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes, then turns `**x**` into white bold — the only inline markup. */
function inline(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, `<strong style="font-weight:700;color:${INK};">$1</strong>`);
}

function plain(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1');
}

const text = (size: number, color: string, extra = '', lineHeight = 1.6) =>
  `font-family:${FONT};font-size:${size}px;line-height:${lineHeight};color:${color};${extra}`;

function blockHtml(b: EmailBlock): string {
  switch (b.kind) {
    case 'heading':
      return `<h1 style="margin:0 0 20px;${text(28, INK, 'font-weight:700;letter-spacing:-0.01em;', 1.2)}">${inline(b.text)}</h1>`;
    case 'p':
      return `<p style="margin:0 0 16px;${text(16, INK)}">${inline(b.text)}</p>`;
    case 'note':
      return `<p style="margin:0 0 16px;${text(14, SOFT)}">${inline(b.text)}</p>`;
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 28px;"><tr>
  <td bgcolor="${BUTTON}" style="border-radius:10px;background:${BUTTON};mso-padding-alt:15px 28px;">
    <a href="${esc(b.href)}" target="_blank" style="display:inline-block;padding:15px 28px;${text(16, WHITE, 'font-weight:700;text-decoration:none;border-radius:10px;', 1.2)}">${esc(b.label)}</a>
  </td>
</tr></table>`;
    case 'fallbackLink':
      return `<p style="margin:0 0 16px;${text(13, MUTED, '', 1.5)}">Button not working? Paste this into your browser:<br><a href="${esc(b.href)}" target="_blank" style="color:${LINK};text-decoration:underline;word-break:break-all;">${esc(b.href)}</a></p>`;
    case 'code':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>
  <td bgcolor="${PANEL}" style="background:${PANEL};border:1px solid ${PANEL_EDGE};border-radius:12px;padding:18px 24px 18px 30px;">
    <span style="font-family:${MONO};font-size:36px;line-height:1;font-weight:700;letter-spacing:0.3em;color:${INK};font-variant-numeric:tabular-nums;">${esc(b.value)}</span>
  </td>
</tr></table>`;
    case 'list':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;border-top:1px solid ${HAIRLINE};">
${b.items
  .map(
    (i) => `  <tr><td style="padding:14px 0;border-bottom:1px solid ${HAIRLINE};${text(15, SOFT, '', 1.5)}"><strong style="display:block;margin:0 0 2px;font-weight:700;color:${INK};">${esc(i.label)}</strong>${inline(i.text)}</td></tr>`,
  )
  .join('\n')}
</table>`;
    case 'signoff':
      return `<p style="margin:8px 0 24px;${text(16, INK)}">${b.lines.map(inline).join('<br>')}</p>`;
  }
}

function blockText(b: EmailBlock): string | null {
  switch (b.kind) {
    case 'heading':
    case 'p':
    case 'note':
      return plain(b.text);
    case 'button':
      return `${b.label}: ${b.href}`;
    case 'fallbackLink':
      return null; // the button line already carries the URL
    case 'code':
      return `    ${b.value}`;
    case 'list':
      return b.items.map((i) => `  • ${i.label} — ${plain(i.text)}`).join('\n');
    case 'signoff':
      return b.lines.map(plain).join('\n');
  }
}

/** The footer's lines, shared by both parts. Plain text; escaped by the HTML side. */
function footerLines(spec: EmailSpec): string[] {
  const lines = [spec.reason];
  if (spec.sender === 'system') {
    lines.push(`This is an automated message from a no-reply address. To reach us, email ${SUPPORT_EMAIL}.`);
  }
  return lines;
}

function page(spec: EmailSpec): string {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(spec.subject)}</title>
<style>
  body { margin:0; padding:0; background:${PAGE}; -webkit-text-size-adjust:100%; }
  @media (max-width:600px) {
    .bluu-pad { padding-left:20px !important; padding-right:20px !important; }
    .bluu-body h1 { font-size:24px !important; }
  }
</style>
</head>
<body bgcolor="${PAGE}" style="margin:0;padding:0;background:${PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(spec.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background:${PAGE};">
  <tr><td align="center" style="padding:32px 0;">
    <!--[if mso]><table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${WIDTH}px;">
      <tr><td class="bluu-pad" style="padding:0 32px 32px;">
        <a href="${PUBLIC_APP_ORIGIN}" target="_blank" style="text-decoration:none;"><img src="${PUBLIC_APP_ORIGIN}/email/wordmark.png" width="172" height="56" alt="Bluu Rock" style="display:block;border:0;outline:none;width:172px;height:56px;color:${INK};font-family:${FONT};font-size:16px;font-weight:700;letter-spacing:0.14em;"></a>
      </td></tr>
      <tr><td class="bluu-pad bluu-body" style="padding:0 32px 12px;">
${spec.blocks.map(blockHtml).join('\n')}
      </td></tr>
      <tr><td class="bluu-pad" style="padding:0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${HAIRLINE};padding:20px 0 0;${text(12, MUTED)}">
          ${footerLines(spec).map(esc).join('<br>')}<br>
          Bluu Rock &middot; <a href="mailto:${SUPPORT_EMAIL}" style="color:${MUTED};text-decoration:underline;">${SUPPORT_EMAIL}</a>
        </td></tr></table>
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr>
</table>
</body>
</html>`;
}

/** Renders an email spec into the subject, HTML and plain-text parts Resend sends. */
export function renderEmail(spec: EmailSpec): RenderedEmail {
  const body = spec.blocks
    .map(blockText)
    .filter((t): t is string => t !== null)
    .join('\n\n');
  const textPart = `${body}\n\n--\n${footerLines(spec).join('\n')}\nBluu Rock · ${SUPPORT_EMAIL}\n`;
  const { from, replyTo } = SENDERS[spec.sender];
  return { from, replyTo, subject: spec.subject, html: page(spec), text: textPart } as RenderedEmail;
}
