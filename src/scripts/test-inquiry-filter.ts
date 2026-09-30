/**
 * Fixture check for the hello@ rules filter (`src/lib/email/inquiryFilter.ts`).
 *
 * Pure — sends nothing, reads nothing. Run from src/ after changing any rule:
 *   node --experimental-strip-types scripts/test-inquiry-filter.ts
 *
 * Every fixture states the verdict it must get. Add the real email that fooled
 * the filter here before changing a rule, so the fix is pinned.
 */
// Node's type stripping needs the explicit extension; the Next tsconfig does not allow it.
// @ts-ignore TS5097
import { classifyInquiry, type InboundEmail, type InquiryVerdict } from '../lib/email/inquiryFilter.ts';

/** Mirrors `greetingName` in lib/email/templates.ts (server-only, so not importable here). */
const greetingName = (name: string | null) => {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^\p{L}'-]/gu, '');
  return !clean || clean.length > 30 ? 'there' : clean.charAt(0).toUpperCase() + clean.slice(1);
};

const relay = (fields: { name: string; email: string; subject: string; message: string }): InboundEmail => ({
  from: 'wordpress@bluurock.com',
  fromHeader: 'WordPress <wordpress@bluurock.com>',
  subject: `New message: ${fields.subject}`,
  text: `Name: ${fields.name}\nEmail: ${fields.email}\nSubject: ${fields.subject}\nMessage: ${fields.message}\n\n--\nThis e-mail was sent from a contact form on Bluu Rock`,
  headers: {},
  authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
});

const direct = (from: string, subject: string, text: string, extra: Partial<InboundEmail> = {}): InboundEmail => ({
  from,
  fromHeader: from,
  subject,
  text,
  headers: {},
  authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
  ...extra,
});

