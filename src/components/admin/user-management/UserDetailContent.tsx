"use client";

import { useState, useEffect, useRef } from 'react';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import { validateEmail, validatePhoneNumber, validateRequired } from '@/lib/validation';
import UserAvatar from '@/components/UserAvatar';
import AccordionSection from './AccordionSection';

interface UserDetailContentProps {
  user: AdminFullUser;
  groups: AdminGroup[];
  onUpdateUser: (uid: string, updates: Record<string, unknown>) => Promise<void>;
  onAddGroupMembers: (groupId: string, uids: string[]) => Promise<void>;
  onRemoveGroupMember: (groupId: string, uid: string) => Promise<void>;
  onRefetch: () => Promise<void>;
}

interface FormData {
  firstName: string;
  lastName: string;
  displayName: string;
  gender: string;
  DOB: string;
  groups: string[];
  jobTitle: string;
  employmentType: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  countryCode: string;
  phoneNumber: string;
  personalEmail: string;
  telegramHandle: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyContactEmail: string;
  paymentMethod: string;
  paymentInfo: string;
  userComments: string;
  includeIdleTime: boolean;
  enableScreenshots: boolean;
}

function buildFormData(user: AdminFullUser): FormData {
  return {
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    displayName: user.displayName || '',
    gender: user.gender || '',
    DOB: user.DOB ? new Date(user.DOB).toISOString().split('T')[0] : '',
    groups: user.groups || [],
    jobTitle: user.jobTitle || '',
    employmentType: user.employmentType || '',
    street: user.address?.street || '',
    city: user.address?.city || '',
    state: user.address?.state || '',
    zipCode: user.address?.zipCode || '',
    country: user.address?.country || '',
    countryCode: user.contactInfo?.countryCode || '+1',
    phoneNumber: user.contactInfo?.phoneNumber || '',
    personalEmail: user.contactInfo?.personalEmail || '',
    telegramHandle: user.contactInfo?.telegramHandle || '',
    emergencyContactName: user.contactInfo?.emergencyContactName || '',
    emergencyContactNumber: user.contactInfo?.emergencyContactNumber || '',
    emergencyContactEmail: user.contactInfo?.emergencyContactEmail || '',
    paymentMethod: user.paymentMethod || '',
    paymentInfo: user.paymentInfo || '',
    userComments: user.userComments || '',
    includeIdleTime: user.includeIdleTime ?? false,
    enableScreenshots: user.enableScreenshots ?? true,
  };
}

