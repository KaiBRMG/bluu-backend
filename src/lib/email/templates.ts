import 'server-only';
import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';
import { safeTimezone } from '@/lib/utils/timezone';
import { renderEmail, type RenderedEmail } from './layout';

/**
 * Every email the app sends. Email copy lives HERE and nowhere else.
 *
 * Each template is copy + blocks handed to `renderEmail` (`layout.ts`), which
 * owns the look and renders both the HTML and the plain-text part from the
 * same blocks. A new email goes in this file and follows the same shape —
 * never hand-written markup, never a second layout.
 */

export type { RenderedEmail };

export const MODEL_SUBMISSIONS_URL = `${PUBLIC_APP_ORIGIN}/model-submissions`;

/** Greeting name: the first word of the given name, tidied. */
export function greetingName(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^\p{L}'-]/gu, '');
  if (!clean || clean.length > 30) return 'there';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// ─── 1. Auto-reply to a creator enquiry ──────────────────────────────────────

/**
 * Sent automatically when mail to hello@ reads as a genuine creator enquiry
 * (see `inquiryFilter.ts`), and by hand from the Onboarding page's Inbox tab.
 * The wording is the client's own. No heading: it threads as a reply to the
 * sender's own email, so it should read like one.
 */
export function inquiryReplyEmail(name: string, originalSubject: string): RenderedEmail {
  return renderEmail({
    sender: 'team',
    subject: originalSubject.trim()
      ? `Re: ${originalSubject.replace(/^(re:\s*)+/i, '').slice(0, 150)}`
      : 'Thanks for messaging in',
    preheader: 'We’re looking for more creators — here’s the quick form.',
    reason: 'You’re receiving this because you got in touch with Bluu Rock.',
    blocks: [
      { kind: 'p', text: `Hey ${name}!` },
      { kind: 'p', text: 'Thanks for messaging in.' },
      {
        kind: 'p',
        text: 'We’re currently looking for more creators to join our team so you’ve messaged at the perfect time!',
      },
      {
        kind: 'p',
        text: 'For the fastest processing, please fill out our quick form and we will be able to provide you with more details.',
      },
      { kind: 'button', href: MODEL_SUBMISSIONS_URL, label: 'Open the form' },
      { kind: 'signoff', lines: ['The Bluu Rock Team'] },
      { kind: 'fallbackLink', href: MODEL_SUBMISSIONS_URL },
    ],
  });
}

// ─── 2. Welcome + personal onboarding link ───────────────────────────────────

export const WELCOME_SUBJECT = 'Welcome to BLUU ROCK 🎉';

/**
 * Sent when a reviewer confirms the "email the applicant?" card after approving
 * an application. `firstName` is the first word of the name they applied with.
 * The heading is the same line the `/join` landing greets them with.
 */
export function welcomeEmail(firstName: string, onboardingUrl: string, minutes: number): RenderedEmail {
  return renderEmail({
    sender: 'team',
    subject: WELCOME_SUBJECT,
    preheader: 'Your application has been approved. Here is your personal onboarding link.',
    reason: 'You’re receiving this because your application to Bluu Rock was approved.',
    blocks: [
      { kind: 'heading', text: `You’re in, ${firstName}.` },
      {
        kind: 'p',
        text: 'We have reviewed your application and we are **delighted to have you join our team**.',
      },
      {
        kind: 'p',
        text: `Let’s get you onboarded onto our system. We’ve set up a personal onboarding form for you — it already has the details from your application, saves as you go, and takes about ${minutes} minutes. You can stop and pick it up again any time from the same link.`,
      },
      { kind: 'button', href: onboardingUrl, label: 'Start my onboarding' },
      { kind: 'p', text: 'It covers three things:' },
      {
        kind: 'list',
        items: [
          { label: 'You', text: 'your setup, your schedule and your goals' },
          { label: 'Your limits', text: 'the content you’re comfortable creating, and what you’re not' },
          { label: 'Your persona', text: 'the character our chat team will bring to life with your fans' },
        ],
      },
      {
        kind: 'note',
        text: 'Everything you share is confidential and only seen by the Bluu Rock team. This link is personal to you, so please don’t forward it.',
      },
      { kind: 'p', text: 'Once you’re done, we’ll reach out on Telegram to get you set up.' },
      { kind: 'signoff', lines: ['Welcome aboard,', 'The Bluu Rock Team'] },
      { kind: 'fallbackLink', href: onboardingUrl },
    ],
  });
}

// ─── 3. Training sign-in code ────────────────────────────────────────────────

/** Sent to an approved training candidate to prove they hold the address (`/training`). */
export function trainingCodeEmail(code: string): RenderedEmail {
  return renderEmail({
    sender: 'system',
    replyToTeam: true,
    subject: `${code} is your Bluu Rock Training code`,
    preheader: `Your Bluu Rock Training code is ${code}.`,
    reason: 'You’re receiving this because a sign-in code was requested for this address on Bluu Rock Training.',
    blocks: [
      { kind: 'heading', text: 'Your sign-in code' },
      { kind: 'p', text: 'Enter this code on Bluu Rock Training to continue:' },
      { kind: 'code', value: code },
      { kind: 'note', text: 'It works for 10 minutes. If you did not ask for it, you can ignore this email.' },
      { kind: 'signoff', lines: ['The Bluu Rock Team'] },
    ],
  });
}

/** Where a candidate signs in — the public training front door. */
export const TRAINING_URL = `${PUBLIC_APP_ORIGIN}/training`;

/**
 * Sent when an admin adds a NEW address to a training module that is on
 * (`POST /api/admin/training/modules/[moduleId]/participants`). Names the module;
 * the button goes to the sign-in page, which emails its own code.
 */
export function trainingInviteEmail(moduleTitle: string): RenderedEmail {
  return renderEmail({
    sender: 'system',
    replyToTeam: true,
    subject: `You’ve been invited to ${moduleTitle} training`,
    preheader: `You’ve been invited to the ${moduleTitle} module on Bluu Rock Training.`,
    reason: 'You’re receiving this because this address was added to a Bluu Rock training module.',
    blocks: [
      { kind: 'heading', text: 'You’re invited to training' },
      { kind: 'p', text: `You’ve been invited to the **${moduleTitle}** training module.` },
      {
        kind: 'p',
        text: 'Open the training page and sign in with this email address. We’ll send a code to it to confirm it’s you.',
      },
      { kind: 'button', href: TRAINING_URL, label: 'Open Bluu Rock Training' },
      { kind: 'signoff', lines: ['The Bluu Rock Team'] },
      { kind: 'fallbackLink', href: TRAINING_URL },
    ],
  });
}

// ─── Shared helpers for the account emails below ─────────────────────────────

/** "Wed 28 Oct 2026, 14:05 (Africa/Harare)" — the zone named, so nobody guesses. */
function formatWhen(at: Date, timezone: string | null = null): string {
  const tz = safeTimezone(timezone);
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return `${when} (${tz})`;
}

/** Subject lines carry a person's name; keep them single-line and bounded. */
const subjectSafe = (s: string) => s.replace(/[\r\n]+/g, ' ').slice(0, 120);

// ─── 4. New sign-in (to the user who signed in) ──────────────────────────────

/** Where "Report" points for now: a direct line to the organization manager. */
export const SECURITY_REPORT_URL = 'https://t.me/KaiJN';

export interface LoginAlert {
  firstName: string;
  at: Date;
  /** The user's own zone (`users.timezone`); unset reads as UTC. */
  timezone: string | null;
  device: string | null;
  location: string | null;
  ip: string | null;
}

/** Sent after every successful sign-in to the desktop app (`/api/auth/exchange-code`). */
export function loginAlertEmail(a: LoginAlert): RenderedEmail {
  const details = [
    { label: 'When', text: formatWhen(a.at, a.timezone) },
    { label: 'Device', text: a.device || 'Bluu Rock desktop app' },
    ...(a.location ? [{ label: 'Approximate location', text: a.location }] : []),
    ...(a.ip ? [{ label: 'IP address', text: a.ip }] : []),
  ];
  return renderEmail({
    sender: 'system',
    subject: 'New sign-in to your Bluu Rock account',
    preheader: 'Your account was just signed in to on the Bluu Rock app. Not you? Report it.',
    reason: 'You’re receiving this because your Bluu Rock account was signed in to.',
    blocks: [
      { kind: 'heading', text: 'New sign-in' },
      { kind: 'p', text: `Hi ${a.firstName}, your Bluu Rock account was just signed in to on the desktop app.` },
      { kind: 'list', items: details },
      { kind: 'p', text: 'If this was you, there’s nothing to do.' },
      { kind: 'p', text: '**If it wasn’t you**, report it straight away so we can lock the account.' },
      { kind: 'button', href: SECURITY_REPORT_URL, label: 'Report' },
      { kind: 'fallbackLink', href: SECURITY_REPORT_URL },
    ],
  });
}

// ─── 5. Staff lifecycle (to the organization manager) ────────────────────────

const MANAGER_REASON = 'You’re receiving this because you’re the organization manager for Bluu Rock.';

export interface UserAdded {
  fullName: string;
  displayName: string;
  email: string;
  groupName: string;
  addedBy: string;
  at: Date;
}

/** Sent to `ORGANIZATION_MANAGER_EMAIL` when someone is registered (`POST /api/admin/users`). */
export function userAddedEmail(u: UserAdded): RenderedEmail {
  return renderEmail({
    sender: 'system',
    subject: subjectSafe(`New user added: ${u.fullName}`),
    preheader: `${u.addedBy} added ${u.fullName} to Bluu Rock.`,
    reason: MANAGER_REASON,
    blocks: [
      { kind: 'heading', text: `${u.fullName} was added` },
      {
        kind: 'p',
        text: `${u.addedBy} registered a new user in the Employee Registry. They can now sign in with the login email below.`,
      },
      {
        kind: 'list',
        items: [
          { label: 'Name', text: u.fullName },
          { label: 'Nickname', text: u.displayName },
          { label: 'Login email', text: u.email },
          { label: 'Group', text: u.groupName },
          { label: 'Added by', text: u.addedBy },
          { label: 'When', text: formatWhen(u.at) },
        ],
      },
    ],
  });
}

export type OffboardingKind = 'archived' | 'revoked' | 'deleted';

export interface UserOffboarded {
  kind: OffboardingKind;
  fullName: string;
  email: string | null;
  by: string;
  at: Date;
}

const OFFBOARDING_COPY: Record<OffboardingKind, { subject: string; heading: (n: string) => string; body: string }> = {
  archived: {
    subject: 'User archived',
    heading: (n) => `${n} was archived`,
    body: 'They have been signed out and can no longer sign in. Their data is kept, and they can be restored from the Employee Registry.',
  },
  revoked: {
    subject: 'Access revoked',
    heading: (n) => `${n}’s access was revoked`,
    body: 'They have been signed out and can no longer sign in. Their data is kept, and access can be restored from the Employee Registry.',
  },
  deleted: {
    subject: 'User deleted',
    heading: (n) => `${n} was deleted`,
    body: 'Their account and personal data were **permanently deleted**. This cannot be undone.',
  },
};

/**
 * Sent to `ORGANIZATION_MANAGER_EMAIL` when someone is archived or has access
 * revoked (`PUT /api/admin/users/[uid]`), or is deleted (`DELETE` on the same).
 */
export function userOffboardedEmail(u: UserOffboarded): RenderedEmail {
  const copy = OFFBOARDING_COPY[u.kind];
  return renderEmail({
    sender: 'system',
    subject: subjectSafe(`${copy.subject}: ${u.fullName}`),
    preheader: `${copy.heading(u.fullName)} by ${u.by}.`,
    reason: MANAGER_REASON,
    blocks: [
      { kind: 'heading', text: copy.heading(u.fullName) },
      { kind: 'p', text: copy.body },
      {
        kind: 'list',
        items: [
          { label: 'Name', text: u.fullName },
          ...(u.email ? [{ label: 'Login email', text: u.email }] : []),
          { label: 'By', text: u.by },
          { label: 'When', text: formatWhen(u.at) },
        ],
      },
    ],
  });
}

/** "First Last", falling back to the nickname, then the email — never blank. */
export function personName(u: { firstName?: unknown; lastName?: unknown; displayName?: unknown; workEmail?: unknown } | null | undefined): string {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return (
    `${str(u?.firstName)} ${str(u?.lastName)}`.trim() || str(u?.displayName) || str(u?.workEmail) || 'Unknown user'
  );
}