const cases: { name: string; email: InboundEmail; expect: InquiryVerdict; replyTo?: string; greet?: string }[] = [
  {
    name: 'the sample enquiry (Bruno, contact form)',
    email: relay({
      name: 'Bruno',
      email: 'bruno@rekorder.be',
      subject: 'Need onlyfans management',
      message:
        "I'm looking to relaunch my OnlyFans account, which had some early momentum but has since stalled, or start a new one. My persona is a confident, dominant dandy Daddy-type character, and I produce high quality content consistently since I'm a professional video creator by trade. I'm looking for an agency that can help me rebuild traction and scale revenue with a more strategic approach to promotion and fan engagement.",
    }),
    expect: 'reply',
    replyTo: 'bruno@rekorder.be',
    greet: 'Bruno',
  },
  {
    // The website form sends FROM hello@ TO hello@ — the applicant's address
    // is only in the body. Must reply to the body address, not loop to hello@.
    name: 'website form sent from hello@ to hello@',
    email: {
      from: 'hello@bluurock.com',
      fromHeader: 'Bluu Rock <hello@bluurock.com>',
      subject: 'Need onlyfans management',
      text: [
        'Name: Bruno',
        'Email: bruno@rekorder.be',
        'Subject: Need onlyfans management',
        'Message: I want to relaunch my OnlyFans account and I am looking for an agency to manage it and grow my fans.',
      ].join('\n'),
      headers: {},
    },
    expect: 'reply',
    replyTo: 'bruno@rekorder.be',
    greet: 'Bruno',
  },
  {
    name: 'website form with the email field left empty (loop guard)',
    email: {
      from: 'hello@bluurock.com',
      subject: 'OnlyFans',
      text: ['Name: Sam', 'Subject: OnlyFans', 'Message: I am a creator looking for management for my OnlyFans.'].join('\n'),
      headers: {},
    },
    expect: 'system',
  },
  {
    name: 'short direct enquiry',
    email: direct('"Jay Smith" <jay.smith@gmail.com>'.replace(/.*<|>/g, ''), 'Joining', 'Hi, I would love to join your agency as a model. I have an OF with 2k subscribers.', {
      fromHeader: '"Jay Smith" <jay.smith@gmail.com>',
    }),
    expect: 'reply',
    replyTo: 'jay.smith@gmail.com',
    greet: 'Jay',
  },
  {
    name: 'vague but human — held, not answered',
    email: direct('sam@outlook.com', 'Hello', 'Hi there, can you tell me more about what you do? Thanks, Sam'),
    expect: 'held',
  },
  {
    name: 'SEO pitch via the contact form',
    email: relay({
      name: 'Mark',
      email: 'mark@seoagency.io',
      subject: 'Increase your traffic',
      message:
        'Dear Sir/Madam, I noticed your website is not on the first page of Google. Our SEO team offers backlinks and guest post services to rank your website. Reply STOP to opt out.',
    }),
    expect: 'spam',
  },
  {
    name: 'marketing pitch that says "content" and "management"',
    email: relay({
      name: 'Priya',
      email: 'priya@growthlabs.co',
      subject: 'Social media management services',
      message:
        'Hi, we provide social media marketing services and content management for brands. We can increase your sales with lead generation. Visit https://a.co https://b.co https://c.co',
    }),
    expect: 'spam',
  },
  {
    name: 'crypto scam',
    email: direct('invest@quickprofit.biz', 'URGENT OPPORTUNITY', 'Bitcoin investment opportunity, 300% returns guaranteed. bit.ly/xyz'),
    expect: 'spam',
  },
  {
    name: 'forged sender (DMARC fail) with creator words',
    email: direct('ceo@bigbank.com', 'OnlyFans creator', 'I am a creator and want management for my OnlyFans', {
      authentication: { spf: 'fail', dkim: 'fail', dmarc: 'fail' },
    }),
    expect: 'held',
  },
  {
    name: 'Gmail forwarding confirmation',
    email: direct('forwarding-noreply@google.com', '(#123) Gmail Forwarding Confirmation', 'Please click the link below to confirm: https://mail-settings.google.com/mail/vf-abc'),
    expect: 'system',
  },
  {
    name: 'bounce',
    email: direct('mailer-daemon@googlemail.com', 'Delivery Status Notification (Failure)', 'Address not found'),
    expect: 'system',
  },
  {
    name: 'newsletter (List-Unsubscribe)',
    email: direct('hello@newsletter-tool.com', 'This week in creator news', 'Creators, OnlyFans, management tips...', {
      headers: { 'list-unsubscribe': '<mailto:unsub@x.com>' },
    }),
    expect: 'system',
  },
  {
    name: 'an out-of-office auto-reply',
    email: direct('someone@gmail.com', 'Out of office', 'I am away until Monday.', { headers: { 'auto-submitted': 'auto-replied' } }),
    expect: 'system',
  },
  {
    name: 'gibberish bot',
    email: relay({ name: 'xkqzvbnm', email: 'xkqzvbnm@mail.ru', subject: 'hgfdsqwrt', message: 'zxcvbnmqwrt plkjhgfdsz qwrtypsdfgh mnbvcxzlkjh' }),
    expect: 'spam',
  },
  {
    name: 'name field is a URL',
    email: relay({ name: 'www.cheap-followers.xyz', email: 'bot@spam.xyz', subject: 'OnlyFans growth', message: 'Get OnlyFans subscribers fast for your creator account' }),
    expect: 'spam',
  },
  {
    name: 'reply address is our own domain (loop guard)',
    email: relay({ name: 'Test', email: 'hello@bluurock.com', subject: 'test', message: 'OnlyFans creator management test' }),
    expect: 'system',
  },
];

let failed = 0;
for (const c of cases) {
  const r = classifyInquiry(c.email);
  const problems: string[] = [];
  if (r.verdict !== c.expect) problems.push(`verdict ${r.verdict}, expected ${c.expect}`);
  if (c.replyTo && r.replyTo !== c.replyTo) problems.push(`replyTo ${r.replyTo}, expected ${c.replyTo}`);
  if (c.greet && greetingName(r.name) !== c.greet) problems.push(`greeting ${greetingName(r.name)}, expected ${c.greet}`);
  if (problems.length) {
    failed += 1;
    console.log(`✗ ${c.name}\n    ${problems.join('; ')}\n    score ${r.score}, relevance ${r.relevance}: ${r.reasons.join(' | ')}`);
  } else {
    console.log(`✓ ${c.name} → ${r.verdict} (score ${r.score}, relevance ${r.relevance})`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nAll ${cases.length} passed`);
process.exit(failed ? 1 : 0);
