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

export function validatePersonalInfoForm(data: PersonalInfoFormData): ValidationResult {
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

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
