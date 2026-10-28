import 'server-only';
import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';
import { AZURE, AZURE_INK } from '@/lib/publicSkin';

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
 * The look is the public skin (DESIGN.md §8) carried into the inbox: the
 * #08090b ground, the Bluu lockup, white-inked type, Bluu azure as the ONE
 * voice (the button and links) with `AZURE_INK` on any
 * azure fill. The ground is pinned dark (`color-scheme: dark`) so clients that
 * repaint light emails leave it alone. Mail-client constraints shape the rest:
 * tables and inline styles, solid hex instead of rgba (Outlook), a PNG lockup
 * (Gmail drops SVG, Outlook drops WebP), and the stage wash as a progressive
 * gradient over a solid `bgcolor` that every client honours.
 *
 * Contrast on the ground: INK 18.6:1 · SOFT 8.6:1 · MUTED 5.5:1 · azure 8.6:1.
 */

// ─── Tokens ──────────────────────────────────────────────────────────────────

// GROUND is `STAGE_GROUND`'s colour and PANEL is `PASS_SURFACE`, both in
// `app/model-submissions/_lib/theme.ts`; repeated here as plain hex because the
// email must not depend on an app route's module. Change them together.
const GROUND = '#08090b';
const PANEL = '#12171d';
const PANEL_EDGE = '#262d35';
const HAIRLINE = '#1f252c';
const INK = '#f2f5f8';
const SOFT = '#a3acb6';
const MUTED = '#7f8892';

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
  <td bgcolor="${AZURE}" style="border-radius:10px;background:${AZURE};mso-padding-alt:15px 28px;">
    <a href="${esc(b.href)}" target="_blank" style="display:inline-block;padding:15px 28px;${text(16, AZURE_INK, 'font-weight:700;text-decoration:none;border-radius:10px;', 1.2)}">${esc(b.label)}</a>
  </td>
</tr></table>`;
    case 'fallbackLink':
      return `<p style="margin:0 0 16px;${text(13, MUTED, '', 1.5)}">Button not working? Paste this into your browser:<br><a href="${esc(b.href)}" target="_blank" style="color:${AZURE};text-decoration:underline;word-break:break-all;">${esc(b.href)}</a></p>`;
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
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(spec.subject)}</title>
<style>
  :root { color-scheme: dark; supported-color-schemes: dark; }
</style>
<style>
  body { margin:0; padding:0; background:${GROUND}; -webkit-text-size-adjust:100%; }
  a { color:${AZURE}; }
  @media (max-width:600px) {
    .bluu-pad { padding-left:20px !important; padding-right:20px !important; }
    .bluu-body h1 { font-size:24px !important; }
  }
</style>
</head>
<body bgcolor="${GROUND}" style="margin:0;padding:0;background:${GROUND};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(spec.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="background-color:${GROUND};background-image:radial-gradient(ellipse 90% 340px at 50% 0,#0b2a3a,${GROUND} 75%);background-repeat:no-repeat;">
  <tr><td align="center" style="padding:40px 0 32px;">
    <!--[if mso]><table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${WIDTH}px;">
      <tr><td class="bluu-pad" style="padding:0 32px 36px;">
        <a href="${PUBLIC_APP_ORIGIN}" target="_blank" style="text-decoration:none;"><img src="${PUBLIC_APP_ORIGIN}/email/wordmark.png" width="140" height="24" alt="Bluu Rock" style="display:block;border:0;outline:none;width:140px;height:24px;color:${INK};font-family:${FONT};font-size:16px;font-weight:700;letter-spacing:0.14em;"></a>
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
