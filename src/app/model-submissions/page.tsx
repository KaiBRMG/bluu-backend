'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconLock } from '@tabler/icons-react';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { countryCodes, getFlagEmoji } from '@/lib/countryData';
import {
  MAX_BODY_PHOTOS,
  MAX_EARNINGS_PHOTOS,
  MAX_SELFIES,
  MIN_BODY_PHOTOS,
  MIN_SELFIES,
  SEXUALITY_OPTIONS,
  composeWhatsApp,
  fieldErrors,
  stepSchemas,
  submissionSchema,
  type StepId,
} from '@/lib/modelSubmissions';
import { cn } from '@/lib/utils';
import type { Sexuality } from '@/types/modelSubmission';
import { Field } from './_components/Field';
import { PhotoUploader, type PhotoSlot } from './_components/PhotoUploader';
import { PrefixedInput } from './_components/PrefixedInput';
import { SocialField } from './_components/SocialField';
import { ThankYou } from './_components/ThankYou';
import { guessCountryCode } from './_lib/guessCountry';
import { AZURE, AZURE_INK, FIELD, PANEL, STAGE_GROUND } from './_lib/theme';

// ─── Step definitions ────────────────────────────────────────────────────────

const STEP_COPY: Record<StepId, { heading: string; blurb: string }> = {
  info: {
    heading: 'Let’s start with you',
    blurb: 'A few short questions. It takes about three minutes.',
  },
  about: {
    heading: 'A bit more about you',
    blurb: 'Where you are, and where people can already find you.',
  },
  onlyfans: {
    heading: 'Your OnlyFans account',
    blurb: 'So we can see what you’ve built already.',
  },
  photos: {
    heading: 'Photos',
    blurb: 'Recent, clear, and unedited. This is the part we look at closest.',
  },
};

const countryNames = countryCodes.map((c) => c.name);

interface FormState {
  name: string;
  email: string;
  telegram: string;
  /** ISO country code — the dial code is derived, never stored on its own. */
  whatsappCountry: string;
  whatsappNumber: string;
  hasOnlyFans: boolean | null;
  age: string;
  country: string;
  city: string;
  sexuality: Sexuality | '';
  /** Bare usernames. The schema turns each into a full profile URL. */
  socialInstagram: string;
  socialTwitter: string;
  socialReddit: string;
  socialOther: string;
  trialLink: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  telegram: '',
  whatsappCountry: '',
  whatsappNumber: '',
  hasOnlyFans: null,
  age: '',
  country: '',
  city: '',
  sexuality: '',
  socialInstagram: '',
  socialTwitter: '',
  socialReddit: '',
  socialOther: '',
  trialLink: '',
};

/**
 * Which error messages a given control clears as it is edited.
 *
 * Most fields clear their own, but the two cross-field rules ("one contact
 * method", "at least one social page") are reported on synthetic keys that no
 * single input owns. Without this map, a `contact` error would sit under the
 * fields the applicant is actively fixing until they pressed Continue again.
 */
const CLEARS_ERRORS: Partial<Record<keyof FormState, readonly string[]>> = {
  telegram: ['telegram', 'contact'],
  whatsappCountry: ['whatsapp', 'contact'],
  whatsappNumber: ['whatsapp', 'contact'],
  socialInstagram: ['socialInstagram', 'socials'],
  socialTwitter: ['socialTwitter', 'socials'],
  socialReddit: ['socialReddit', 'socials'],
  socialOther: ['socialOther', 'socials'],
};

// ─── Crash recovery ──────────────────────────────────────────────────────────

interface Draft {
  form: FormState;
  stepIndex: number;
  session: { sessionId: string; token: string } | null;
  selfies: PhotoSlot[];
  bodyPhotos: PhotoSlot[];
  earnings: PhotoSlot[];
  startedAt: number;
}

/**
 * The in-progress application, held in module scope so it survives this
 * component being torn down and remounted by `error.tsx`'s `reset()`.
 *
 * DELIBERATELY IN MEMORY, NOT IN STORAGE. This is the most sensitive data the
 * project collects — legal name, email, age, city, sexuality, photographs — and
 * `model-submissions.md` already holds the line that applicant details must not
 * land on disk (the review queue caches opened records in memory for the same
 * reason). Module scope buys back exactly the case that hurt us, a render crash
 * inside a live tab, and buys nothing else: a reload or a closed tab starts
 * clean, which for this data is the correct trade rather than a shortcoming.
 *
 * It holds the `session` too, which is not an optimisation. Photos upload
 * against a session id and `resolvePhotos` only honours ids that session was
 * issued — so re-opening a session after a crash would silently orphan every
 * photo already uploaded, and burn a per-IP session slot doing it.
 */
