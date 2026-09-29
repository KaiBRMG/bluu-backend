/**
 * Rules-only triage for mail arriving at hello@bluurock.com.
 *
 * Pure: no I/O, no clock, no Firestore — the webhook hands it a parsed email and
 * acts on the verdict. That is what lets `scripts/test-inquiry-filter.ts`
 * exercise it against real-shaped samples without sending anything.
 *
 * THE POSTURE. An auto-reply is outbound mail from our domain, so a false
 * positive costs more than a false negative: replying to spam teaches the
 * sender the inbox is live, and replying to a forged address makes us a
 * backscatter source that damages hello@'s reputation. So the filter only
 * auto-replies when it has POSITIVE evidence of a creator enquiry and no strong
 * spam evidence. Anything it is unsure of is `held` — logged on the Onboarding
 * page's Inbox tab, where a person can send the reply with one click — never
 * silently dropped. Every mail still lands in Gmail regardless; this decides
 * only whether the app answers it.
 *
 * Verdicts:
 *   - `reply`  — a genuine enquiry; send the templated reply.
 *   - `held`   — plausible but unproven; a human decides.
 *   - `spam`   — confident junk; logged, never answered.
 *   - `system` — machine mail (bounces, Gmail's forwarding confirmation,
 *                newsletters); logged, never answered.
 */

export type InquiryVerdict = 'reply' | 'held' | 'spam' | 'system';

export interface InboundEmail {
  /** Bare sender address from the envelope/header. */
  from: string;
  /** The `From:` header as sent, with display name if any. */
  fromHeader?: string;
  subject: string;
  text: string;
  /** Lower-cased header map. */
  headers: Record<string, string>;
  /** SPF / DKIM / DMARC results, when the provider reports them. */
  authentication?: { spf?: string; dkim?: string; dmarc?: string };
}

export interface ParsedInquiry {
  /** Who the reply goes to — the address typed into a contact form, or the sender. */
  replyTo: string | null;
  name: string | null;
  subject: string;
  message: string;
  /** True when the body is a website contact-form relay ("Name: … Email: …"). */
  viaContactForm: boolean;
}

export interface Classification extends ParsedInquiry {
  verdict: InquiryVerdict;
  /** Spam score; ≥ SPAM_THRESHOLD is spam. */
  score: number;
  /** Count of creator-enquiry signals found. */
  relevance: number;
  /** Human-readable reasons, shown on the Inbox tab. */
  reasons: string[];
}

export const SPAM_THRESHOLD = 5;

// ─── Parsing ─────────────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/i;

/** Strips quoted replies and signatures' leading dashes; normalises whitespace. */
function clean(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Minimal HTML → text, for mail that arrives without a text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n');
}

/** Reads a `Label: value` line from a contact-form body. */
function formField(text: string, label: string): string | null {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im');
  const m = re.exec(text);
  return m ? m[1].trim() : null;
}

/** The `Message:` block runs to the end of the body (or the next known label). */
function formMessage(text: string): string | null {
  const m = /^\s*(?:message|enquiry|inquiry|comments?)\s*:\s*([\s\S]+)$/im.exec(text);
  if (!m) return null;
  return m[1].split(/\n\s*(?:--|sent from|this e-?mail was sent)/i)[0].trim();
}

function displayName(fromHeader: string | undefined): string | null {
  if (!fromHeader) return null;
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(fromHeader);
  const name = m?.[1]?.trim();
  return name && !EMAIL_RE.test(name) ? name : null;
}

export function parseInquiry(email: InboundEmail): ParsedInquiry {
  const text = clean(email.text);
  const formEmail = formField(text, 'e-?mail(?: address)?');
  const formName = formField(text, '(?:full )?name');
  const viaContactForm = !!formEmail && EMAIL_RE.test(formEmail);

  if (viaContactForm) {
    return {
      replyTo: EMAIL_RE.exec(formEmail!)?.[0].toLowerCase() ?? null,
      name: formName,
      subject: formField(text, 'subject') ?? email.subject,
      message: formMessage(text) ?? text,
      viaContactForm: true,
    };
  }

  // A direct email. Prefer an explicit Reply-To over the sender.
  const replyToHeader = email.headers['reply-to'];
  const replyTo = (replyToHeader && EMAIL_RE.exec(replyToHeader)?.[0]) || email.from;
  return {
    replyTo: EMAIL_RE.test(replyTo) ? replyTo.toLowerCase() : null,
    name: displayName(email.fromHeader),
    subject: email.subject,
    message: text,
    viaContactForm: false,
  };
}