export default function UserDetailContent({
  user,
  groups,
  onUpdateUser,
  onAddGroupMembers,
  onRemoveGroupMember,
  onRefetch,
}: UserDetailContentProps) {
  const [formData, setFormData] = useState<FormData>(() => buildFormData(user));
  const originalDataRef = useRef<FormData>(buildFormData(user));
  const [hasChanges, setHasChanges] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Change detection
  useEffect(() => {
    const changed = JSON.stringify(formData) !== JSON.stringify(originalDataRef.current);
    setHasChanges(changed);
  }, [formData]);

  // Auto-clear save message
  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveMessage]);

  const handleChange = (field: keyof FormData, value: string | boolean | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleGroupToggle = (groupId: string) => {
    setFormData((prev) => {
      const current = prev.groups;
      const next = current.includes(groupId)
        ? current.filter((g) => g !== groupId)
        : [...current, groupId];
      return { ...prev, groups: next };
    });
  };

  const handleCancel = () => {
    setFormData(originalDataRef.current);
    setErrors({});
    setSaveMessage(null);
  };

  const handleSave = async () => {
    // Validate
    const newErrors: Record<string, string> = {};
    const firstNameErr = validateRequired(formData.firstName, 'First name');
    if (firstNameErr) newErrors.firstName = firstNameErr;
    const lastNameErr = validateRequired(formData.lastName, 'Last name');
    if (lastNameErr) newErrors.lastName = lastNameErr;
    const emailErr = validateEmail(formData.personalEmail);
    if (emailErr) newErrors.personalEmail = emailErr;
    const phoneErr = validatePhoneNumber(formData.phoneNumber);
    if (phoneErr) newErrors.phoneNumber = phoneErr;
    const emergencyPhoneErr = validatePhoneNumber(formData.emergencyContactNumber);
    if (emergencyPhoneErr) newErrors.emergencyContactNumber = emergencyPhoneErr;
    const emergencyEmailErr = validateEmail(formData.emergencyContactEmail);
    if (emergencyEmailErr) newErrors.emergencyContactEmail = emergencyEmailErr;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    setSaveMessage(null);

    try {
      // Build profile update payload
      const profileUpdates: Record<string, unknown> = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        displayName: formData.displayName,
        gender: formData.gender,
        DOB: formData.DOB || null,
        jobTitle: formData.jobTitle,
        employmentType: formData.employmentType,
        address: {
          street: formData.street,
          city: formData.city,
          state: formData.state,
          zipCode: formData.zipCode,
          country: formData.country,
        },
        contactInfo: {
          countryCode: formData.countryCode,
          phoneNumber: formData.phoneNumber,
          personalEmail: formData.personalEmail,
          telegramHandle: formData.telegramHandle,
          emergencyContactName: formData.emergencyContactName,
          emergencyContactNumber: formData.emergencyContactNumber,
          emergencyContactEmail: formData.emergencyContactEmail,
        },
        paymentMethod: formData.paymentMethod,
        paymentInfo: formData.paymentInfo,
        userComments: formData.userComments,
        includeIdleTime: formData.includeIdleTime,
        enableScreenshots: formData.enableScreenshots,
      };

      // Update profile fields
      await onUpdateUser(user.uid, profileUpdates);

      // Handle group membership changes
      const originalGroups = originalDataRef.current.groups;
      const addedGroups = formData.groups.filter((g) => !originalGroups.includes(g));
      const removedGroups = originalGroups.filter((g) => !formData.groups.includes(g));

      for (const groupId of addedGroups) {
        await onAddGroupMembers(groupId, [user.uid]);
      }
      for (const groupId of removedGroups) {
        await onRemoveGroupMember(groupId, user.uid);
      }

      // Update original ref on success
      originalDataRef.current = { ...formData };
      setHasChanges(false);
      setSaveMessage({ type: 'success', text: 'Changes saved successfully!' });
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

  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName;

  return (
    <div className="flex flex-col h-[calc(100vh-65px)]">
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* User avatar & info header */}
        <div className="flex items-center gap-4 mb-6">
          <UserAvatar
            photoURL={user.photoURL}
            name={user.displayName || fullName}
            size="lg"
          />
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              {fullName}
            </div>
            <div className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
              {user.workEmail}
            </div>
          </div>
        </div>

        {/* Identity Section */}
        <AccordionSection title="Identity" defaultOpen>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label block mb-1">First Name</label>
                <input
                  type="text"
                  className={`form-input w-full ${errors.firstName ? 'error' : ''}`}
                  value={formData.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                />
                {errors.firstName && <p className="form-error">{errors.firstName}</p>}
              </div>
              <div>
                <label className="form-label block mb-1">Last Name</label>
                <input
                  type="text"
                  className={`form-input w-full ${errors.lastName ? 'error' : ''}`}
                  value={formData.lastName}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                />
                {errors.lastName && <p className="form-error">{errors.lastName}</p>}
              </div>
            </div>

            <div>
              <label className="form-label block mb-1">Display Name</label>
              <input
                type="text"
                className="form-input w-full"
                value={formData.displayName}
                onChange={(e) => handleChange('displayName', e.target.value)}
              />
            </div>

            <div>
              <label className="form-label block mb-1">Gender</label>
              <div className="flex gap-6">
                {['Male', 'Female', 'Other'].map((option) => (
                  <label key={option} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="gender"
                      value={option}
                      checked={formData.gender === option}
                      onChange={(e) => handleChange('gender', e.target.value)}
                      className="w-4 h-4"
                      style={{ accentColor: '#3b82f6' }}
                    />
                    <span className="text-sm">{option}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="form-label block mb-1">Date of Birth</label>
              <input
                type="date"
                className="form-input"
                value={formData.DOB}
                onChange={(e) => handleChange('DOB', e.target.value)}
              />
            </div>

          </div>
        </AccordionSection>

        {/* Work Section */}
        <AccordionSection title="Work">
          <div className="space-y-4">
            <div>
              <label className="form-label block mb-1">Job Title</label>
              <input
                type="text"
                className="form-input w-full"
                value={formData.jobTitle}
                onChange={(e) => handleChange('jobTitle', e.target.value)}
                placeholder="e.g., Chat Agent"
              />
            </div>

            <div>
              <label className="form-label block mb-1">Employment Type</label>
              <select
                className="form-input w-full"
                value={formData.employmentType}
                onChange={(e) => handleChange('employmentType', e.target.value)}
              >
                <option value="">Select...</option>
                <option value="Full-time">Full-time</option>
                <option value="Part-time">Part-time</option>
                <option value="Contractor">Contractor</option>
                <option value="Intern">Intern</option>
              </select>
            </div>

            <div>
              <label className="form-label block mb-1">Work Email</label>
              <input
                type="email"
                className="form-input w-full"
                value={user.workEmail}
                disabled
                style={{ opacity: 0.6 }}
              />
            </div>

            <div>
              <label className="form-label block mb-1">Groups</label>
              <div className="space-y-2">
                {groups.map((group) => (
                  <label key={group.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.groups.includes(group.id)}
                      onChange={() => handleGroupToggle(group.id)}
                      className="w-4 h-4"
                      style={{ accentColor: '#3b82f6' }}
                    />
                    <span className="text-sm">{group.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.includeIdleTime}
                  onChange={(e) => handleChange('includeIdleTime', e.target.checked)}
                  className="w-4 h-4"
                  style={{ accentColor: '#3b82f6' }}
                />
                <span className="text-sm">Include Idle Time in Totals</span>
              </label>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.enableScreenshots}
                  onChange={(e) => handleChange('enableScreenshots', e.target.checked)}
                  className="w-4 h-4"
                  style={{ accentColor: '#3b82f6' }}
                />
                <span className="text-sm">Enable Screenshots</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label block mb-1">Created At</label>
                <input
                  type="text"
                  className="form-input w-full"
                  value={user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                  disabled
                  style={{ opacity: 0.6 }}
                />
              </div>
              <div>
                <label className="form-label block mb-1">Last Login</label>
                <input
                  type="text"
                  className="form-input w-full"
                  value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'N/A'}
                  disabled
                  style={{ opacity: 0.6 }}
                />
              </div>
            </div>
          </div>
        </AccordionSection>

        {/* Address Section */}
        <AccordionSection title="Address">
          <div className="space-y-3">
            <input
              type="text"
              className="form-input w-full"
              value={formData.street}
              onChange={(e) => handleChange('street', e.target.value)}
              placeholder="Street address"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                className="form-input"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
                placeholder="City"
              />
              <input
                type="text"
                className="form-input"
                value={formData.state}
                onChange={(e) => handleChange('state', e.target.value)}
                placeholder="State / Province"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                className="form-input"
                value={formData.zipCode}
                onChange={(e) => handleChange('zipCode', e.target.value)}
                placeholder="Zip / Postal code"
              />
              <input
                type="text"
                className="form-input"
                value={formData.country}
                onChange={(e) => handleChange('country', e.target.value)}
                placeholder="Country"
              />
            </div>
          </div>
        </AccordionSection>

        {/* Contact Section */}
        <AccordionSection title="Contact">
          <div className="space-y-4">
            <div>
              <label className="form-label block mb-1">Phone Number</label>
              <div className="flex gap-2 items-start">
                <input
                  type="text"
                  className="form-input flex-shrink-0 text-center"
                  style={{ width: '72px' }}
                  value={formData.countryCode}
                  onChange={(e) => handleChange('countryCode', e.target.value)}
                  placeholder="+1"
                />
                <input
                  type="tel"
                  className={`form-input flex-1 min-w-0 ${errors.phoneNumber ? 'error' : ''}`}
                  value={formData.phoneNumber}
                  onChange={(e) => handleChange('phoneNumber', e.target.value)}
                  placeholder="Phone number"
                />
              </div>
              {errors.phoneNumber && <p className="form-error">{errors.phoneNumber}</p>}
            </div>

            <div>
              <label className="form-label block mb-1">Personal Email</label>
              <input
                type="email"
                className={`form-input w-full ${errors.personalEmail ? 'error' : ''}`}
                value={formData.personalEmail}
                onChange={(e) => handleChange('personalEmail', e.target.value)}
                placeholder="Personal email"
              />
              {errors.personalEmail && <p className="form-error">{errors.personalEmail}</p>}
            </div>

            <div>
              <label className="form-label block mb-1">Telegram Handle</label>
              <input
                type="text"
                className="form-input w-full"
                value={formData.telegramHandle}
                onChange={(e) => handleChange('telegramHandle', e.target.value)}
                placeholder="@username"
              />
            </div>
          </div>
        </AccordionSection>

        {/* Emergency Contact Section */}
        <AccordionSection title="Emergency Contact">
          <div className="space-y-3">
            <input
              type="text"
              className="form-input w-full"
              value={formData.emergencyContactName}
              onChange={(e) => handleChange('emergencyContactName', e.target.value)}
              placeholder="Emergency contact name"
            />
            <input
              type="tel"
              className={`form-input w-full ${errors.emergencyContactNumber ? 'error' : ''}`}
              value={formData.emergencyContactNumber}
              onChange={(e) => handleChange('emergencyContactNumber', e.target.value)}
              placeholder="Emergency contact number"
            />
            {errors.emergencyContactNumber && <p className="form-error">{errors.emergencyContactNumber}</p>}
            <input
              type="email"
              className={`form-input w-full ${errors.emergencyContactEmail ? 'error' : ''}`}
              value={formData.emergencyContactEmail}
              onChange={(e) => handleChange('emergencyContactEmail', e.target.value)}
              placeholder="Emergency contact email"
            />
            {errors.emergencyContactEmail && <p className="form-error">{errors.emergencyContactEmail}</p>}
          </div>
        </AccordionSection>

        {/* Payment & Notes Section */}
        <AccordionSection title="Payment & Notes">
          <div className="space-y-4">
            <div>
              <label className="form-label block mb-1">Payment Method</label>
              <input
                type="text"
                className="form-input w-full"
                value={formData.paymentMethod}
                onChange={(e) => handleChange('paymentMethod', e.target.value)}
                placeholder="e.g., Bank Transfer, PayPal"
              />
            </div>

            <div>
              <label className="form-label block mb-1">Payment Info</label>
              <input
                type="text"
                className="form-input w-full"
                value={formData.paymentInfo}
                onChange={(e) => handleChange('paymentInfo', e.target.value)}
                placeholder="Account details or payment address"
              />
            </div>

            <div>
              <label className="form-label block mb-1">Comments</label>
              <textarea
                className="form-input w-full min-h-24 resize-y"
                value={formData.userComments}
                onChange={(e) => handleChange('userComments', e.target.value)}
                placeholder="Any additional notes or comments"
              />
            </div>
          </div>
        </AccordionSection>
      </div>

      {/* Footer with Save/Cancel */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--background)' }}
      >
        <div>
          {saveMessage && (
            <span
              className="text-sm"
              style={{ color: saveMessage.type === 'success' ? '#22c55e' : '#ef4444' }}
            >
              {saveMessage.text}
            </span>
          )}
        </div>
        <div className="flex gap-3">
          {hasChanges && (
            <button
              type="button"
              onClick={handleCancel}
              className="btn-secondary"
              disabled={isSubmitting}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="btn-primary"
            disabled={!hasChanges || isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