let draft: Draft | null = null;

export default function ModelSubmissionsPage() {
  // Read once, at first render — the effect below overwrites `draft` immediately.
  const recovered = useRef(draft).current;

  const [form, setForm] = useState<FormState>(() => recovered?.form ?? EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stepIndex, setStepIndex] = useState(() => recovered?.stepIndex ?? 0);

  const [selfies, setSelfies] = useState<PhotoSlot[]>(() => recovered?.selfies ?? []);
  const [bodyPhotos, setBodyPhotos] = useState<PhotoSlot[]>(() => recovered?.bodyPhotos ?? []);
  const [earnings, setEarnings] = useState<PhotoSlot[]>(() => recovered?.earnings ?? []);

  const [session, setSession] = useState<{ sessionId: string; token: string } | null>(
    () => recovered?.session ?? null,
  );
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedName, setSubmittedName] = useState<string | null>(null);

  /** Honeypot. Hidden from people; scripts fill it in. */
  const [website, setWebsite] = useState('');
  // Stamped on mount, not at render: reading the clock during render makes the
  // page unprerenderable. 0 until then, which only ever reads as "took a long
  // time" — never as the bot-fast path.
  const startedAt = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear the error the moment they start fixing it, not on the next submit.
    setErrors((prev) => {
      const keys = CLEARS_ERRORS[key] ?? [key];
      if (!keys.some((k) => prev[k])) return prev;
      const next = { ...prev };
      for (const k of keys) next[k] = '';
      return next;
    });
  }, []);

  // Pre-select the WhatsApp country from the browser's own locale — no request,
  // no library. Runs in an effect, not during render: it reads `navigator`, and
  // it must not fight a draft recovered from a crash or a choice already made.
  useEffect(() => {
    setForm((prev) => {
      if (prev.whatsappCountry) return prev;
      const guess = guessCountryCode();
      return guess ? { ...prev, whatsappCountry: guess } : prev;
    });
  }, []);

  // Open a submission session up front, so photos can start uploading the
  // instant they're picked rather than waiting on a round trip at step 4.
  useEffect(() => {
    // Recovered from a crash: the session — and every photo already uploaded
    // against it — is still good. Opening a second one would strand them.
    if (session) return;

    let cancelled = false;
    // Keep the original stamp on recovery, so a crash can't restart the clock
    // and push a genuine applicant under MIN_FILL_SECONDS on resubmit.
    startedAt.current = recovered?.startedAt || Date.now();
    (async () => {
      try {
        const res = await fetch('/api/model-submissions/session', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not open the form.');
        if (!cancelled) setSession({ sessionId: data.sessionId, token: data.token });
      } catch (error) {
        if (!cancelled) {
          setSessionError(error instanceof Error ? error.message : 'Could not open the form.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, recovered]);

  // Keep the recovery copy current. Dropped once the application is in — past
  // that point there is nothing to recover and no reason to still hold it.
  useEffect(() => {
    draft =
      submittedName === null
        ? {
            form,
            stepIndex,
            session,
            selfies,
            bodyPhotos,
            earnings,
            startedAt: startedAt.current,
          }
        : null;
  }, [form, stepIndex, session, selfies, bodyPhotos, earnings, submittedName]);

  const steps = useMemo<StepId[]>(
    () => (form.hasOnlyFans ? ['info', 'about', 'onlyfans', 'photos'] : ['info', 'about', 'photos']),
    [form.hasOnlyFans],
  );
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex === steps.length - 1;

  const doneIds = (slots: PhotoSlot[]) =>
    slots.filter((s) => s.status === 'done' && s.id).map((s) => s.id as string);

  const whatsappDialCode = useMemo(
    () => countryCodes.find((c) => c.code === form.whatsappCountry)?.dialCode ?? '',
    [form.whatsappCountry],
  );

  const payload = useMemo(
    () => ({
      name: form.name,
      email: form.email,
      telegram: form.telegram,
      // Composed by the shared module, so the value validated here is the exact
      // string the server will validate and store.
      whatsapp: composeWhatsApp(whatsappDialCode, form.whatsappNumber),
      // Left as null / undefined when unanswered so zod reports "choose an
      // option" rather than silently validating a made-up default.
      hasOnlyFans: form.hasOnlyFans,
      age: form.age === '' ? undefined : Number(form.age),
      country: form.country,
      city: form.city,
      sexuality: form.sexuality as Sexuality,
      socialInstagram: form.socialInstagram,
      socialTwitter: form.socialTwitter,
      socialReddit: form.socialReddit,
      socialOther: form.socialOther,
      trialLink: form.trialLink,
      selfieIds: doneIds(selfies),
      bodyPhotoIds: doneIds(bodyPhotos),
      earningsPhotoIds: doneIds(earnings),
    }),
    [form, whatsappDialCode, selfies, bodyPhotos, earnings],
  );

  // Move focus to the new step's heading so keyboard and screen-reader users
  // land where the content changed instead of at the top of the document.
  const focusHeading = () => {
    window.requestAnimationFrame(() => {
      headingRef.current?.focus();
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  };

  const goBack = () => {
    setErrors({});
    setStepIndex((i) => Math.max(0, i - 1));
    focusHeading();
  };

  const uploadsInFlight =
    [...selfies, ...bodyPhotos, ...earnings].some((s) => s.status === 'uploading');

  const handleNext = async () => {
    const result = stepSchemas[step].safeParse(payload);
    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }
    setErrors({});

    // Never leave a step — or submit — with photos still in the air. The button
    // is already disabled while this is true; this is the belt to that pair of
    // braces, covering an upload that starts between render and tap.
    if (uploadsInFlight) {
      setSubmitError('Hang on — your photos are still uploading.');
      return;
    }
    setSubmitError(null);

    if (!isLast) {
      setStepIndex((i) => i + 1);
      focusHeading();
      return;
    }

    if (!session) {
      setSubmitError(sessionError ?? 'Still connecting. Give it a second and try again.');
      return;
    }

    const full = submissionSchema.safeParse(payload);
    if (!full.success) {
      setErrors(fieldErrors(full.error));
      setSubmitError('Something earlier needs fixing — check the previous steps.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/model-submissions/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          token: session.token,
          website,
          elapsedMs: Date.now() - startedAt.current,
          fields: payload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields) setErrors(data.fields);
        throw new Error(data.error || 'Submission failed. Please try again.');
      }
      setSubmittedName(form.name.trim());
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedName !== null) {
    return (
      <main translate="no" className="notranslate min-h-dvh text-white" style={STAGE_GROUND}>
        <ThankYou name={submittedName} />
      </main>
    );
  }

  return (
    // `translate="no"` is also set on <html> by <NoTranslate />, which is what
    // actually covers Radix's portalled overlays. This static pair is the belt
    // to that brace: it applies in the server-rendered markup, before hydration
    // has had a chance to run the effect.
    <main translate="no" className="notranslate min-h-dvh text-white" style={STAGE_GROUND}>
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 sm:px-8">
        {/* ── Masthead ─────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-5 pt-10 pb-8 sm:pt-14">
          {/* Intrinsic size given so the ratio is known before the bytes land —
              a raster logo with only a height would reserve no width and shift
              the masthead as it decodes. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo/HQ2.png"
            alt="Bluu Rock"
            width={1374}
            height={868}
            className="h-11 w-auto self-start"
          />
          <p className="flex items-start gap-2 text-sm leading-snug text-white/55">
            <IconLock className="mt-0.5 size-4 shrink-0" aria-hidden />
            All information is confidential and is never shared externally.
          </p>
        </header>

        {/* ── Progress ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2.5 pb-9">
          <div className="flex gap-1.5" aria-hidden>
            {steps.map((id, i) => (
              <span
                key={id}
                className="h-1 flex-1 rounded-full transition-colors duration-200"
                style={{ backgroundColor: i <= stepIndex ? AZURE : 'rgba(255,255,255,0.12)' }}
              />
            ))}
          </div>
          <p className="text-xs font-medium tracking-wide text-white/45 tabular-nums">
            Step {stepIndex + 1} of {steps.length}
          </p>
        </div>

        {/* ── The step ─────────────────────────────────────────────────── */}
        <div key={step} className="onboard-rise flex flex-1 flex-col pb-40">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl leading-[1.12] font-semibold tracking-[-0.02em] text-balance outline-none sm:text-4xl"
          >
            {STEP_COPY[step].heading}
          </h1>
          <p className="mt-3 max-w-[46ch] leading-relaxed text-white/60">
            {STEP_COPY[step].blurb}
          </p>

          <div className="mt-9 flex flex-col gap-7">
            {step === 'info' && (
              <>
                <Field label="Name" error={errors.name} hint="Preferably your real name">
                  {(a) => (
                    <input
                      {...a}
                      className={FIELD}
                      value={form.name}
                      autoComplete="name"
                      onChange={(e) => set('name', e.target.value)}
                    />
                  )}
                </Field>

                <Field label="Email" error={errors.email}>
                  {(a) => (
                    <input
                      {...a}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      className={FIELD}
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                    />
                  )}
                </Field>

                <Field
                  label="Telegram"
                  error={errors.telegram}
                  hint="Telegram or WhatsApp — give us at least one. This is where we’ll contact you."
                >
                  {(a) => (
                    <PrefixedInput
                      {...a}
                      prefix="@"
                      value={form.telegram}
                      onChange={(e) => set('telegram', e.target.value)}
                    />
                  )}
                </Field>

                {/* The "one of the two" rule surfaces here rather than on
                    Telegram: it can only fire when both boxes are empty, so the
                    message belongs under the second of the pair, where the eye
                    already is when Continue is pressed. */}
                <Field label="WhatsApp" error={errors.whatsapp || errors.contact}>
                  {(a) => (
                    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
                      <Select
                        value={form.whatsappCountry}
                        onValueChange={(v) => set('whatsappCountry', v)}
                      >
                        <SelectTrigger
                          aria-label="Country calling code"
                          aria-invalid={!!(errors.whatsapp || errors.contact)}
                          className={cn(FIELD, 'h-auto justify-between')}
                        >
                          {/* The trigger shows the flag and the dial code only —
                              the country name is what you search the open list
                              by, not what you need once it is chosen. */}
                          {whatsappDialCode ? (
                            <span className="flex items-center gap-1.5 tabular-nums">
                              <span aria-hidden>{getFlagEmoji(form.whatsappCountry)}</span>
                              {whatsappDialCode}
                            </span>
                          ) : (
                            <span className="text-white/50">Code</span>
                          )}
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {countryCodes.map((c) => (
                            // `textValue` is what Radix's type-ahead matches on.
                            // Without it the flag emoji leads the item's text
                            // content and typing "sou" finds nothing — the only
                            // way through an 80-country list with a keyboard.
                            <SelectItem key={c.code} value={c.code} textValue={c.name}>
                              <span className="flex w-full items-center gap-2">
                                <span aria-hidden>{getFlagEmoji(c.code)}</span>
                                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                                <span className="text-muted-foreground tabular-nums">
                                  {c.dialCode}
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <input
                        {...a}
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel-national"
                        placeholder="82 123 4567"
                        className={cn(FIELD, 'tabular-nums')}
                        value={form.whatsappNumber}
                        // Digits, spaces and the punctuation people type into a
                        // phone number. Everything else is dropped as they type
                        // rather than failed at the end of the step.
                        onChange={(e) =>
                          set(
                            'whatsappNumber',
                            e.target.value.replace(/[^\d\s()+-]/g, '').slice(0, 24),
                          )
                        }
                      />
                    </div>
                  )}
                </Field>
              </>
            )}

            {step === 'about' && (
              <>
                <Field
                  label="Do you already have an OnlyFans account that is linked to your identity?"
                  error={errors.hasOnlyFans}
                  group
                >
                  {(a) => (
                    <RadioGroup
                      aria-invalid={a['aria-invalid']}
                      aria-describedby={a['aria-describedby']}
                      value={form.hasOnlyFans === null ? '' : form.hasOnlyFans ? 'yes' : 'no'}
                      onValueChange={(v) => {
                        set('hasOnlyFans', v === 'yes');
                        // The OnlyFans step appears or disappears behind them;
                        // never let the index point past the end.
                        setStepIndex((i) => Math.min(i, v === 'yes' ? 3 : 2));
                      }}
                      className="grid grid-cols-2 gap-3"
                    >
                      {(['yes', 'no'] as const).map((value) => {
                        const active =
                          form.hasOnlyFans !== null &&
                          (form.hasOnlyFans ? 'yes' : 'no') === value;
                        return (
                          <Label
                            key={value}
                            htmlFor={`${a.id}-${value}`}
                            className={cn(
                              'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 text-base font-medium transition-colors',
                              active
                                ? 'border-[#00b8f5] bg-[#00b8f5]/10 text-white'
                                : 'border-white/[0.10] bg-white/[0.03] text-white/75 hover:bg-white/[0.06]',
                            )}
                          >
                            <RadioGroupItem id={`${a.id}-${value}`} value={value} />
                            {value === 'yes' ? 'Yes' : 'No'}
                          </Label>
                        );
                      })}
                    </RadioGroup>
                  )}
                </Field>

                <Field label="Your age" error={errors.age} hint="You must be 18+ to become a model.">
                  {(a) => (
                    <input
                      {...a}
                      type="number"
                      inputMode="numeric"
                      min={18}
                      max={75}
                      className={cn(FIELD, 'tabular-nums')}
                      value={form.age}
                      onChange={(e) => set('age', e.target.value.replace(/\D/g, '').slice(0, 3))}
                    />
                  )}
                </Field>

                <Field label="Where are you located?" error={errors.country || errors.city}>
                  {(a) => (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Select value={form.country} onValueChange={(v) => set('country', v)}>
                        <SelectTrigger
                          id={a.id}
                          aria-invalid={!!errors.country}
                          className={cn(FIELD, 'h-auto justify-between')}
                        >
                          <SelectValue placeholder="Country" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {countryNames.map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <input
                        aria-label="City"
                        aria-invalid={!!errors.city}
                        aria-describedby={a['aria-describedby']}
                        placeholder="City"
                        className={FIELD}
                        value={form.city}
                        onChange={(e) => set('city', e.target.value)}
                      />
                    </div>
                  )}
                </Field>

                <Field label="What is your sexuality?" error={errors.sexuality} group>
                  {(a) => (
                    <RadioGroup
                      aria-invalid={a['aria-invalid']}
                      aria-describedby={a['aria-describedby']}
                      value={form.sexuality}
                      onValueChange={(v) => set('sexuality', v as Sexuality)}
                      className="grid grid-cols-2 gap-3"
                    >
                      {SEXUALITY_OPTIONS.map((option) => (
                        <Label
                          key={option.value}
                          htmlFor={`${a.id}-${option.value}`}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 text-base font-medium transition-colors',
                            form.sexuality === option.value
                              ? 'border-[#00b8f5] bg-[#00b8f5]/10 text-white'
                              : 'border-white/[0.10] bg-white/[0.03] text-white/75 hover:bg-white/[0.06]',
                          )}
                        >
                          <RadioGroupItem id={`${a.id}-${option.value}`} value={option.value} />
                          {option.label}
                        </Label>
                      ))}
                    </RadioGroup>
                  )}
                </Field>

                {/* Social pages. Asked for as usernames, one box per platform,
                    because a single free-text box produced answers we then had
                    to guess at — bare handles with no platform, half-typed URLs,
                    three accounts on one line. The schema turns each username
                    into the full profile URL that gets stored. */}
                <Field
                  label="List all your social media pages"
                  group
                  error={errors.socials}
                  hint="At least one. Just the username — we’ll build the link."
                >
                  {/* Each row owns its own label and error; the group above
                      carries the question, the hint, and the "at least one"
                      message. */}
                  {(a) => (
                    <div className="flex flex-col gap-4">
                      <SocialField
                        label="Instagram"
                        prefix="@"
                        placeholder="bluurock"
                        value={form.socialInstagram}
                        onChange={(v) => set('socialInstagram', v)}
                        error={errors.socialInstagram}
                      />
                      <SocialField
                        label="Twitter"
                        prefix="@"
                        placeholder="bluurock"
                        value={form.socialTwitter}
                        onChange={(v) => set('socialTwitter', v)}
                        error={errors.socialTwitter}
                      />
                      <SocialField
                        label="Reddit"
                        prefix="u/"
                        placeholder="bluurock"
                        value={form.socialReddit}
                        onChange={(v) => set('socialReddit', v)}
                        error={errors.socialReddit}
                      />

                      <div className="flex flex-col gap-1.5">
                        <Label
                          htmlFor={`${a.id}-other`}
                          className="text-xs font-medium text-white/55"
                        >
                          Anything else
                        </Label>
                        <Textarea
                          id={`${a.id}-other`}
                          rows={3}
                          autoCapitalize="none"
                          autoCorrect="off"
                          placeholder="TikTok, Threads, a personal site — one per line"
                          aria-invalid={!!errors.socialOther}
                          className={cn(FIELD, 'resize-y')}
                          value={form.socialOther}
                          onChange={(e) => set('socialOther', e.target.value)}
                        />
                        {errors.socialOther && (
                          <p role="alert" className="text-sm font-medium text-red-300">
                            {errors.socialOther}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </Field>
              </>
            )}

            {step === 'onlyfans' && session && (
              <>
                <Field
                  label="1-month free trial link"
                  optional
                  error={errors.trialLink}
                  hint="So we can view your account."
                >
                  {(a) => (
                    <input
                      {...a}
                      type="url"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      placeholder="onlyfans.com/action/trial/…"
                      className={FIELD}
                      value={form.trialLink}
                      onChange={(e) => set('trialLink', e.target.value)}
                    />
                  )}
                </Field>

                <div className="flex flex-col gap-3">
                  <Field
                    label="Last 4 months of earnings"
                    optional
                    group
                    hint={`Up to ${MAX_EARNINGS_PHOTOS} screenshots from your OnlyFans statements page.`}
                  >
                    {() => (
                      <PhotoUploader
                        kind="earnings"
                        slots={earnings}
                        onChange={setEarnings}
                        max={MAX_EARNINGS_PHOTOS}
                        sessionId={session.sessionId}
                        token={session.token}
                        addLabel="Add earnings screenshot"
                      />
                    )}
                  </Field>

                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto self-start px-0 text-sm font-medium text-[#00b8f5] underline underline-offset-4 hover:bg-transparent hover:text-white"
                      >
                        See the sample photo
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Sample earnings screenshot</DialogTitle>
                        <DialogDescription>
                          Yours should show the same four-month breakdown.
                        </DialogDescription>
                      </DialogHeader>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/sample_earnings.jpg"
                        alt="Example OnlyFans statements page showing four months of earnings"
                        loading="lazy"
                        className="w-full rounded-lg border border-white/10"
                      />
                    </DialogContent>
                  </Dialog>
                </div>

              </>
            )}

            {step === 'photos' && session && (
              <>
                <Field
                  label="Recent selfies"
                  error={errors.selfieIds}
                  group
                  hint={`At least ${MIN_SELFIES}. Clear and unedited — no filters.`}
                >
                  {() => (
                    <PhotoUploader
                      kind="selfie"
                      slots={selfies}
                      onChange={setSelfies}
                      min={MIN_SELFIES}
                      max={MAX_SELFIES}
                      sessionId={session.sessionId}
                      token={session.token}
                      addLabel="Add a selfie"
                    />
                  )}
                </Field>

                <Field
                  label="Recent body photos"
                  error={errors.bodyPhotoIds}
                  group
                  hint={`At least ${MIN_BODY_PHOTOS}. Full length, good light, unedited.`}
                >
                  {() => (
                    <PhotoUploader
                      kind="body"
                      slots={bodyPhotos}
                      onChange={setBodyPhotos}
                      min={MIN_BODY_PHOTOS}
                      max={MAX_BODY_PHOTOS}
                      sessionId={session.sessionId}
                      token={session.token}
                      addLabel="Add a body photo"
                    />
                  )}
                </Field>
              </>
            )}

            {(step === 'photos' || step === 'onlyfans') && !session && (
              <div className={cn(PANEL, 'rounded-xl px-4 py-6 text-sm text-white/60')}>
                {sessionError ?? 'Connecting…'}
              </div>
            )}
          </div>

          {/* Honeypot — off-screen rather than display:none, which some bots skip. */}
          <div aria-hidden className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
        </div>

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div
          className="fixed inset-x-0 bottom-0 border-t border-white/[0.08] px-5 pt-4 sm:px-8"
          style={{
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            background: 'rgba(8,9,11,0.88)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
            {submitError && (
              <p role="alert" className="text-sm font-medium text-red-300">
                {submitError}
              </p>
            )}
            <div className="flex items-center gap-3">
              {stepIndex > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={goBack}
                  className="h-12 shrink-0 px-4 text-white/60 hover:bg-white/[0.06] hover:text-white"
                >
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
              )}
              <Button
                type="button"
                onClick={handleNext}
                disabled={submitting || uploadsInFlight}
                className="h-12 flex-1 rounded-xl text-base font-semibold hover:brightness-110 disabled:opacity-70"
                style={{ backgroundColor: AZURE, color: AZURE_INK }}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                    Sending…
                  </>
                ) : uploadsInFlight ? (
                  <>
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                    Uploading photos…
                  </>
                ) : isLast ? (
                  'Submit application'
                ) : (
                  <>
                    Continue
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