// ─── Signals ─────────────────────────────────────────────────────────────────

/** Senders that are machines, never people. */
const SYSTEM_LOCALPARTS =
  /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|donotreply|bounces?|notifications?|alerts?|newsletters?|news|marketing)$/i;

/** Things only a creator/model enquiry says. Each distinct hit counts once. */
const RELEVANCE: [RegExp, string][] = [
  [/\bonly\s?fans\b|\bOF\b(?!\s+course)/i, 'mentions OnlyFans'],
  [/\bfansly\b|\bfanvue\b|\bmym\b|\bjust\s?for\s?fans\b/i, 'mentions a fan platform'],
  [/\bcreator\b|\bcontent creat/i, 'mentions being a creator'],
  [/\bmodel(?:l?ing)?\b/i, 'mentions modelling'],
  [/\bmanag(?:e|ement|er|ing)\b/i, 'asks about management'],
  [/\bagency\b/i, 'mentions an agency'],
  [/\bsubscribers?\b|\bfans?\b(?!\s*(?:page|club))|\bfollowers?\b/i, 'talks about an audience'],
  [/\b(?:join|sign(?:ed)? (?:up|with)|work(?:ing)? with you|apply|application|represent)\b/i, 'wants to join'],
  [/\b(?:grow|scale|relaunch|revenue|earn(?:ings)?|monetis|monetiz)/i, 'talks about growth or earnings'],
  [/\bpersona\b|\bcontent\b|\bpost(?:ing)?\b|\bshoot/i, 'talks about content'],
];

/** Spam vocabulary, weighted. Each distinct hit counts once. */
const SPAM_TERMS: [RegExp, number, string][] = [
  [/\bSEO\b|search engine optimi[sz]|backlinks?|guest post|domain authority|rank(?:ing)? (?:your|on) (?:website|google)|first page of google/i, 4, 'SEO pitch'],
  [/\b(?:web|website|app|mobile app|software) (?:design|development|developer)\b/i, 3, 'web/app development pitch'],
  [/\b(?:crypto|bitcoin|btc|usdt|forex|binance|investment opportunit|trading signal)/i, 4, 'crypto/finance'],
  [/\b(?:loan|credit repair|debt relief|casino|betting|viagra|cialis|pharmacy|diet pills?)\b/i, 5, 'classic spam goods'],
  [/\b(?:lead generation|generate leads|b2b leads|email list|marketing services|social media marketing services|increase (?:your )?(?:traffic|sales))\b/i, 3, 'marketing pitch'],
  [/\b(?:dear (?:sir|madam|sir\/madam|website owner)|to whom it may concern)\b/i, 2, 'impersonal greeting'],
  [/\b(?:sponsored post|paid post|link insertion|partnership proposal|collaboration opportunity for your (?:website|blog))\b/i, 3, 'link-selling pitch'],
  [/\b(?:virtual assistant|outsourc(?:e|ing)|white[- ]label|offshore team)\b/i, 3, 'outsourcing pitch'],
  [/\b(?:unsubscribe|opt[- ]out|reply (?:stop|remove))\b/i, 2, 'bulk-mail footer'],
  [/\b(?:your website|your site|your domain)\b/i, 2, 'talks about "your website"'],
  [/\b(?:congratulations,? you (?:have )?won|claim your prize|you have been selected)\b/i, 5, 'prize scam'],
  [/\b(?:verify your account|password (?:expire|reset)|suspended|unusual (?:sign-?in|activity))\b/i, 5, 'phishing wording'],
];

const SHORTENER = /\b(?:bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|cutt\.ly|rebrand\.ly|shorturl\.at)\//i;
const URL_RE = /\bhttps?:\/\/[^\s)>"']+|\bwww\.[^\s)>"']+/gi;

/** Throwaway inbox providers — a real applicant rarely uses one. */
const DISPOSABLE = /@(?:mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|trashmail|sharklasers|getnada|maildrop)\./i;

function nonLatinRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  return nonLatin / letters.length;
}

function looksLikeGibberish(text: string): boolean {
  const words = text.match(/[A-Za-z]{6,}/g) ?? [];
  if (words.length < 3) return false;
  const vowelless = words.filter((w) => !/[aeiouy]/i.test(w)).length;
  return vowelless / words.length > 0.3;
}

// ─── Classification ──────────────────────────────────────────────────────────

