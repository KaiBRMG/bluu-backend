"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDownIcon, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { countryCodes, getFlagEmoji } from '@/lib/countryData';
import { resolveTimezoneFromAddress } from '@/lib/timezoneData';
import { validateOnboardingProfile, type PersonalInfoFormData } from '@/lib/validation';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

import OnboardingCard, { useAvatarSeed, useFullName } from '../_components/OnboardingCard';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];

const initialFormState: PersonalInfoFormData = {
  displayName: '',
  personalEmail: '',
  countryCode: '+1',
  phoneNumber: '',
  gender: '',
  address: { street: '', city: '', state: '', zipCode: '', country: '' },
  DOB: '',
  emergencyContactName: '',
  emergencyContactNumber: '',
  emergencyContactEmail: '',
  telegramHandle: '',
  paymentMethod: '',
  paymentInfo: '',
  userComments: '',
};

/**
 * A titled group of fields, separated by a hairline rather than nested cards.
 *
 * A real fieldset/legend, not a section/h2: the form carries two "Phone number"
 * and two "Email" labels, and only a legend makes a screen reader disambiguate
 * them ("Emergency contact, Phone number") instead of reading the same name twice.
 */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    // The hairline lives on the wrapper, not the fieldset: a legend is rendered
    // into its fieldset's top border, so a bordered fieldset would draw the rule
    // straight through the title.
    <div
      className="border-t pt-6 first:border-t-0 first:pt-0"
      style={{ borderColor: 'rgba(255,255,255,0.07)' }}
    >
      <fieldset className="min-w-0">
        <legend className="p-0 text-sm font-semibold text-white">{title}</legend>
        {description && <p className="mt-1 text-xs text-zinc-400">{description}</p>}
        <div className="mt-4 space-y-4">{children}</div>
      </fieldset>
    </div>
  );
}

