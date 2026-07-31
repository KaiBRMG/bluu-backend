/**
 * Model submissions — shared constants + the single zod schema that validates
 * the public application form.
 *
 * This module is imported by BOTH the browser (live field validation) and the
 * API route (authoritative re-validation). Client-side validation is UX only:
 * `/api/model-submissions/submit` re-parses the exact same schema, so nothing
 * here can be bypassed by editing the page.
 *
 * Keep it free of `server-only` imports.
 */

import { z } from 'zod';
import type { SubmissionStatus } from '@/types/modelSubmission';

// ─── Limits (mirrored in the upload + submit routes) ─────────────────────────

export const MIN_AGE = 18;
export const MAX_AGE = 75;

export const MIN_SELFIES = 3;
export const MAX_SELFIES = 6;
export const MIN_BODY_PHOTOS = 3;
export const MAX_BODY_PHOTOS = 6;
export const MAX_EARNINGS_PHOTOS = 1;

/** Hard cap on files accepted against one submission session. */
export const MAX_FILES_PER_SESSION = MAX_SELFIES + MAX_BODY_PHOTOS + MAX_EARNINGS_PHOTOS;

/** Largest upload the API will decode, in bytes. Phone photos land well under this. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Formats `sharp` is allowed to accept. Enforced by **decoding**, not by MIME
 * string. `heif` covers both HEIF and AVIF — sharp reports AVIF as `heif`.
 *
 * Note that an iPhone's HEVC-coded HEIC never reaches this list: the prebuilt
 * libvips has no HEVC codec, so the browser transcodes HEIC to JPEG before
 * upload (see `_lib/prepareImage.ts`).
 */
export const ALLOWED_IMAGE_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'heif', 'avif'] as const;

/**
 * What the file picker advertises. The server does not trust it — and some
 * platforms report an empty type for HEIC, which is why the uploader also
 * accepts files by `.heic` / `.heif` extension.
 */
export const UPLOAD_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.heic,.heif';

/** How long an issued submission session stays usable. */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/** A human filling this in takes longer than this; anything faster is a script. */
export const MIN_FILL_SECONDS = 8;

export const SEXUALITY_OPTIONS = [
  { value: 'straight', label: 'Straight' },
  { value: 'gay', label: 'Gay' },
  { value: 'bi', label: 'Bi' },
  { value: 'other', label: 'Other' },
] as const;

// ─── Status vocabulary (admin surface) ───────────────────────────────────────

/**
 * Status triad, matching the house pattern in `campaignTracking.ts`:
 * `-400` foreground / `/10` fill / `/30` border. Import these — never re-map a
 * status colour inline.
 */
export const SUBMISSION_STATUS_META: Record<
  SubmissionStatus,
  { label: string; classes: string; dot: string }
> = {
  new: {
    label: 'New',
    classes: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    dot: 'bg-blue-400',
  },
  approved: {
    label: 'Approved',
    classes: 'text-green-400 bg-green-500/10 border-green-500/30',
    dot: 'bg-green-400',
  },
  rejected: {
    label: 'Rejected',
    classes: 'text-red-400 bg-red-500/10 border-red-500/30',
    dot: 'bg-red-400',
  },
};

export const SUBMISSION_STATUSES: SubmissionStatus[] = ['new', 'approved', 'rejected'];

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === 'string' && (SUBMISSION_STATUSES as string[]).includes(value);
}

// ─── Field helpers ───────────────────────────────────────────────────────────

/**
 * Instagram is asked for as a handle *or* a URL ("does not need to be full
 * URL"). Normalise both shapes down to a bare handle so the admin surface has
 * one thing to render and link.
 */
export function normaliseHandle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withoutUrl = trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?(instagram\.com|t\.me|telegram\.me)\//i, '')
    .replace(/\/+$/, '')
    .split(/[?#]/)[0];
  return withoutUrl.replace(/^@+/, '');
}

const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,60}$/;

const optionalHandle = (field: string) =>
  z
    .string()
    .max(200, `${field} is too long`)
    .transform(normaliseHandle)
    .refine((v) => v === '' || HANDLE_PATTERN.test(v), {
      message: `Use just the ${field} username, e.g. bluurock`,
    });

