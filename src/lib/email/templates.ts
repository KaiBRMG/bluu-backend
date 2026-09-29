import 'server-only';
import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';
import { AZURE, AZURE_INK } from '@/lib/publicSkin';

/**
 * The two emails the recruiting funnel sends. Copy lives HERE and nowhere else,
 * the way notification copy lives only in `notificationContent.ts`.
 *
 * Each template returns `{ subject, html, text }`. The text part is written by
 * hand, not derived: Resend would auto-generate one from the HTML, but a
 * generated plain-text version reads the button as a bare URL mid-sentence.
 *
 * HTML is table-based with inline styles because that is what mail clients
 * render. The masthead is the app icon (a PNG — Outlook does not render the
 * WebP lockup) beside a text wordmark, on a dark band, so the brand reads the
 * same in light- and dark-mode clients.
 */

export const MODEL_SUBMISSIONS_URL = `${PUBLIC_APP_ORIGIN}/model-submissions`;

/** Greeting name for the reply: the first word of the given name, tidied. */
export function greetingName(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^\p{L}'-]/gu, '');
  if (!clean || clean.length > 30) return 'there';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

function layout(preheader: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Bluu Rock</title>
</head>
<body style="margin:0;padding:0;background:#eef1f4;">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-radius:14px;overflow:hidden;background:#ffffff;">
      <tr><td style="background:#08090b;padding:22px 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;"><img src="${PUBLIC_APP_ORIGIN}/logo/bluu-logo.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:8px;"></td>
          <td style="vertical-align:middle;padding-left:12px;font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:0.14em;color:#ffffff;">BLUU ROCK</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px 28px 12px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1b2127;">
        ${inner}
      </td></tr>
      <tr><td style="padding:8px 28px 28px;font-family:${FONT};font-size:12px;line-height:1.5;color:#5b6570;">
        Bluu Rock &middot; <a href="mailto:hello@bluurock.com" style="color:#5b6570;">hello@bluurock.com</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 28px;"><tr>
  <td style="border-radius:10px;background:${AZURE};">
    <a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:${AZURE_INK};text-decoration:none;border-radius:10px;">${esc(label)}</a>
  </td>
</tr></table>`;
}

const p = (html: string) => `<p style="margin:0 0 16px;">${html}</p>`;

// ─── 1. Auto-reply to a creator enquiry ──────────────────────────────────────

/**
 * Sent automatically when mail to hello@ reads as a genuine creator enquiry
 * (see `inquiryFilter.ts`), and by hand from the Onboarding page's Inbox tab.
 * The wording is the client's own.
 */
export function inquiryReplyEmail(name: string, originalSubject: string): RenderedEmail {
  const subject = originalSubject.trim()
    ? `Re: ${originalSubject.replace(/^(re:\s*)+/i, '').slice(0, 150)}`
    : 'Thanks for messaging in';

  const text = [
    `Hey ${name}!`,
    '',
    'Thanks for messaging in.',
    '',
    'We’re currently looking for more creators to join our team so you’ve messaged at the perfect time!',
    '',
    'For the fastest processing, please fill out our quick form and we will be able to provide you with more details.',
    '',
    `Form: ${MODEL_SUBMISSIONS_URL}`,
    '',
    'The Bluu Rock Team',
  ].join('\n');

  const html = layout(
    'We’re looking for more creators — here’s the quick form.',
    [
      p(`Hey ${esc(name)}!`),
      p('Thanks for messaging in.'),
      p('We’re currently looking for more creators to join our team so you’ve messaged at the perfect time!'),
      p('For the fastest processing, please fill out our quick form and we will be able to provide you with more details.'),
      button(MODEL_SUBMISSIONS_URL, 'Open the form'),
      p(`<span style="font-size:13px;color:#5b6570;">Or paste this link: <a href="${MODEL_SUBMISSIONS_URL}" style="color:#0077a8;">${MODEL_SUBMISSIONS_URL}</a></span>`),
      p('The Bluu Rock Team'),
    ].join('\n'),
  );

  return { subject, html, text };
}

// ─── 2. Welcome + personal onboarding link ───────────────────────────────────

export const WELCOME_SUBJECT = 'Welcome to BLUU ROCK 🎉';

/**
 * Sent when a reviewer confirms the "email the applicant?" card after approving
 * an application. `firstName` is the first word of the name they applied with.
 */
export function welcomeEmail(firstName: string, onboardingUrl: string, minutes: number): RenderedEmail {
  const text = [
    `Hi ${firstName},`,
    '',
    'We have reviewed your application and we are delighted to have you join our team.',
    '',
    `Let’s get you onboarded onto our system. We’ve set up a personal onboarding form for you — it already has the details from your application, saves as you go, and takes about ${minutes} minutes. You can stop and pick it up again any time from the same link:`,
    '',
    onboardingUrl,
    '',
    'It covers three things:',
    '  • You — your setup, your schedule and your goals',
    '  • Your limits — the content you’re comfortable creating, and what you’re not',
    '  • Your persona — the character our chat team will bring to life with your fans',
    '',
    'Everything you share is confidential and only seen by the Bluu Rock team. The link is personal to you, so please don’t forward it.',
    '',
    'Once you’re done, we’ll reach out on Telegram to get you set up.',
    '',
    'Welcome aboard,',
    'The Bluu Rock Team',
  ].join('\n');

  const li = (label: string, rest: string) =>
    `<tr><td style="padding:0 0 10px;font-family:${FONT};font-size:15px;line-height:1.5;color:#1b2127;"><strong>${label}</strong> &mdash; ${rest}</td></tr>`;

  const html = layout(
    'Your application has been approved. Here is your personal onboarding link.',
    [
      p(`Hi ${esc(firstName)},`),
      p('We have reviewed your application and we are <strong>delighted to have you join our team</strong>.'),
      p(
        `Let’s get you onboarded onto our system. We’ve set up a personal onboarding form for you — it already has the details from your application, saves as you go, and takes about ${minutes} minutes. You can stop and pick it up again any time from the same link.`,
      ),
      button(onboardingUrl, 'Start my onboarding'),
      p('It covers three things:'),
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
        ${li('You', 'your setup, your schedule and your goals')}
        ${li('Your limits', 'the content you’re comfortable creating, and what you’re not')}
        ${li('Your persona', 'the character our chat team will bring to life with your fans')}
      </table>`,
      p(
        '<span style="font-size:14px;color:#3d4650;">Everything you share is confidential and only seen by the Bluu Rock team. This link is personal to you, so please don’t forward it.</span>',
      ),
      p('Once you’re done, we’ll reach out on Telegram to get you set up.'),
      p('Welcome aboard,<br>The Bluu Rock Team'),
      p(
        `<span style="font-size:12px;color:#5b6570;">Button not working? Paste this into your browser:<br><a href="${esc(onboardingUrl)}" style="color:#0077a8;word-break:break-all;">${esc(onboardingUrl)}</a></span>`,
      ),
    ].join('\n'),
  );

  return { subject: WELCOME_SUBJECT, html, text };
}
