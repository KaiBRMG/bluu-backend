export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

export function validateEmail(email: string): string | null {
  if (!email || email.trim() === '') return null; // Optional field
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'Please enter a valid email address';
  }
  return null;
}

export function validatePhoneNumber(phone: string): string | null {
  if (!phone || phone.trim() === '') return null; // Optional field

  // Remove non-digits for validation
  const digitsOnly = phone.replace(/\D/g, '');

  // General phone validation: 7-15 digits
  if (digitsOnly.length < 7) {
    return 'Phone number is too short (minimum 7 digits)';
  }
  if (digitsOnly.length > 15) {
    return 'Phone number is too long (maximum 15 digits)';
  }

  return null;
}

export function validateRequired(value: string, fieldName: string): string | null {
  if (!value || value.trim() === '') {
    return `${fieldName} is required`;
  }
  return null;
}

/**
 * Date of birth sanity check. Optional when empty — callers that require it
 * layer `validateRequired` on top (see `validateOnboardingProfile`).
 */
export function validateDateOfBirth(dob: string): string | null {
  if (!dob || dob.trim() === '') return null;

  const parsed = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Please enter a valid date';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (parsed > today) return 'Date of birth cannot be in the future';

  // Age in whole years, accounting for whether this year's birthday has passed.
  let age = today.getFullYear() - parsed.getFullYear();
  const monthDelta = today.getMonth() - parsed.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < parsed.getDate())) age--;

  if (age < 16) return 'You must be at least 16 years old';
  if (age > 100) return 'Please enter a valid date of birth';

  return null;
}

export interface PersonalInfoFormData {
  displayName: string;
  personalEmail: string;
  countryCode: string;
  phoneNumber: string;
  gender: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  DOB: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyContactEmail: string;
  telegramHandle: string;
  paymentMethod: string;
  paymentInfo: string;
  userComments: string;
}

export function validatePersonalInfoForm(
  data: PersonalInfoFormData,
  options?: { resolveTimezone?: (address: { city?: string; country?: string }) => unknown | null }
): ValidationResult {
  const errors: Record<string, string> = {};

  // Required field: displayName
  const nicknameError = validateRequired(data.displayName, 'Nickname');
  if (nicknameError) errors.displayName = nicknameError;

  // Email validations
  const personalEmailError = validateEmail(data.personalEmail);
  if (personalEmailError) errors.personalEmail = personalEmailError;

  const emergencyEmailError = validateEmail(data.emergencyContactEmail);
  if (emergencyEmailError) errors.emergencyContactEmail = emergencyEmailError;

  // Phone validations
  const phoneError = validatePhoneNumber(data.phoneNumber);
  if (phoneError) errors.phoneNumber = phoneError;

  const emergencyPhoneError = validatePhoneNumber(data.emergencyContactNumber);
  if (emergencyPhoneError) errors.emergencyContactNumber = emergencyPhoneError;

  // Timezone resolution check: if city or country is provided, both must resolve to a timezone
  if (options?.resolveTimezone && (data.address.city || data.address.country)) {
    const resolved = options.resolveTimezone(data.address);
    if (!resolved) {
      const msg = 'Unable to determine time zone from this location';
      if (data.address.country) errors.addressCountry = msg;
      if (data.address.city) errors.addressCity = msg;
      if (!data.address.country) errors.addressCountry = 'Country is required to determine time zone';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * The fields onboarding requires before a user can enter the workspace, and the
 * label each one reports under. Settings only ever required a nickname; the
 * onboarding step collects the compliance core on top of it.
 *
 * Deliberately excluded (collected, format-validated, but never blocking):
 * gender, telegram handle, payment method/info, comments, and the emergency
 * contact's phone number — email is the required channel for that contact.
 */
const ONBOARDING_REQUIRED_FIELDS: ReadonlyArray<{
  key: keyof Omit<PersonalInfoFormData, 'address'>;
  label: string;
}> = [
  { key: 'displayName', label: 'Nickname' },
  { key: 'personalEmail', label: 'Personal email' },
  { key: 'phoneNumber', label: 'Phone number' },
  { key: 'DOB', label: 'Date of birth' },
  { key: 'emergencyContactName', label: 'Emergency contact name' },
  { key: 'emergencyContactEmail', label: 'Emergency contact email' },
];

const ONBOARDING_REQUIRED_ADDRESS: ReadonlyArray<{
  key: keyof PersonalInfoFormData['address'];
  label: string;
}> = [
  { key: 'street', label: 'Street address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State / province' },
  { key: 'zipCode', label: 'Zip / postal code' },
  { key: 'country', label: 'Country' },
];

/**
 * Onboarding's profile step: every rule `validatePersonalInfoForm` applies,
 * plus required-field enforcement for the compliance core and a DOB sanity
 * check. Error keys match the Settings form's so the two share field wiring —
 * address errors are keyed `addressStreet`, `addressCity`, and so on.
 */
export function validateOnboardingProfile(
  data: PersonalInfoFormData,
  options?: { resolveTimezone?: (address: { city?: string; country?: string }) => unknown | null }
): ValidationResult {
  const { errors } = validatePersonalInfoForm(data, options);

  for (const { key, label } of ONBOARDING_REQUIRED_FIELDS) {
    if (errors[key]) continue; // a format error is more specific than "required"
    const error = validateRequired(data[key], label);
    if (error) errors[key] = error;
  }

  for (const { key, label } of ONBOARDING_REQUIRED_ADDRESS) {
    const errorKey = `address${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    if (errors[errorKey]) continue;
    const error = validateRequired(data.address[key], label);
    if (error) errors[errorKey] = error;
  }

  // Only meaningful once DOB is non-empty, which the required pass above enforces.
  if (!errors.DOB) {
    const dobError = validateDateOfBirth(data.DOB);
    if (dobError) errors.DOB = dobError;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
