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
export const MAX_EARNINGS_PHOTOS = 2;

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
 * Every handle on this form is asked for as a username, but applicants paste
 * profile URLs anyway. Normalise both shapes down to a bare handle so there is
 * exactly one thing to validate, store, and render.
 *
 * Handles the platform prefixes people type by hand as well as the hosts:
 * `@name`, `u/name`, `/user/name`, `instagram.com/name?igsh=…`.
 */
export function normaliseHandle(raw: string): string {
  let v = raw.trim();
  if (!v) return '';
  v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  v = v.replace(
    /^(instagram\.com|instagr\.am|twitter\.com|x\.com|old\.reddit\.com|reddit\.com|t\.me|telegram\.me)\//i,
    '',
  );
  v = v.split(/[?#]/)[0].replace(/\/+$/, '');
  // Reddit is written `u/name`, and its canonical URL path is `/user/name`.
  v = v.replace(/^(u|user)\//i, '');
  return v.replace(/^@+/, '');
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

// ─── Social pages ────────────────────────────────────────────────────────────

/**
 * How a handle becomes the value we store.
 *
 * The applicant only ever types a username — the form supplies the `@` / `u/`
 * in front of the box — but the reviewer wants something they can click and
 * paste, so the **stored** value is the full profile URL. Doing it here, in the
 * shared schema, means the browser and the server compose the identical string.
 */
export const SOCIAL_URL = {
  instagram: (handle: string) => `https://www.instagram.com/${handle}`,
  twitter: (handle: string) => `https://x.com/${handle}`,
  reddit: (handle: string) => `https://www.reddit.com/user/${handle}`,
} as const;

/** Per-platform username rules, as each platform actually enforces them. */
const SOCIAL_PATTERNS = {
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  twitter: /^[A-Za-z0-9_]{1,15}$/,
  reddit: /^[A-Za-z0-9._-]{3,20}$/,
} as const;

type SocialPlatform = keyof typeof SOCIAL_URL;

/**
 * One social page: a bare handle in, a full profile URL out (or `''`).
 *
 * `.max()` runs before the transform so a pasted essay is rejected on length
 * rather than mangled into a nonsense handle first.
 */
const socialPage = (platform: SocialPlatform, label: string, example: string) =>
  z
    .string()
    .max(200, `That ${label} username is too long`)
    .transform(normaliseHandle)
    .refine((v) => v === '' || SOCIAL_PATTERNS[platform].test(v), {
      message: `Use just the ${label} username, e.g. ${example}`,
    })
    .transform((v) => (v ? SOCIAL_URL[platform](v) : ''));

/** The composed answer to "list all your social media pages", as one block. */
export function joinSocialLinks(fields: {
  socialInstagram: string;
  socialTwitter: string;
  socialReddit: string;
  socialOther: string;
}): string {
  return [
    fields.socialInstagram,
    fields.socialTwitter,
    fields.socialReddit,
    fields.socialOther,
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

/**
 * E.164: a `+`, a country code that cannot start with 0, and at most 15 digits
 * in total. Deliberately the only shape accepted — a number without its country
 * code is unusable to us, and "0821234567" is the single most common way this
 * field gets filled in wrongly.
 */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * Composes the stored WhatsApp value from the form's two controls.
 *
 * Returns `''` for an empty number — a dial code on its own is not an answer,
 * and treating it as one would fail validation on a field the applicant never
 * touched. A number with no dial code deliberately keeps its digits and loses
 * the `+`, so it fails the pattern and is told what is missing.
 */
export function composeWhatsApp(dialCode: string, number: string): string {
  const raw = number.trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  // Typed as an international number ("+27 82 …", "0027 82 …")? Then the
  // country code is already in there and the select must not prepend a second
  // one. Only an explicit international prefix counts as that — inferring it
  // from a number that merely *starts with* the dial code would eat a real
  // digit off every US number beginning with 1.
  if (/^(\+|00)/.test(raw)) return `+${digits.replace(/^00/, '')}`;

  const code = dialCode.replace(/\D/g, '');
  if (!code) return digits;
  // National trunk prefix: never part of the E.164 form.
  return `+${code}${digits.replace(/^0+/, '')}`;
}

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
  telegram: optionalHandle('Telegram'),
  whatsapp: z
    .string()
    .trim()
    .max(24, 'That number is too long')
    .refine((v) => v === '' || E164_PATTERN.test(v), {
      message: 'Enter your number with its country code, e.g. +27 82 123 4567',
    }),

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
  socialInstagram: socialPage('instagram', 'Instagram', 'bluurock'),
  socialTwitter: socialPage('twitter', 'Twitter', 'bluurock'),
  socialReddit: socialPage('reddit', 'Reddit', 'bluurock'),
  socialOther: z.string().trim().max(1000, 'Keep this under 1000 characters'),

  // Section 3 — conditional on `hasOnlyFans`
  trialLink: urlish,

  // Section 4 — ids returned by /api/model-submissions/upload
  selfieIds: z
    .array(z.string())
    .min(MIN_SELFIES, `Upload at least ${MIN_SELFIES} selfies`)
    .max(MAX_SELFIES),
  bodyPhotoIds: z
    .array(z.string())
    .min(MIN_BODY_PHOTOS, `Upload at least ${MIN_BODY_PHOTOS} body photos`)
    .max(MAX_BODY_PHOTOS),
  earningsPhotoIds: z.array(z.string()).max(MAX_EARNINGS_PHOTOS),
} as const;

/**
 * Two cross-field rules, each shared between a step slice and the whole-form
 * schema so a step can never pass something the server would reject.
 *
 * Their issues are raised on synthetic paths (`contact`, `socials`) rather than
 * on one of the real fields: both rules are about a *set* of inputs, and
 * pinning the message to whichever field happens to be first would point the
 * applicant at a box that is not necessarily the one to fill in.
 */
type ContactShape = { telegram: string; whatsapp: string };
function requireOneContact(data: ContactShape, ctx: z.RefinementCtx) {
  if (!data.telegram && !data.whatsapp) {
    ctx.addIssue({
      code: 'custom',
      path: ['contact'],
      message: 'Add your Telegram or your WhatsApp — this is how we reach you.',
    });
  }
}

type SocialShape = {
  socialInstagram: string;
  socialTwitter: string;
  socialReddit: string;
  socialOther: string;
};
function requireOneSocial(data: SocialShape, ctx: z.RefinementCtx) {
  if (!joinSocialLinks(data)) {
    ctx.addIssue({
      code: 'custom',
      path: ['socials'],
      message: 'Add at least one social media page',
    });
  }
}

/**
 * Telegram and WhatsApp are each optional on their own, but **one of them is
 * required** — see `requireOneContact`. Email alone is not enough here: every
 * conversation with an applicant happens on a messenger, and an application we
 * cannot follow up on is an application nobody actions.
 */
export const submissionSchema = z.object(F).superRefine((data, ctx) => {
  requireOneContact(data, ctx);
  requireOneSocial(data, ctx);
});

/**
 * Per-step slices, so "Continue" only complains about what's on screen. The
 * whole-form schema still runs on submit (client) and again on the server.
 */
export const stepSchemas = {
  info: z
    .object({
      name: F.name,
      email: F.email,
      telegram: F.telegram,
      whatsapp: F.whatsapp,
    })
    .superRefine(requireOneContact),
  about: z
    .object({
      hasOnlyFans: F.hasOnlyFans,
      age: F.age,
      country: F.country,
      city: F.city,
      sexuality: F.sexuality,
      socialInstagram: F.socialInstagram,
      socialTwitter: F.socialTwitter,
      socialReddit: F.socialReddit,
      socialOther: F.socialOther,
    })
    .superRefine(requireOneSocial),
  onlyfans: z.object({ trialLink: F.trialLink }),
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