/** Label + control + error, wired for screen readers. */
function Field({
  id,
  label,
  required,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className} data-error={error ? 'true' : undefined}>
      <Label htmlFor={id} className="mb-1.5 text-xs text-zinc-400">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="text-zinc-500">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { userData } = useUserData();
  const fullName = useFullName();
  const avatarSeed = useAvatarSeed();

  const [formData, setFormData] = useState<PersonalInfoFormData>(initialFormState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [dobOpen, setDobOpen] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLFormElement>(null);

  // Submitting is gated on having actually scrolled the form — we're asking for
  // records the user is accountable for, so they should have seen every field.
  const [scrollProgress, setScrollProgress] = useState(0);
  const [hasReadThrough, setHasReadThrough] = useState(false);

  const updateScrollProgress = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // A zero height means the element hasn't been laid out yet. Measuring now
    // would read scrollHeight === clientHeight and latch the gate open before
    // the user has seen anything — wait for a real measurement instead.
    if (el.clientHeight === 0) return;

    const scrollable = el.scrollHeight - el.clientHeight;

    // Genuinely nothing to scroll (a very tall window): there's no reading left
    // to gate on, so unlock rather than trapping the user behind a full bar.
    if (scrollable <= 4) {
      setScrollProgress(1);
      setHasReadThrough(true);
      return;
    }

    setScrollProgress(Math.min(1, el.scrollTop / scrollable));
    if (el.scrollTop >= scrollable - 8) setHasReadThrough(true);
  }, []);

  // Re-measure when the form grows (validation errors appear, fonts settle) so
  // the bar can't report 100% against a stale height.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollProgress();
    const observer = new ResizeObserver(updateScrollProgress);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollProgress]);

  // Seed from whatever the user doc already holds — Google gives us a display
  // name at signup, and a user who reloads mid-flow gets their answers back.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!userData || hydratedRef.current) return;
    hydratedRef.current = true;
    setFormData({
      displayName: userData.displayName || '',
      personalEmail: userData.contactInfo?.personalEmail || '',
      countryCode: userData.contactInfo?.countryCode || '+1',
      phoneNumber: userData.contactInfo?.phoneNumber || '',
      gender: userData.gender || '',
      address: {
        street: userData.address?.street || '',
        city: userData.address?.city || '',
        state: userData.address?.state || '',
        zipCode: userData.address?.zipCode || '',
        country: userData.address?.country || '',
      },
      DOB: userData.DOB ? new Date(userData.DOB.seconds * 1000).toISOString().split('T')[0] : '',
      emergencyContactName: userData.contactInfo?.emergencyContactName || '',
      emergencyContactNumber: userData.contactInfo?.emergencyContactNumber || '',
      emergencyContactEmail: userData.contactInfo?.emergencyContactEmail || '',
      telegramHandle: userData.contactInfo?.telegramHandle || '',
      paymentMethod: userData.paymentMethod || '',
      paymentInfo: userData.paymentInfo || '',
      userComments: userData.userComments || '',
    });
  }, [userData]);

  const clearError = (field: string) =>
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  // `address` is a nested object with its own setter below, so it's excluded here.
  const setField = (field: Exclude<keyof PersonalInfoFormData, 'address'>, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    clearError(field);
  };

  const setAddress = (field: keyof PersonalInfoFormData['address'], value: string) => {
    setFormData((prev) => ({ ...prev, address: { ...prev.address, [field]: value } }));
    clearError(`address${field.charAt(0).toUpperCase()}${field.slice(1)}`);
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Allowed: JPEG, PNG');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File too large. Maximum size is 5MB');
      return;
    }

    setIsUploadingPhoto(true);
    try {
      const idToken = await user?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');

      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/user/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ imageData: base64Data, contentType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload photo');

      toast.success('Photo added');
    } catch (err) {
      console.error('[ProfilePage] Photo upload failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to upload photo');
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting || !user) return;
    // Pressing Enter in a text field submits natively, which would sidestep the
    // disabled button — so the scroll gate is enforced here too.
    if (!hasReadThrough) {
      toast.error('Please scroll through the whole form before submitting');
      return;
    }

    const validation = validateOnboardingProfile(formData, {
      resolveTimezone: resolveTimezoneFromAddress,
    });

    if (!validation.isValid) {
      setErrors(validation.errors);
      toast.error('Please complete the highlighted fields');
      // Move the user to the first problem rather than leaving them to hunt for
      // it. Focus (not just scroll) so the keyboard lands there too, and so a
      // screen reader announces the field and its error.
      requestAnimationFrame(() => {
        const firstError = scrollRef.current?.querySelector('[data-error="true"]');
        if (!firstError) return;
        firstError.scrollIntoView({ block: 'center', behavior: 'smooth' });
        firstError
          .querySelector<HTMLElement>('input, textarea, select, button')
          ?.focus({ preventScroll: true });
      });
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      const idToken = await user.getIdToken();
      // Address is required here, so the timezone always resolves — validation
      // rejects a country it can't map. Saved in the same write, not a second one.
      const resolvedTz = resolveTimezoneFromAddress(formData.address);

      const profileRes = await fetch('/api/user/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          displayName: formData.displayName,
          gender: formData.gender,
          DOB: formData.DOB || null,
          address: formData.address,
          contactInfo: {
            phoneNumber: formData.phoneNumber,
            countryCode: formData.countryCode,
            personalEmail: formData.personalEmail,
            telegramHandle: formData.telegramHandle,
            emergencyContactName: formData.emergencyContactName,
            emergencyContactNumber: formData.emergencyContactNumber,
            emergencyContactEmail: formData.emergencyContactEmail,
          },
          paymentMethod: formData.paymentMethod,
          paymentInfo: formData.paymentInfo,
          userComments: formData.userComments,
          ...(resolvedTz ?? {}),
        }),
      });
      if (!profileRes.ok) {
        const data = await profileRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save your details');
      }

      // Only now is onboarding complete — the details are the last thing we need.
      const flagRes = await fetch('/api/user/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ hasCompletedOnboarding: true }),
      });
      if (!flagRes.ok) throw new Error('Failed to complete onboarding');

      router.push('/onboarding/done');
    } catch (err) {
      console.error('[ProfilePage] Failed to submit details:', err);
      toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  };

  const selectedCountry = countryCodes.find((c) => c.dialCode === formData.countryCode);

  return (
    <OnboardingCard
      step={4}
      width="wide"
      footer={
        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push('/onboarding/permission/notifications')}
            disabled={isSubmitting}
            className="text-zinc-400"
          >
            Back
          </Button>
          <Button
            type="submit"
            form="onboarding-profile"
            disabled={isSubmitting || !hasReadThrough}
            className="flex-1"
          >
            {isSubmitting ? 'Submitting…' : 'Submit details'}
          </Button>
        </div>
      }
    >
      {/* shrink-0 throughout the frozen block: these are flex children now, and
          without it they'd compress instead of the form taking the squeeze. */}
      <h1 className="shrink-0 text-lg font-semibold text-white">Your details</h1>

      <div
        className="mt-4 flex shrink-0 items-start gap-3 rounded-lg border p-4"
        style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <ShieldCheck className="mt-0.5 shrink-0 text-zinc-400" size={18} aria-hidden="true" />
        <p className="max-w-[65ch] text-sm leading-relaxed text-zinc-400">
          As a registered company, Bluu Rock MGMT is required to maintain accurate personnel
          records. All information is kept strictly confidential and is not shared externally.
        </p>
      </div>

      {/* Reading progress for the scroll area below — the gate on Submit. */}
      <div className="mt-4 shrink-0">
        <Progress
          value={scrollProgress * 100}
          aria-label="Form reading progress"
          className="h-1"
        />
        {/* The bar carries this visually. Kept for screen readers only: a
            disabled Submit with no stated reason is otherwise a dead end for
            anyone who can't see the bar fill. */}
        <p className="sr-only" aria-live="polite">
          {hasReadThrough
            ? 'You can now submit your details.'
            : 'Scroll to the end of the form to continue.'}
        </p>
      </div>

      <form
        id="onboarding-profile"
        onSubmit={handleSubmit}
        onScroll={updateScrollProgress}
        noValidate
        ref={scrollRef}
        // Sized against the space actually left over (~32rem of card chrome +
        // page padding) rather than a flat vh, so the card stays inside a short
        // window instead of overflowing it. Floored so it never collapses.
        // Takes exactly the space the card has left over — no vh arithmetic, so
        // it can't guess the chrome height wrong and spill the page. `min-h-0`
        // is what allows a flex child to shrink below its content and scroll.
        className="mt-5 min-h-0 flex-1 space-y-6 overflow-y-auto pr-1"
      >
        <Section title="About you">
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              onChange={handlePhotoUpload}
              className="sr-only"
              id="onboarding-photo"
              disabled={isUploadingPhoto}
              // The visible label contains only an aria-hidden avatar, so it
              // supplies no accessible name — the input must carry it itself.
              aria-label="Upload a profile picture"
            />
            {/* The avatar itself is the upload control — the badge is the affordance. */}
            <Label
              htmlFor="onboarding-photo"
              // focus-within surfaces keyboard focus on the sr-only file input,
              // which would otherwise be invisible.
              className={`group relative shrink-0 rounded-full transition-opacity focus-within:ring-2 focus-within:ring-[#3b82f6] focus-within:ring-offset-2 focus-within:ring-offset-[#0A0A0A] ${
                isUploadingPhoto ? 'pointer-events-none opacity-60' : 'cursor-pointer'
              }`}
            >
              {/* Seeded from `useAvatarSeed`, not the full name — the seed is
                  hashed into the colour, so any other string renders a different
                  person's avatar than the rest of the app shows. */}
              <Avatar className="size-16" style={{ background: getAvatarColor(avatarSeed) }}>
                {userData?.photoURL && <AvatarImage src={userData.photoURL} alt="" />}
                <AvatarFallback
                  style={{ background: getAvatarColor(avatarSeed), color: '#fff' }}
                  className="text-lg"
                >
                  {getInitials(avatarSeed)}
                </AvatarFallback>
              </Avatar>
              <span
                aria-hidden="true"
                className="absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full bg-[#3b82f6] ring-2 ring-[#0A0A0A] transition-colors group-hover:bg-[#2563eb]"
              >
                <Plus className="size-3 text-white" strokeWidth={2.5} />
              </span>
            </Label>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{fullName}</p>
              <p className="mt-1 text-xs text-zinc-400">
                {isUploadingPhoto
                  ? 'Uploading…'
                  : 'Upload a profile picture (optional). JPEG or PNG, up to 5MB.'}
              </p>
            </div>
          </div>

          <Field id="displayName" label="Preferred nickname" required error={errors.displayName}>
            <Input
              id="displayName"
              value={formData.displayName}
              onChange={(e) => setField('displayName', e.target.value)}
              placeholder="What should we call you?"
              // Mirrors STRING_MAX_LENGTHS in /api/user/update — hitting the cap
              // in the field beats a 400 after submit.
              maxLength={100}
              aria-required="true"
              aria-invalid={!!errors.displayName}
              aria-describedby={errors.displayName ? 'displayName-error' : undefined}
            />
          </Field>

          <Field id="DOB" label="Date of birth" required error={errors.DOB}>
            <Popover open={dobOpen} onOpenChange={setDobOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="DOB"
                  type="button"
                  variant="outline"
                  aria-required="true"
                  aria-invalid={!!errors.DOB}
                  aria-describedby={errors.DOB ? 'DOB-error' : undefined}
                  className="w-full justify-between font-normal"
                >
                  <span className={formData.DOB ? '' : 'text-zinc-500'}>
                    {formData.DOB || 'Select a date'}
                  </span>
                  <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                <Calendar
                  mode="single"
                  selected={formData.DOB ? new Date(`${formData.DOB}T00:00:00`) : undefined}
                  captionLayout="dropdown"
                  // Bound the year dropdown to the ages validation accepts (16–100),
                  // so the picker can't offer a date the form will then reject.
                  startMonth={new Date(new Date().getFullYear() - 100, 0)}
                  endMonth={new Date(new Date().getFullYear() - 16, 11)}
                  defaultMonth={
                    formData.DOB
                      ? new Date(`${formData.DOB}T00:00:00`)
                      : new Date(new Date().getFullYear() - 25, 0)
                  }
                  onSelect={(date: Date | undefined) => {
                    setField('DOB', date ? date.toLocaleDateString('en-CA') : '');
                    setDobOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-xs text-zinc-400">Gender</legend>
            <RadioGroup
              value={formData.gender}
              onValueChange={(value) => setField('gender', value)}
              className="flex gap-6"
            >
              {['Male', 'Female', 'Other'].map((option) => (
                <div key={option} className="flex items-center gap-2">
                  <RadioGroupItem value={option} id={`gender-${option}`} />
                  <Label htmlFor={`gender-${option}`} className="cursor-pointer text-sm font-normal">
                    {option}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        </Section>

        <Section title="How we reach you">
          <Field id="workEmail" label="Company email">
            <Input
              id="workEmail"
              type="email"
              value={userData?.workEmail ?? ''}
              // readOnly, not disabled: a disabled input is skipped by the
              // keyboard and can't be selected, and this is a value people
              // reasonably want to read back or copy.
              readOnly
              aria-describedby="workEmail-hint"
              className="text-zinc-400 focus-visible:ring-0"
            />
            <p id="workEmail-hint" className="mt-1 text-xs text-zinc-400">
              The account you signed in with. This can&apos;t be changed here.
            </p>
          </Field>

          <Field id="personalEmail" label="Personal email" required error={errors.personalEmail}>
            <Input
              id="personalEmail"
              type="email"
              value={formData.personalEmail}
              onChange={(e) => setField('personalEmail', e.target.value)}
              placeholder="you@example.com"
              aria-required="true"
              aria-invalid={!!errors.personalEmail}
              aria-describedby={errors.personalEmail ? 'personalEmail-error' : undefined}
            />
          </Field>

          <Field id="phoneNumber" label="Phone number" required error={errors.phoneNumber}>
            <div className="flex gap-2">
              <Popover open={countryDropdownOpen} onOpenChange={setCountryDropdownOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-[108px] shrink-0 justify-between font-normal"
                    aria-label={`Country dialling code, currently ${formData.countryCode}`}
                  >
                    <span className="truncate">
                      {getFlagEmoji(selectedCountry?.code || 'US')} {formData.countryCode}
                    </span>
                    <ChevronDownIcon className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search country…" />
                    <CommandList className="max-h-60">
                      <CommandEmpty>No countries found</CommandEmpty>
                      <CommandGroup>
                        {countryCodes.map((country) => (
                          <CommandItem
                            key={country.code}
                            value={`${country.name} ${country.dialCode}`}
                            onSelect={() => {
                              setField('countryCode', country.dialCode);
                              setCountryDropdownOpen(false);
                            }}
                          >
                            <span>{getFlagEmoji(country.code)}</span>
                            <span>{country.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {country.dialCode}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Input
                id="phoneNumber"
                type="tel"
                value={formData.phoneNumber}
                onChange={(e) => setField('phoneNumber', e.target.value)}
                placeholder="Phone number"
                className="flex-1"
                aria-required="true"
                aria-invalid={!!errors.phoneNumber}
                aria-describedby={errors.phoneNumber ? 'phoneNumber-error' : undefined}
              />
            </div>
          </Field>

          <Field id="telegramHandle" label="Telegram handle" error={errors.telegramHandle}>
            <Input
              id="telegramHandle"
              value={formData.telegramHandle}
              onChange={(e) => setField('telegramHandle', e.target.value)}
              placeholder="@username"
            />
          </Field>
        </Section>

        <Section
          title="Where you're based"
          description="Your country and city set the time zone your shifts are scheduled in."
        >
          <Field id="street" label="Street address" required error={errors.addressStreet}>
            <Input
              id="street"
              value={formData.address.street}
              onChange={(e) => setAddress('street', e.target.value)}
              placeholder="123 Example Street"
              aria-required="true"
              aria-invalid={!!errors.addressStreet}
              aria-describedby={errors.addressStreet ? 'street-error' : undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="city" label="City" required error={errors.addressCity}>
              <Input
                id="city"
                value={formData.address.city}
                onChange={(e) => setAddress('city', e.target.value)}
                placeholder="City"
                aria-required="true"
                aria-invalid={!!errors.addressCity}
                aria-describedby={errors.addressCity ? 'city-error' : undefined}
              />
            </Field>
            <Field id="state" label="State / province" required error={errors.addressState}>
              <Input
                id="state"
                value={formData.address.state}
                onChange={(e) => setAddress('state', e.target.value)}
                placeholder="State or province"
                aria-required="true"
                aria-invalid={!!errors.addressState}
                aria-describedby={errors.addressState ? 'state-error' : undefined}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="zipCode" label="Zip / postal code" required error={errors.addressZipCode}>
              <Input
                id="zipCode"
                value={formData.address.zipCode}
                onChange={(e) => setAddress('zipCode', e.target.value)}
                placeholder="Postal code"
                aria-required="true"
                aria-invalid={!!errors.addressZipCode}
                aria-describedby={errors.addressZipCode ? 'zipCode-error' : undefined}
              />
            </Field>
            <Field id="country" label="Country" required error={errors.addressCountry}>
              <Input
                id="country"
                value={formData.address.country}
                onChange={(e) => setAddress('country', e.target.value)}
                placeholder="Country"
                aria-required="true"
                aria-invalid={!!errors.addressCountry}
                aria-describedby={errors.addressCountry ? 'country-error' : undefined}
              />
            </Field>
          </div>
        </Section>

        <Section title="Emergency contact" description="Who we should call if something happens on shift.">
          <Field
            id="emergencyContactName"
            label="Full name"
            required
            error={errors.emergencyContactName}
          >
            <Input
              id="emergencyContactName"
              value={formData.emergencyContactName}
              onChange={(e) => setField('emergencyContactName', e.target.value)}
              placeholder="Their full name"
              aria-required="true"
              aria-invalid={!!errors.emergencyContactName}
              aria-describedby={errors.emergencyContactName ? 'emergencyContactName-error' : undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="emergencyContactEmail"
              label="Email"
              required
              error={errors.emergencyContactEmail}
            >
              <Input
                id="emergencyContactEmail"
                type="email"
                value={formData.emergencyContactEmail}
                onChange={(e) => setField('emergencyContactEmail', e.target.value)}
                placeholder="Their email"
                aria-required="true"
                aria-invalid={!!errors.emergencyContactEmail}
                aria-describedby={
                  errors.emergencyContactEmail ? 'emergencyContactEmail-error' : undefined
                }
              />
            </Field>
            <Field
              id="emergencyContactNumber"
              label="Phone number"
              error={errors.emergencyContactNumber}
            >
              <Input
                id="emergencyContactNumber"
                type="tel"
                value={formData.emergencyContactNumber}
                onChange={(e) => setField('emergencyContactNumber', e.target.value)}
                placeholder="Their phone number"
                aria-invalid={!!errors.emergencyContactNumber}
                aria-describedby={
                  errors.emergencyContactNumber ? 'emergencyContactNumber-error' : undefined
                }
              />
            </Field>
          </div>
        </Section>

        <Section title="Payment and notes">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="paymentMethod" label="Payment method" error={errors.paymentMethod}>
              <Input
                id="paymentMethod"
                value={formData.paymentMethod}
                onChange={(e) => setField('paymentMethod', e.target.value)}
                placeholder="e.g. Wise, Binance"
                maxLength={100}
              />
            </Field>
            <Field id="paymentInfo" label="Payment details" error={errors.paymentInfo}>
              <Input
                id="paymentInfo"
                value={formData.paymentInfo}
                onChange={(e) => setField('paymentInfo', e.target.value)}
                placeholder="e.g. account number, BinanceID"
                maxLength={500}
              />
            </Field>
          </div>

          <Field id="userComments" label="Anything else we should know" error={errors.userComments}>
            <Textarea
              id="userComments"
              value={formData.userComments}
              onChange={(e) => setField('userComments', e.target.value)}
              placeholder="e.g. medical conditions, accessibility needs, etc."
              maxLength={2000}
              className="min-h-20"
            />
          </Field>
        </Section>
      </form>
    </OnboardingCard>
  );
}
