"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDownIcon, ShieldCheck } from 'lucide-react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

import OnboardingCard from '../_components/OnboardingCard';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

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

/** A titled group of fields, separated by a hairline rather than nested cards. */
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
    <section
      className="border-t pt-6 first:border-t-0 first:pt-0"
      style={{ borderColor: 'rgba(255,255,255,0.07)' }}
    >
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {description && <p className="mt-1 text-xs text-zinc-400">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
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

  const [formData, setFormData] = useState<PersonalInfoFormData>(initialFormState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [dobOpen, setDobOpen] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLFormElement>(null);

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
      toast.error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP');
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

    const validation = validateOnboardingProfile(formData, {
      resolveTimezone: resolveTimezoneFromAddress,
    });

    if (!validation.isValid) {
      setErrors(validation.errors);
      toast.error('Please complete the highlighted fields');
      // Bring the first problem into view rather than leaving them to hunt.
      requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector('[data-error="true"]')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
  const avatarName = formData.displayName || userData?.displayName || 'User';

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
          <Button type="submit" form="onboarding-profile" disabled={isSubmitting} className="flex-1">
            {isSubmitting ? 'Submitting…' : 'Submit details'}
          </Button>
        </div>
      }
    >
      <h1 className="text-lg font-semibold text-white">Your details</h1>

      <div
        className="mt-4 flex items-start gap-3 rounded-lg border p-4"
        style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <ShieldCheck className="mt-0.5 shrink-0 text-zinc-400" size={18} aria-hidden="true" />
        <p className="max-w-[65ch] text-sm leading-relaxed text-zinc-400">
          Bluu Rock MGMT is a registered company, so we&apos;re required to keep accurate
          personnel records for payroll, tax, and compliance purposes. Fields marked
          <span aria-hidden="true"> *</span> are needed for those records — everything else is
          optional. You can update any of this later in Settings.
        </p>
      </div>

      <form
        id="onboarding-profile"
        onSubmit={handleSubmit}
        noValidate
        ref={scrollRef}
        className="mt-6 max-h-[52vh] space-y-6 overflow-y-auto pr-1"
      >
        <Section title="About you">
          <div className="flex items-center gap-4">
            <Avatar className="size-16 text-lg">
              {userData?.photoURL && <AvatarImage src={userData.photoURL} alt="" />}
              <AvatarFallback
                style={{ background: getAvatarColor(avatarName), color: '#fff' }}
                className="text-lg"
              >
                {getInitials(avatarName)}
              </AvatarFallback>
            </Avatar>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handlePhotoUpload}
                className="hidden"
                id="onboarding-photo"
                disabled={isUploadingPhoto}
              />
              <Label
                htmlFor="onboarding-photo"
                className={`w-fit cursor-pointer text-sm transition-colors ${
                  isUploadingPhoto
                    ? 'pointer-events-none text-zinc-500'
                    : 'text-[#3b82f6] hover:text-[#2563eb]'
                }`}
              >
                {isUploadingPhoto ? 'Uploading…' : 'Upload a profile photo'}
              </Label>
              <p className="mt-0.5 text-xs text-zinc-500">Optional. JPEG, PNG, GIF or WebP, up to 5MB.</p>
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
              id="emergencyContactNumber"
              label="Phone number"
              required
              error={errors.emergencyContactNumber}
            >
              <Input
                id="emergencyContactNumber"
                type="tel"
                value={formData.emergencyContactNumber}
                onChange={(e) => setField('emergencyContactNumber', e.target.value)}
                placeholder="Their phone number"
                aria-required="true"
                aria-invalid={!!errors.emergencyContactNumber}
                aria-describedby={
                  errors.emergencyContactNumber ? 'emergencyContactNumber-error' : undefined
                }
              />
            </Field>
            <Field id="emergencyContactEmail" label="Email" error={errors.emergencyContactEmail}>
              <Input
                id="emergencyContactEmail"
                type="email"
                value={formData.emergencyContactEmail}
                onChange={(e) => setField('emergencyContactEmail', e.target.value)}
                placeholder="Their email"
                aria-invalid={!!errors.emergencyContactEmail}
                aria-describedby={
                  errors.emergencyContactEmail ? 'emergencyContactEmail-error' : undefined
                }
              />
            </Field>
          </div>
        </Section>

        <Section title="Payment and notes" description="Optional — you can add these later in Settings.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="paymentMethod" label="Payment method" error={errors.paymentMethod}>
              <Input
                id="paymentMethod"
                value={formData.paymentMethod}
                onChange={(e) => setField('paymentMethod', e.target.value)}
                placeholder="e.g. Bank transfer, PayPal"
                maxLength={100}
              />
            </Field>
            <Field id="paymentInfo" label="Payment details" error={errors.paymentInfo}>
              <Input
                id="paymentInfo"
                value={formData.paymentInfo}
                onChange={(e) => setField('paymentInfo', e.target.value)}
                placeholder="Account details or address"
                maxLength={500}
              />
            </Field>
          </div>

          <Field id="userComments" label="Anything else we should know" error={errors.userComments}>
            <Textarea
              id="userComments"
              value={formData.userComments}
              onChange={(e) => setField('userComments', e.target.value)}
              placeholder="Allergies, accessibility needs, notes for your manager…"
              maxLength={2000}
              className="min-h-20"
            />
          </Field>
        </Section>
      </form>
    </OnboardingCard>
  );
}
