/**
 * Model submission types — shared by the public application form
 * (`/model-submissions`) and the internal review page
 * (`/applications/apps-model-submissions`).
 *
 * See documentation/model-submissions.md for the subsystem overview.
 */

export type SubmissionStatus = 'new' | 'approved' | 'rejected';

export type Sexuality = 'straight' | 'gay' | 'bi' | 'other';

/** A stored photo: a full-size render for the detail view + a WebP thumbnail. */
export interface SubmissionPhoto {
  /** Storage path of the full-size render (WebP, long edge ≤ 2400px). */
  path: string;
  /** Storage path of the WebP thumbnail (long edge ≤ 480px). */
  thumbPath: string;
  width: number;
  height: number;
}

/** A photo resolved for the client: signed, time-limited read URLs. */
export interface SubmissionPhotoUrls {
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

/** The applicant-supplied payload, exactly as validated by `submissionSchema`. */
export interface ModelSubmissionFields {
  name: string;
  email: string;
  telegram: string;
  /** E.164, e.g. `+27821234567`. One of this and `telegram` is always present. */
  whatsapp: string;
  hasOnlyFans: boolean;
  age: number;
  country: string;
  city: string;
  sexuality: Sexuality;
  /**
   * Section 2 — the applicant's social pages, stored as full profile URLs
   * (`https://www.instagram.com/…`). `socialOther` is free text.
   */
  socialInstagram: string;
  socialTwitter: string;
  socialReddit: string;
  socialOther: string;
  /**
   * Every social answer as one block, newline separated — composed by the
   * submit route. It is also where records predating the per-platform fields
   * keep their answer, so it stays the thing to render as a fallback.
   */
  socialLinks: string;
  /** Section 3 — only meaningful when `hasOnlyFans` is true. */
  trialLink: string;
  /**
   * Legacy. Instagram was collected in section 1 until the per-platform social
   * fields replaced it; still read so older records render intact, never
   * written by new submissions.
   */
  instagram: string;
}

/** The Firestore document at `model-submissions/{id}`. */
export interface ModelSubmissionDocument extends ModelSubmissionFields {
  id: string;
  status: SubmissionStatus;
  createdAt: string;
  earningsPhotos: SubmissionPhoto[];
  selfies: SubmissionPhoto[];
  bodyPhotos: SubmissionPhoto[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string;
}

/** List-view shape: no storage paths, thumbnails only, no free-text bulk. */
export interface ModelSubmissionSummary {
  id: string;
  name: string;
  age: number;
  country: string;
  city: string;
  hasOnlyFans: boolean;
  status: SubmissionStatus;
  createdAt: string;
  photoCount: number;
  /** Signed thumbnail URLs for the card strip (selfies first, then body). */
  thumbs: SubmissionPhotoUrls[];
  reviewedByName: string | null;
  reviewedAt: string | null;
}

/** Detail-view shape: every field plus signed URLs for every photo. */
export interface ModelSubmissionDetail extends ModelSubmissionFields {
  id: string;
  status: SubmissionStatus;
  createdAt: string;
  earningsPhotos: SubmissionPhotoUrls[];
  selfies: SubmissionPhotoUrls[];
  bodyPhotos: SubmissionPhotoUrls[];
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string;
}