export function classifyInquiry(email: InboundEmail): Classification {
  const parsed = parseInquiry(email);
  const reasons: string[] = [];
  const h = email.headers;
  const fromLower = email.from.toLowerCase();
  const localpart = fromLower.split('@')[0] ?? '';

  const done = (verdict: InquiryVerdict, score: number, relevance: number): Classification => ({
    ...parsed,
    verdict,
    score,
    relevance,
    reasons,
  });

  // ── System mail: never a person, never answered ───────────────────────────
  if (fromLower === 'forwarding-noreply@google.com') {
    reasons.push('Gmail forwarding confirmation — open it to finish setting up the forward');
    return done('system', 0, 0);
  }
  if (SYSTEM_LOCALPARTS.test(localpart)) {
    reasons.push(`Sent from an automated address (${localpart}@)`);
    return done('system', 0, 0);
  }
  const autoSubmitted = h['auto-submitted'];
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
    reasons.push('Marked Auto-Submitted (an auto-reply or robot)');
    return done('system', 0, 0);
  }
  if (/^(bulk|list|junk)$/i.test(h['precedence'] ?? '') || h['list-unsubscribe'] || h['list-id']) {
    reasons.push('Mailing-list or bulk mail');
    return done('system', 0, 0);
  }
  if (/@bluurock\.com$/i.test(parsed.replyTo ?? '')) {
    reasons.push('Reply address is our own domain — would loop');
    return done('system', 0, 0);
  }

  // ── Spam scoring ──────────────────────────────────────────────────────────
  let score = 0;
  const body = `${parsed.subject}\n${parsed.message}`;

  if (!parsed.replyTo) {
    reasons.push('No usable reply address');
    return done('spam', SPAM_THRESHOLD, 0);
  }

  // Authentication only means something for a direct email: a contact-form
  // relay is sent by our own web host, so it passes whoever filled the form in.
  const auth = email.authentication;
  if (!parsed.viaContactForm && auth) {
    if (auth.dmarc === 'fail') {
      score += 4;
      reasons.push('DMARC failed — the sender is likely forged');
    } else if (auth.spf === 'fail' && auth.dkim !== 'pass') {
      score += 3;
      reasons.push('SPF failed with no DKIM pass');
    }
  }

  for (const [re, weight, label] of SPAM_TERMS) {
    if (re.test(body)) {
      score += weight;
      reasons.push(label);
    }
  }

  const urls = body.match(URL_RE) ?? [];
  if (urls.length >= 3) {
    score += Math.min(4, urls.length - 1);
    reasons.push(`${urls.length} links`);
  }
  if (SHORTENER.test(body)) {
    score += 3;
    reasons.push('Uses a link shortener');
  }
  if (DISPOSABLE.test(parsed.replyTo)) {
    score += 3;
    reasons.push('Disposable email address');
  }
  // Not `URL_RE.test` — a global regex carries `lastIndex` between calls.
  if (parsed.name && /https?:|www\.|\.(?:com|net|ru|xyz)\b/i.test(parsed.name)) {
    score += SPAM_THRESHOLD;
    reasons.push('Name field contains a link');
  }
  if (parsed.subject.length > 8 && parsed.subject === parsed.subject.toUpperCase() && /[A-Z]{4}/.test(parsed.subject)) {
    score += 1;
    reasons.push('All-caps subject');
  }
  if (nonLatinRatio(body) > 0.4) {
    score += 3;
    reasons.push('Mostly non-Latin script');
  }
  if (looksLikeGibberish(parsed.message)) {
    score += SPAM_THRESHOLD;
    reasons.push('Reads as random characters');
  }
  const words = parsed.message.split(/\s+/).filter(Boolean).length;
  if (words < 4) {
    score += 2;
    reasons.push('Message is nearly empty');
  }
  if (words > 900) {
    score += 2;
    reasons.push('Unusually long message');
  }

  // ── Relevance ─────────────────────────────────────────────────────────────
  let relevance = 0;
  for (const [re, label] of RELEVANCE) {
    if (re.test(body)) {
      relevance += 1;
      reasons.push(label);
    }
  }

  // A pitch that happens to say "content" or "management" ("social media
  // management services") is still a pitch: strong spam evidence wins.
  if (score >= SPAM_THRESHOLD) return done('spam', score, relevance);
  // Two independent creator signals, and no more than mild noise.
  if (relevance >= 2 && score <= 2) return done('reply', score, relevance);
  return done('held', score, relevance);
}
