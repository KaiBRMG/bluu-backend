"use client";

import { useState, useEffect, useRef } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { useAuth } from '@/components/AuthProvider';
import { countryCodes, getFlagEmoji } from '@/lib/countryData';
import { validatePersonalInfoForm, PersonalInfoFormData } from '@/lib/validation';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

const AVATAR_COLORS = [
  '#E57373', '#F06292', '#BA68C8', '#7986CB', '#64B5F6',
  '#4DD0E1', '#4DB6AC', '#81C784', '#FFB74D', '#A1887F',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function getAvatarColor(name: string): string {
  return AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  if (!name?.trim()) return '?';
  return name.split(' ').map((p) => p[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?';
}
import { resolveTimezoneFromAddress } from '@/lib/timezoneData';
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronDownIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const initialFormState: PersonalInfoFormData = {
  displayName: '',
  personalEmail: '',
  countryCode: '+1',
  phoneNumber: '',
  gender: '',
  address: {
    street: '',
    city: '',
    state: '',
    zipCode: '',
    country: '',
  },
  DOB: '',
  emergencyContactName: '',
  emergencyContactNumber: '',
  emergencyContactEmail: '',
  telegramHandle: '',
  paymentMethod: '',
  paymentInfo: '',
  userComments: '',
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

interface PersonalInfoFormProps {
  onHasChanges?: (hasChanges: boolean) => void;
}

export default function PersonalInfoForm({ onHasChanges }: PersonalInfoFormProps = {}) {
  const { userData, loading } = useUserData();
  const { user } = useAuth();
  const [formData, setFormData] = useState<PersonalInfoFormData>(initialFormState);
  const originalDataRef = useRef<PersonalInfoFormData | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [dobOpen, setDobOpen] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isRemovingPhoto, setIsRemovingPhoto] = useState(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize form data when userData loads
  useEffect(() => {
    if (userData) {
      const initialData: PersonalInfoFormData = {
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
      };
      setFormData(initialData);
      originalDataRef.current = initialData;
    }
  }, [userData]);

  // Change detection
  useEffect(() => {
    if (originalDataRef.current) {
      const changed = JSON.stringify(formData) !== JSON.stringify(originalDataRef.current);
      setHasChanges(changed);
      onHasChanges?.(changed);
    }
  }, [formData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear save message after 3 seconds
  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveMessage]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const handleAddressChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      address: { ...prev.address, [field]: value },
    }));
  };

  const handleCancel = () => {
    if (originalDataRef.current) {
      setFormData(originalDataRef.current);
      setErrors({});
      setSaveMessage(null);
    }
  };

  const handleSave = async () => {
    // Validate
    const validation = validatePersonalInfoForm(formData, {
      resolveTimezone: resolveTimezoneFromAddress,
    });
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);
    setSaveMessage(null);

    try {
      const idToken = await user?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');

      // Prepare data for API
      const updateData = {
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
      };

      const response = await fetch('/api/user/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update');
      }

      // Update original data reference after successful save
      const prevData = originalDataRef.current;
      originalDataRef.current = { ...formData };
      setHasChanges(false);
      setSaveMessage({ type: 'success', text: 'Changes saved successfully!' });

      // Auto-detect timezone from address when country/city changes
      if (formData.address.country) {
        const addressChanged =
          prevData?.address?.country !== formData.address.country ||
          prevData?.address?.city !== formData.address.city;

        if (addressChanged || !userData?.timezone) {
          const resolved = resolveTimezoneFromAddress(formData.address);
          if (resolved) {
            fetch('/api/user/update', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
              },
              body: JSON.stringify({
                timezone: resolved.timezone,
                timezoneOffset: resolved.timezoneOffset,
              }),
            }).catch(err => console.error('Failed to auto-set timezone:', err));
          }
        }
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save changes',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      setSaveMessage({ type: 'error', text: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP' });
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setSaveMessage({ type: 'error', text: 'File too large. Maximum size is 5MB' });
      return;
    }

    setIsUploadingPhoto(true);
    setSaveMessage(null);

    try {
      const idToken = await user?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');

      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = reader.result as string;

          const response = await fetch('/api/user/upload-photo', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              imageData: base64Data,
              contentType: file.type,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Failed to upload photo');
          }

          setSaveMessage({ type: 'success', text: 'Photo uploaded successfully!' });
        } catch (error) {
          console.error('Upload error:', error);
          setSaveMessage({
            type: 'error',
            text: error instanceof Error ? error.message : 'Failed to upload photo',
          });
        } finally {
          setIsUploadingPhoto(false);
        }
      };

      reader.onerror = () => {
        setSaveMessage({ type: 'error', text: 'Failed to read file' });
        setIsUploadingPhoto(false);
      };

      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Upload error:', error);
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to upload photo',
      });
      setIsUploadingPhoto(false);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = async () => {
    setIsRemovingPhoto(true);
    setSaveMessage(null);

    try {
      const idToken = await user?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');

      const response = await fetch('/api/user/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ photoURL: null }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove photo');
      }

      setSaveMessage({ type: 'success', text: 'Photo removed successfully!' });
    } catch (error) {
      console.error('Remove photo error:', error);
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to remove photo',
      });
    } finally {
      setIsRemovingPhoto(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with action buttons */}
      <div className="flex items-center justify-between mb-6">
        <div>
          {saveMessage && (
            <Alert variant={saveMessage.type === 'error' ? 'destructive' : 'default'} className="py-2 px-3">
              <AlertDescription>{saveMessage.text}</AlertDescription>
            </Alert>
          )}
        </div>
        <div className="flex gap-3">
          {hasChanges && (
            <Button
              type="button"
              onClick={handleCancel}
              variant="outline"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2">
        {/* Profile Photo Section */}
        <div className="mb-8">
          <label className="form-label block mb-3">Profile photo</label>
          <div className="flex items-center gap-4">
            <Avatar className="size-24 text-2xl" style={{ background: getAvatarColor((userData?.displayName || formData.displayName) || 'User') }}>
              {userData?.photoURL && <AvatarImage src={userData.photoURL} alt={userData?.displayName || formData.displayName} />}
              <AvatarFallback className="text-2xl" style={{ background: getAvatarColor((userData?.displayName || formData.displayName) || 'User'), color: '#fff' }}>
                {getInitials(userData?.displayName || formData.displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handlePhotoUpload}
                className="hidden"
                id="photo-upload"
                disabled={isUploadingPhoto || isRemovingPhoto}
              />
              <label
                htmlFor="photo-upload"
                className="text-sm transition-colors cursor-pointer"
                style={{
                  color: isUploadingPhoto || isRemovingPhoto ? 'var(--foreground-muted)' : '#3b82f6',
                  pointerEvents: isUploadingPhoto || isRemovingPhoto ? 'none' : 'auto'
                }}
              >
                {isUploadingPhoto ? 'Uploading...' : 'Upload photo'}
              </label>
              {userData?.photoURL && (
                <Button
                  type="button"
                  variant="link"
                  onClick={handleRemovePhoto}
                  disabled={isUploadingPhoto || isRemovingPhoto}
                  className="h-auto p-0 text-sm"
                  style={{ color: isRemovingPhoto ? 'var(--foreground-muted)' : '#ef4444' }}
                >
                  {isRemovingPhoto ? 'Removing...' : 'Remove photo'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Preferred Nickname */}
        <div className="mb-6">
          <label className="form-label block mb-2">Preferred Nickname</label>
          <Input
            type="text"
            className={`form-input ${errors.displayName ? 'error' : ''}`}
            value={formData.displayName}
            onChange={(e) => handleInputChange('displayName', e.target.value)}
            placeholder="Enter your nickname"
          />
          {errors.displayName && <p className="form-error">{errors.displayName}</p>}
        </div>

        {/* Personal Email */}
        <div className="mb-6">
          <label className="form-label block mb-2">Personal Email</label>
          <Input
            type="email"
            className={`form-input ${errors.personalEmail ? 'error' : ''}`}
            value={formData.personalEmail}
            onChange={(e) => handleInputChange('personalEmail', e.target.value)}
            placeholder="Enter your personal email"
          />
          {errors.personalEmail && <p className="form-error">{errors.personalEmail}</p>}
        </div>

        {/* Phone */}
        <div className="mb-6">
          <label className="form-label block mb-2">Phone</label>
          <div className="flex gap-2">
            {/* Country Code Dropdown */}
            <Popover open={countryDropdownOpen} onOpenChange={setCountryDropdownOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="form-input flex items-center justify-between gap-1 flex-shrink-0"
                  style={{ cursor: 'pointer', width: '108px' }}
                >
                  <span className="truncate text-sm">
                    {getFlagEmoji(countryCodes.find(c => c.dialCode === formData.countryCode)?.code || 'US')}{' '}
                    {formData.countryCode}
                  </span>
                  <ChevronDownIcon style={{ width: '10px', height: '10px', flexShrink: 0 }} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search country..." />
                  <CommandList className="max-h-60">
                    <CommandEmpty>No countries found</CommandEmpty>
                    <CommandGroup>
                      {countryCodes.map((country) => (
                        <CommandItem
                          key={country.code}
                          value={`${country.name} ${country.dialCode}`}
                          onSelect={() => {
                            handleInputChange('countryCode', country.dialCode);
                            setCountryDropdownOpen(false);
                          }}
                        >
                          <span>{getFlagEmoji(country.code)}</span>
                          <span>{country.name}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{country.dialCode}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {/* Phone Number */}
            <Input
              type="tel"
              className={`form-input flex-1 ${errors.phoneNumber ? 'error' : ''}`}
              value={formData.phoneNumber}
              onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
              placeholder="Enter phone number"
            />
          </div>
          {errors.phoneNumber && <p className="form-error">{errors.phoneNumber}</p>}
        </div>

        {/* Gender */}
        <div className="mb-6">
          <label className="form-label block mb-2">Gender</label>
          <RadioGroup
            value={formData.gender}
            onValueChange={(value) => handleInputChange('gender', value)}
            className="flex gap-6"
          >
            {['Male', 'Female', 'Other'].map((option) => (
              <div key={option} className="flex items-center gap-2">
                <RadioGroupItem value={option} id={`gender-settings-${option}`} />
                <Label htmlFor={`gender-settings-${option}`} className="text-sm cursor-pointer">{option}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Date of Birth */}
        <div className="mb-6">
          <label className="form-label block mb-2">Date of Birth</label>
          <Popover open={dobOpen} onOpenChange={setDobOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="form-input flex items-center justify-between gap-2" style={{ cursor: 'pointer' }}>
                {formData.DOB || 'Select date'}
                <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                mode="single"
                selected={formData.DOB ? new Date(formData.DOB + 'T00:00:00') : undefined}
                captionLayout="dropdown"
                onSelect={(date: Date | undefined) => {
                  handleInputChange('DOB', date ? date.toLocaleDateString('en-CA') : '');
                  setDobOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Address Section */}
        <div className="mb-6">
          <label className="form-label block mb-2">Address</label>
          <div className="space-y-3">
            <Input
              type="text"
              className="form-input"
              value={formData.address.street}
              onChange={(e) => handleAddressChange('street', e.target.value)}
              placeholder="Street address"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Input
                  type="text"
                  className={`form-input ${errors.addressCity ? 'error' : ''}`}
                  value={formData.address.city}
                  onChange={(e) => {
                    handleAddressChange('city', e.target.value);
                    if (errors.addressCity) {
                      setErrors(prev => {
                        const next = { ...prev };
                        delete next.addressCity;
                        return next;
                      });
                    }
                  }}
                  placeholder="City"
                />
                {errors.addressCity && <p className="form-error">{errors.addressCity}</p>}
              </div>
              <Input
                type="text"
                className="form-input"
                value={formData.address.state}
                onChange={(e) => handleAddressChange('state', e.target.value)}
                placeholder="State / Province"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="text"
                className="form-input"
                value={formData.address.zipCode}
                onChange={(e) => handleAddressChange('zipCode', e.target.value)}
                placeholder="Zip / Postal code"
              />
              <div>
                <Input
                  type="text"
                  className={`form-input ${errors.addressCountry ? 'error' : ''}`}
                  value={formData.address.country}
                  onChange={(e) => {
                    handleAddressChange('country', e.target.value);
                    if (errors.addressCountry) {
                      setErrors(prev => {
                        const next = { ...prev };
                        delete next.addressCountry;
                        return next;
                      });
                    }
                  }}
                  placeholder="Country"
                />
                {errors.addressCountry && <p className="form-error">{errors.addressCountry}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Emergency Contact Section */}
        <div className="mb-6">
          <label className="form-label block mb-2">Emergency Contact</label>
          <div className="space-y-3">
            <Input
              type="text"
              className="form-input"
              value={formData.emergencyContactName}
              onChange={(e) => handleInputChange('emergencyContactName', e.target.value)}
              placeholder="Emergency contact name"
            />
            <Input
              type="tel"
              className={`form-input ${errors.emergencyContactNumber ? 'error' : ''}`}
              value={formData.emergencyContactNumber}
              onChange={(e) => handleInputChange('emergencyContactNumber', e.target.value)}
              placeholder="Emergency contact number"
            />
            {errors.emergencyContactNumber && <p className="form-error">{errors.emergencyContactNumber}</p>}
            <Input
              type="email"
              className={`form-input ${errors.emergencyContactEmail ? 'error' : ''}`}
              value={formData.emergencyContactEmail}
              onChange={(e) => handleInputChange('emergencyContactEmail', e.target.value)}
              placeholder="Emergency contact email"
            />
            {errors.emergencyContactEmail && <p className="form-error">{errors.emergencyContactEmail}</p>}
          </div>
        </div>

        {/* Telegram Handle */}
        <div className="mb-6">
          <label className="form-label block mb-2">Telegram Handle</label>
          <Input
            type="text"
            className="form-input"
            value={formData.telegramHandle}
            onChange={(e) => handleInputChange('telegramHandle', e.target.value)}
            placeholder="@username"
          />
        </div>

        {/* Payment Method */}
        <div className="mb-6">
          <label className="form-label block mb-2">Payment Method</label>
          <Input
            type="text"
            className="form-input"
            value={formData.paymentMethod}
            onChange={(e) => handleInputChange('paymentMethod', e.target.value)}
            placeholder="e.g., Bank Transfer, PayPal"
          />
        </div>

        {/* Payment Info */}
        <div className="mb-6">
          <label className="form-label block mb-2">Payment Info</label>
          <Input
            type="text"
            className="form-input"
            value={formData.paymentInfo}
            onChange={(e) => handleInputChange('paymentInfo', e.target.value)}
            placeholder="Account details or payment address"
          />
        </div>

        {/* User Comments */}
        <div className="mb-6">
          <label className="form-label block mb-2">Comments</label>
          <textarea
            className="form-input min-h-24 resize-y"
            value={formData.userComments}
            onChange={(e) => handleInputChange('userComments', e.target.value)}
            placeholder="Any additional notes or comments"
          />
        </div>
      </div>

    </div>
  );
}
