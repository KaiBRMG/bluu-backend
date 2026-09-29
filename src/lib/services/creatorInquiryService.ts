import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { serializeTimestamp as iso } from '@/lib/middleware/apiHelpers';
import { displayNamesFor } from '@/lib/services/userService';
import {
  classifyInquiry,
  htmlToText,
  type Classification,
} from '@/lib/email/inquiryFilter';
import { resendReader, sendEmail } from '@/lib/email/resend';
import { greetingName, inquiryReplyEmail } from '@/lib/email/templates';
import type { InquiryOutcome, InquirySummary } from '@/types/creatorOnboarding';

/**
 * Inbound enquiries to hello@bluurock.com.
 *
 * Gmail forwards hello@ to a Resend receiving address; Resend POSTs
 * `email.received` to `/api/email/inbound`, which calls `handleReceivedEmail`.
 * The webhook carries metadata only — the body is fetched here with the
 * full-access key (see `lib/email/resend.ts`).
 *
 * `creator-inquiries/{resendEmailId}` is the log the Onboarding page's Inbox
 * tab reads: every received email, what the filter decided, and why. Keyed by
 * Resend's email id so a redelivered webhook (Svix retries on any non-2xx, and
 * occasionally on success) is a no-op rather than a second reply.
 */

export const INQUIRIES_COLLECTION = 'creator-inquiries';

/** One auto-reply per address per window — a second enquiry is logged, not re-answered. */
const DUPLICATE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Ceiling on automatic replies per rolling hour. A spam run that slips past the
 * filter must not turn hello@ into a bulk sender and wreck its reputation;
 * anything past the cap is held for a person instead. Real enquiries arrive a
 * few a day, so this is never the limit for them.
 */
const AUTO_REPLY_HOURLY_CAP = 20;

const SNIPPET_CHARS = 600;

function lowerHeaders(h: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = String(v);
  return out;
}

async function alreadyRepliedTo(address: string): Promise<boolean> {
  // Single-field equality — served by the automatic index, no composite needed.
  // The window is checked in code so the query stays index-free.
  const snap = await adminDb
    .collection(INQUIRIES_COLLECTION)
    .where('replyTo', '==', address)
    .select('repliedAt')
    .limit(20)
    .get();
  const cutoff = Date.now() - DUPLICATE_WINDOW_MS;
  return snap.docs.some((d) => {
    const at = d.data().repliedAt?.toMillis?.();
    return typeof at === 'number' && at > cutoff;
  });
}

async function autoRepliesInLastHour(): Promise<number> {
  const snap = await adminDb
    .collection(INQUIRIES_COLLECTION)
    .where('autoRepliedAt', '>', Timestamp.fromMillis(Date.now() - 60 * 60 * 1000))
    .count()
    .get();
  return snap.data().count;
}

async function sendReply(
  id: string,
  c: Pick<Classification, 'replyTo' | 'name' | 'subject' | 'viaContactForm'>,
  messageId: string | null,
): Promise<string> {
  const email = inquiryReplyEmail(greetingName(c.name), c.subject);
  // Thread the reply when we are answering the actual sender. A contact-form
  // relay's Message-ID belongs to our web host, not to the applicant, so
  // threading against it would be meaningless in their inbox.
  const headers =
    messageId && !c.viaContactForm ? { 'In-Reply-To': messageId, References: messageId } : undefined;
  return sendEmail({
    to: c.replyTo!,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers,
    idempotencyKey: `inquiry-reply/${id}`,
    tags: [{ name: 'category', value: 'inquiry_reply' }],
  });
}

/**
 * Triage one received email. Returns the outcome; never throws for a bad email
 * (a throw would make Resend redeliver forever) — only for infrastructure
 * failures worth a retry, before anything was recorded.
 */
