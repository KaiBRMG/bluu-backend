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
  instagram: string;
  telegram: string;
  hasOnlyFans: boolean;
  age: number;
  country: string;
  city: string;
  sexuality: Sexuality;
  /** Section 3 — only meaningful when `hasOnlyFans` is true. */
  niche: string;
  trialLink: string;
  socialLinks: string;
}

/** The Firestore document at `model-submissions/{id}`. */
export interface ModelSubmissionDocument extends ModelSubmissionFields {
  id: string;
  status: SubmissionStatus;
  createdAt: string;
  earningsPhoto: SubmissionPhoto | null;
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
  earningsPhoto: SubmissionPhotoUrls | null;
  selfies: SubmissionPhotoUrls[];
  bodyPhotos: SubmissionPhotoUrls[];
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string;
}
