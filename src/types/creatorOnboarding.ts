/**
 * Creator onboarding types — shared by the public form (`/join/[token]`), its
 * API routes, and the staff page (`/creator-portal/onboarding`).
 *
 * See documentation/creator-onboarding.md.
 */

import type { Answers, OnboardingStatus, OnboardingTrack } from '@/lib/creatorOnboarding';

/** Where the creator last was, so reopening the link resumes there. */
export interface OnboardingCursor {
  chapter: number;
  screen: number;
}

/** What the public page is given about the person holding the link. */
export interface PublicOnboarding {
  /** Name exactly as they applied with — the landing page greets them by it. */
  name: string;
  track: OnboardingTrack;
  status: OnboardingStatus;
  answers: Answers;
  cursor: OnboardingCursor | null;
  /** ISO — when the application was approved, shown on the welcome pass. */
  approvedAt: string | null;
  /** ISO — set once the form is submitted. */
  completedAt: string | null;
  /** Short, stable, non-secret reference printed on the pass (e.g. `BR-4F2A`). */
  passNo: string;
}

/** A row on the staff Onboarding page. No answers — they travel on open. */
export interface OnboardingSummary {
  id: string;
  name: string;
  stageName: string;
  email: string;
  telegram: string;
  whatsapp: string;
  track: OnboardingTrack;
  status: OnboardingStatus;
  invitedAt: string | null;
  invitedByName: string | null;
  openedAt: string | null;
  lastActivityAt: string | null;
  completedAt: string | null;
  requiredAnswered: number;
  requiredTotal: number;
  inviteCount: number;
}

export interface OnboardingDetail extends OnboardingSummary {
  answers: Answers;
  city: string;
  country: string;
  age: number;
}

// ─── Inbound enquiries (the Inbox tab) ───────────────────────────────────────

export type InquiryVerdict = 'reply' | 'held' | 'spam' | 'system';

/** What happened to an inbound email, as the Inbox tab shows it. */
export type InquiryOutcome =
  | 'replied'
  | 'held'
  | 'spam'
  | 'system'
  | 'duplicate'
  | 'rate-limited'
  | 'failed';

export interface InquirySummary {
  id: string;
  receivedAt: string;
  from: string;
  replyTo: string | null;
  name: string | null;
  subject: string;
  /** First ~600 characters of the message, as text. */
  snippet: string;
  viaContactForm: boolean;
  verdict: InquiryVerdict;
  outcome: InquiryOutcome;
  reasons: string[];
  score: number;
  repliedAt: string | null;
  repliedByName: string | null;
  error: string | null;
}