/** Accepts a bare domain too — people rarely paste the scheme on a phone. */
const urlish = z
  .string()
  .trim()
  .max(500, 'That link is too long')
  .refine(
    (v) => v === '' || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v),
    { message: 'Enter a valid link, e.g. onlyfans.com/action/trial/xxxx' },
  );

// ─── The schema ──────────────────────────────────────────────────────────────

/**
 * One definition per field, shared by the whole-form schema and the per-step
 * schemas below. Defining them once is what keeps the message a step shows
 * identical to the message the server would produce.
 */
const F = {
  // Section 1
  name: z.string().trim().min(2, 'Please enter your name').max(80, 'That name is too long'),
  email: z.email('Enter a valid email address').max(200, 'That email is too long'),
  instagram: optionalHandle('Instagram'),
  telegram: optionalHandle('Telegram'),

  // Section 2
  hasOnlyFans: z.boolean({ error: 'Choose yes or no' }),
  age: z
    .number({ error: 'Enter your age' })
    .int('Enter your age in whole years')
    .min(MIN_AGE, `You must be ${MIN_AGE} or older to apply`)
    .max(MAX_AGE, 'Please enter a valid age'),
  country: z.string().trim().min(1, 'Select your country').max(80),
  city: z.string().trim().min(1, 'Enter your city').max(80, 'That city name is too long'),
  sexuality: z.enum(['straight', 'gay', 'bi', 'other'], { error: 'Select an option' }),

  // Section 3 — conditional on `hasOnlyFans`
  niche: z.string().trim().max(200, 'Keep this under 200 characters'),
  trialLink: urlish,
  socialLinks: z.string().trim().max(1000, 'Keep this under 1000 characters'),

  // Section 4 — ids returned by /api/model-submissions/upload
  selfieIds: z
    .array(z.string())
    .min(MIN_SELFIES, `Upload at least ${MIN_SELFIES} selfies`)
    .max(MAX_SELFIES),
  bodyPhotoIds: z
    .array(z.string())
    .min(MIN_BODY_PHOTOS, `Upload at least ${MIN_BODY_PHOTOS} body photos`)
    .max(MAX_BODY_PHOTOS),
  earningsPhotoId: z.string().nullable(),
} as const;

/** "Where we will contact you" — an application we cannot reply to is useless. */
const contactRefinement = (
  data: { instagram: string; telegram: string },
  ctx: z.RefinementCtx,
) => {
  if (!data.instagram && !data.telegram) {
    ctx.addIssue({
      code: 'custom',
      path: ['telegram'],
      message: 'Add a Telegram or Instagram so we can reach you',
    });
  }
};

export const submissionSchema = z
  .object(F)
  .superRefine((data, ctx) => {
    contactRefinement(data, ctx);
    // Section 3 becomes required content once they've told us the account exists.
    if (data.hasOnlyFans && !data.socialLinks) {
      ctx.addIssue({
        code: 'custom',
        path: ['socialLinks'],
        message: 'Please list your social media pages',
      });
    }
  });

/**
 * Per-step slices, so "Continue" only complains about what's on screen. The
 * whole-form schema still runs on submit (client) and again on the server.
 */
export const stepSchemas = {
  info: z
    .object({ name: F.name, email: F.email, instagram: F.instagram, telegram: F.telegram })
    .superRefine(contactRefinement),
  about: z.object({
    hasOnlyFans: F.hasOnlyFans,
    age: F.age,
    country: F.country,
    city: F.city,
    sexuality: F.sexuality,
  }),
  onlyfans: z.object({
    niche: F.niche,
    trialLink: F.trialLink,
    socialLinks: F.socialLinks.min(1, 'Please list your social media pages'),
  }),
  photos: z.object({ selfieIds: F.selfieIds, bodyPhotoIds: F.bodyPhotoIds }),
} as const;

export type StepId = keyof typeof stepSchemas;

export type SubmissionPayload = z.input<typeof submissionSchema>;
export type SubmissionParsed = z.output<typeof submissionSchema>;

/**
 * Field-level errors keyed by field name, for rendering under inputs.
 * Returns `{}` when the slice being checked is valid.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
