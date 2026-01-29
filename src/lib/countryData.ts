export interface CountryCode {
  code: string;
  dialCode: string;
  name: string;
}

export const countryCodes: CountryCode[] = [
  { code: 'AF', dialCode: '+93', name: 'Afghanistan' },
  { code: 'AL', dialCode: '+355', name: 'Albania' },
  { code: 'DZ', dialCode: '+213', name: 'Algeria' },
  { code: 'AR', dialCode: '+54', name: 'Argentina' },
  { code: 'AU', dialCode: '+61', name: 'Australia' },
  { code: 'AT', dialCode: '+43', name: 'Austria' },
  { code: 'BD', dialCode: '+880', name: 'Bangladesh' },
  { code: 'BE', dialCode: '+32', name: 'Belgium' },
  { code: 'BR', dialCode: '+55', name: 'Brazil' },
  { code: 'BG', dialCode: '+359', name: 'Bulgaria' },
  { code: 'CA', dialCode: '+1', name: 'Canada' },
  { code: 'CL', dialCode: '+56', name: 'Chile' },
  { code: 'CN', dialCode: '+86', name: 'China' },
  { code: 'CO', dialCode: '+57', name: 'Colombia' },
  { code: 'HR', dialCode: '+385', name: 'Croatia' },
  { code: 'CZ', dialCode: '+420', name: 'Czech Republic' },
  { code: 'DK', dialCode: '+45', name: 'Denmark' },
  { code: 'EG', dialCode: '+20', name: 'Egypt' },
  { code: 'FI', dialCode: '+358', name: 'Finland' },
  { code: 'FR', dialCode: '+33', name: 'France' },
  { code: 'DE', dialCode: '+49', name: 'Germany' },
  { code: 'GR', dialCode: '+30', name: 'Greece' },
  { code: 'HK', dialCode: '+852', name: 'Hong Kong' },
  { code: 'HU', dialCode: '+36', name: 'Hungary' },
  { code: 'IN', dialCode: '+91', name: 'India' },
  { code: 'ID', dialCode: '+62', name: 'Indonesia' },
  { code: 'IE', dialCode: '+353', name: 'Ireland' },
  { code: 'IL', dialCode: '+972', name: 'Israel' },
  { code: 'IT', dialCode: '+39', name: 'Italy' },
  { code: 'JP', dialCode: '+81', name: 'Japan' },
  { code: 'KE', dialCode: '+254', name: 'Kenya' },
  { code: 'KR', dialCode: '+82', name: 'South Korea' },
  { code: 'KW', dialCode: '+965', name: 'Kuwait' },
  { code: 'LK', dialCode: '+94', name: 'Sri Lanka' },
  { code: 'MY', dialCode: '+60', name: 'Malaysia' },
  { code: 'MV', dialCode: '+960', name: 'Maldives' },
  { code: 'MX', dialCode: '+52', name: 'Mexico' },
  { code: 'NL', dialCode: '+31', name: 'Netherlands' },
  { code: 'NZ', dialCode: '+64', name: 'New Zealand' },
  { code: 'NG', dialCode: '+234', name: 'Nigeria' },
  { code: 'NO', dialCode: '+47', name: 'Norway' },
  { code: 'PK', dialCode: '+92', name: 'Pakistan' },
  { code: 'PH', dialCode: '+63', name: 'Philippines' },
  { code: 'PL', dialCode: '+48', name: 'Poland' },
  { code: 'PT', dialCode: '+351', name: 'Portugal' },
  { code: 'QA', dialCode: '+974', name: 'Qatar' },
  { code: 'RO', dialCode: '+40', name: 'Romania' },
  { code: 'RU', dialCode: '+7', name: 'Russia' },
  { code: 'SA', dialCode: '+966', name: 'Saudi Arabia' },
  { code: 'SG', dialCode: '+65', name: 'Singapore' },
  { code: 'ZA', dialCode: '+27', name: 'South Africa' },
  { code: 'ES', dialCode: '+34', name: 'Spain' },
  { code: 'SE', dialCode: '+46', name: 'Sweden' },
  { code: 'CH', dialCode: '+41', name: 'Switzerland' },
  { code: 'TW', dialCode: '+886', name: 'Taiwan' },
  { code: 'TH', dialCode: '+66', name: 'Thailand' },
  { code: 'TR', dialCode: '+90', name: 'Turkey' },
  { code: 'UA', dialCode: '+380', name: 'Ukraine' },
  { code: 'AE', dialCode: '+971', name: 'United Arab Emirates' },
  { code: 'GB', dialCode: '+44', name: 'United Kingdom' },
  { code: 'US', dialCode: '+1', name: 'United States' },
  { code: 'VN', dialCode: '+84', name: 'Vietnam' },
];

// Helper to get flag emoji from country code
export function getFlagEmoji(countryCode: string): string {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Get country by dial code
export function getCountryByDialCode(dialCode: string): CountryCode | undefined {
  return countryCodes.find(c => c.dialCode === dialCode);
}

// Get country by code
export function getCountryByCode(code: string): CountryCode | undefined {
  return countryCodes.find(c => c.code === code);
}