export async function handleReceivedEmail(emailId: string): Promise<InquiryOutcome> {
  const ref = adminDb.collection(INQUIRIES_COLLECTION).doc(emailId);
  if ((await ref.get()).exists) return 'duplicate';

  const { data: email, error } = await resendReader().emails.receiving.get(emailId);
  if (error || !email) throw new Error(`Could not fetch received email ${emailId}: ${error?.message ?? 'empty'}`);

  const headers = lowerHeaders(email.headers);
  const text = email.text?.trim() ? email.text : htmlToText(email.html ?? '');
  const authentication = (email as unknown as { authentication?: Record<string, string> }).authentication;

  const c = classifyInquiry({
    from: email.from,
    fromHeader: headers.from,
    subject: email.subject ?? '',
    text,
    headers,
    authentication,
  });

  // Gmail's forwarding confirmation is the one system mail a person must act
  // on — keep its whole body so the Inbox tab can show the confirmation link.
  const keepWhole = c.verdict === 'system' && email.from.toLowerCase() === 'forwarding-noreply@google.com';

  const record = {
    receivedAt: FieldValue.serverTimestamp(),
    from: email.from,
    replyTo: c.replyTo,
    name: c.name,
    subject: (c.subject || email.subject || '').slice(0, 300),
    snippet: keepWhole ? text.slice(0, 4000) : c.message.slice(0, SNIPPET_CHARS),
    viaContactForm: c.viaContactForm,
    messageId: email.message_id ?? null,
    verdict: c.verdict,
    reasons: c.reasons.slice(0, 20),
    score: c.score,
    relevance: c.relevance,
    outcome: c.verdict as InquiryOutcome,
    autoRepliedAt: null,
    repliedAt: null,
    repliedBy: null,
    replyEmailId: null,
    error: null,
  };

  // `create` fails if a concurrent delivery got here first — that one owns it.
  try {
    await ref.create(record);
  } catch {
    return 'duplicate';
  }

  if (c.verdict !== 'reply') return c.verdict;

  // Independent reads — one round trip, not two.
  const [replied, recentAutoReplies] = await Promise.all([alreadyRepliedTo(c.replyTo!), autoRepliesInLastHour()]);
  if (replied) {
    await ref.update({ outcome: 'duplicate', reasons: [...record.reasons, 'Already replied to this address recently'] });
    return 'duplicate';
  }
  if (recentAutoReplies >= AUTO_REPLY_HOURLY_CAP) {
    await ref.update({ outcome: 'rate-limited', reasons: [...record.reasons, 'Hourly auto-reply cap reached — held for a person'] });
    return 'rate-limited';
  }

  try {
    const replyEmailId = await sendReply(emailId, c, email.message_id ?? null);
    await ref.update({
      outcome: 'replied',
      autoRepliedAt: FieldValue.serverTimestamp(),
      repliedAt: FieldValue.serverTimestamp(),
      replyEmailId,
    });
    return 'replied';
  } catch (e) {
    await ref.update({ outcome: 'failed', error: e instanceof Error ? e.message.slice(0, 300) : 'Send failed' });
    return 'failed';
  }
}

/** A person pressing "Send reply" on a held, spam or failed enquiry. */
export async function replyManually(id: string, uid: string): Promise<'sent' | 'not-found' | 'no-address' | 'already'> {
  const ref = adminDb.collection(INQUIRIES_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return 'not-found';
  const d = snap.data() ?? {};
  if (!d.replyTo) return 'no-address';
  if (d.repliedAt) return 'already';

  const replyEmailId = await sendReply(
    id,
    { replyTo: d.replyTo, name: d.name ?? null, subject: d.subject ?? '', viaContactForm: d.viaContactForm === true },
    d.messageId ?? null,
  );
  await ref.update({
    outcome: 'replied',
    repliedAt: FieldValue.serverTimestamp(),
    repliedBy: uid,
    replyEmailId,
    error: null,
  });
  return 'sent';
}

export async function listInquiries(limit = 200): Promise<InquirySummary[]> {
  const snap = await adminDb
    .collection(INQUIRIES_COLLECTION)
    .orderBy('receivedAt', 'desc')
    .limit(limit)
    // Only what the Inbox renders (rule 9i).
    .select(
      'receivedAt', 'from', 'replyTo', 'name', 'subject', 'snippet', 'viaContactForm',
      'verdict', 'outcome', 'reasons', 'score', 'repliedAt', 'repliedBy', 'error',
    )
    .get();

  const names = await displayNamesFor(snap.docs.map((d) => d.data().repliedBy));

  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      receivedAt: iso(d.receivedAt) ?? new Date(0).toISOString(),
      from: d.from ?? '',
      replyTo: d.replyTo ?? null,
      name: d.name ?? null,
      subject: d.subject ?? '',
      snippet: d.snippet ?? '',
      viaContactForm: d.viaContactForm === true,
      verdict: d.verdict ?? 'held',
      outcome: d.outcome ?? 'held',
      reasons: Array.isArray(d.reasons) ? d.reasons : [],
      score: typeof d.score === 'number' ? d.score : 0,
      repliedAt: iso(d.repliedAt),
      repliedByName: d.repliedBy ? names.get(d.repliedBy) ?? 'Unknown' : null,
      error: d.error ?? null,
    };
  });
}
