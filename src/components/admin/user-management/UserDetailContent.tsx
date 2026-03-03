"use client";

import { useState, useEffect, useRef } from 'react';
import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import { validateEmail, validatePhoneNumber, validateRequired } from '@/lib/validation';
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

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
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { ChevronDownIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
  const [dobOpen, setDobOpen] = useState(false);
  const originalDataRef = useRef<FormData>(buildFormData(user));
  const [hasChanges, setHasChanges] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isActive, setIsActive] = useState<boolean>(user.isActive ?? true);
  const [isActiveUpdating, setIsActiveUpdating] = useState(false);
  const [pendingIsActive, setPendingIsActive] = useState<boolean | null>(null);

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

  const handleIsActiveToggle = (checked: boolean) => {
    setPendingIsActive(checked);
  };

  const confirmIsActiveChange = async () => {
    if (pendingIsActive === null) return;
    setIsActiveUpdating(true);
    try {
      await onUpdateUser(user.uid, { isActive: pendingIsActive });
      setIsActive(pendingIsActive);
    } catch (err) {
      console.error('Failed to update isActive:', err);
    } finally {
      setIsActiveUpdating(false);
      setPendingIsActive(null);
    }
  };

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
    <>
    <div className="flex flex-col h-[calc(100vh-65px)]">
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* User avatar & info header */}
        <div className="flex items-center gap-4 mb-6">
          <Avatar className="size-14" style={{ background: getAvatarColor((user.displayName || fullName) || 'User') }}>
            {user.photoURL && <AvatarImage src={user.photoURL} alt={user.displayName || fullName} />}
            <AvatarFallback style={{ background: getAvatarColor((user.displayName || fullName) || 'User'), color: '#fff' }}>
              {getInitials(user.displayName || fullName)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              {fullName}
            </div>
            <div className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
              {user.workEmail}
            </div>
          </div>
        </div>

        {/* Account status — instant kill-switch, outside the deferred save form */}
        <div
          className="flex items-center justify-between mb-4 px-3 py-2 rounded-lg"
          style={{ background: isActive ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${isActive ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}
        >
          <div>
            <span className="text-sm font-medium" style={{ color: isActive ? '#22c55e' : '#ef4444' }}>
              {isActive ? 'Account Active' : 'Account Disabled'}
            </span>
            <p className="text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
              {isActive ? 'User can access the system' : 'User is blocked from logging in'}
            </p>
          </div>
          <Checkbox
            checked={isActive}
            onCheckedChange={(checked) => handleIsActiveToggle(checked === true)}
            disabled={isActiveUpdating}
          />
        </div>

        <Accordion type="single" defaultValue="identity">

        {/* Identity Section */}
        <AccordionItem value="identity">
          <AccordionTrigger>Identity</AccordionTrigger>
          <AccordionContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label block mb-1">First Name</label>
                <Input
                  type="text"
                  className={`form-input w-full ${errors.firstName ? 'error' : ''}`}
                  value={formData.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                />
                {errors.firstName && <p className="form-error">{errors.firstName}</p>}
              </div>
              <div>
                <label className="form-label block mb-1">Last Name</label>
                <Input
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
              <Input
                type="text"
                className="form-input w-full"
                value={formData.displayName}
                onChange={(e) => handleChange('displayName', e.target.value)}
              />
            </div>

            <div>
              <label className="form-label block mb-1">Gender</label>
              <RadioGroup
                value={formData.gender}
                onValueChange={(value) => handleChange('gender', value)}
                className="flex gap-6"
              >
                {['Male', 'Female', 'Other'].map((option) => (
                  <div key={option} className="flex items-center gap-2">
                    <RadioGroupItem value={option} id={`gender-detail-${option}`} />
                    <Label htmlFor={`gender-detail-${option}`} className="text-sm cursor-pointer">{option}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div>
              <label className="form-label block mb-1">Date of Birth</label>
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
                      handleChange('DOB', date ? date.toLocaleDateString('en-CA') : '');
                      setDobOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

          </div>
          </AccordionContent>
        </AccordionItem>

        {/* Work Section */}
        <AccordionItem value="work">
          <AccordionTrigger>Work</AccordionTrigger>
          <AccordionContent>
          <div className="space-y-4">
            <div>
              <label className="form-label block mb-1">Job Title</label>
              <Input
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
              <Input
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
                    <Checkbox
                      checked={formData.groups.includes(group.id)}
                      onCheckedChange={() => handleGroupToggle(group.id)}
                    />
                    <span className="text-sm">{group.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formData.includeIdleTime}
                  onCheckedChange={(checked) => handleChange('includeIdleTime', checked === true)}
                />
                <span className="text-sm">Include Idle Time in Totals</span>
              </label>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formData.enableScreenshots}
                  onCheckedChange={(checked) => handleChange('enableScreenshots', checked === true)}
                />
                <span className="text-sm">Enable Screenshots</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label block mb-1">Created At</label>
                <Input
                  type="text"
                  className="form-input w-full"
                  value={user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { timeZone: user.timezone || undefined, year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
                  disabled
                  style={{ opacity: 0.6 }}
                />
              </div>
              <div>
                <label className="form-label block mb-1">Last Login</label>
                <Input
                  type="text"
                  className="form-input w-full"
                  value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('en-US', { timeZone: user.timezone || undefined, year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
                  disabled
                  style={{ opacity: 0.6 }}
                />
              </div>
            </div>
          </div>
          </AccordionContent>
        </AccordionItem>

        {/* Address Section */}
        <AccordionItem value="address">
          <AccordionTrigger>Address</AccordionTrigger>
          <AccordionContent>
          <div className="space-y-3">
            <Input
              type="text"
              className="form-input w-full"
              value={formData.street}
              onChange={(e) => handleChange('street', e.target.value)}
              placeholder="Street address"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="text"
                className="form-input"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
                placeholder="City"
              />
              <Input
                type="text"
                className="form-input"
                value={formData.state}
                onChange={(e) => handleChange('state', e.target.value)}
                placeholder="State / Province"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="text"
                className="form-input"
                value={formData.zipCode}
                onChange={(e) => handleChange('zipCode', e.target.value)}
                placeholder="Zip / Postal code"
              />
              <Input
                type="text"
                className="form-input"
                value={formData.country}
                onChange={(e) => handleChange('country', e.target.value)}
                placeholder="Country"
              />
            </div>
          </div>
          </AccordionContent>
        </AccordionItem>

        {/* Contact Section */}
        <AccordionItem value="contact">
          <AccordionTrigger>Contact</AccordionTrigger>
          <AccordionContent>
          <div className="space-y-4">
            <div>
              <label className="form-label block mb-1">Phone Number</label>
              <div className="flex gap-2 items-start">
                <Input
                  type="text"
                  className="form-input flex-shrink-0 text-center"
                  style={{ width: '72px' }}
                  value={formData.countryCode}
                  onChange={(e) => handleChange('countryCode', e.target.value)}
                  placeholder="+1"
                />
                <Input
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
              <Input
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
              <Input
                type="text"
                className="form-input w-full"
                value={formData.telegramHandle}
                onChange={(e) => handleChange('telegramHandle', e.target.value)}
                placeholder="@username"
              />
            </div>
          </div>
          </AccordionContent>
        </AccordionItem>

        {/* Emergency Contact Section */}
        <AccordionItem value="emergency-contact">
          <AccordionTrigger>Emergency Contact</AccordionTrigger>
          <AccordionContent>
          <div className="space-y-3">
            <Input
              type="text"
              className="form-input w-full"
              value={formData.emergencyContactName}
              onChange={(e) => handleChange('emergencyContactName', e.target.value)}
              placeholder="Emergency contact name"
            />
            <Input
              type="tel"
              className={`form-input w-full ${errors.emergencyContactNumber ? 'error' : ''}`}
              value={formData.emergencyContactNumber}
              onChange={(e) => handleChange('emergencyContactNumber', e.target.value)}
              placeholder="Emergency contact number"
            />
            {errors.emergencyContactNumber && <p className="form-error">{errors.emergencyContactNumber}</p>}
            <Input
              type="email"
              className={`form-input w-full ${errors.emergencyContactEmail ? 'error' : ''}`}
              value={formData.emergencyContactEmail}
              onChange={(e) => handleChange('emergencyContactEmail', e.target.value)}
              placeholder="Emergency contact email"
            />
            {errors.emergencyContactEmail && <p className="form-error">{errors.emergencyContactEmail}</p>}
          </div>
          </AccordionContent>
        </AccordionItem>

        {/* Payment & Notes Section */}
        <AccordionItem value="payment-notes">
          <AccordionTrigger>Payment &amp; Notes</AccordionTrigger>
          <AccordionContent>
          <div className="space-y-4">
            <div>
              <label className="form-label block mb-1">Payment Method</label>
              <Input
                type="text"
                className="form-input w-full"
                value={formData.paymentMethod}
                onChange={(e) => handleChange('paymentMethod', e.target.value)}
                placeholder="e.g., Bank Transfer, PayPal"
              />
            </div>

            <div>
              <label className="form-label block mb-1">Payment Info</label>
              <Input
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
          </AccordionContent>
        </AccordionItem>

        </Accordion>
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
    </div>
      <AlertDialog open={pendingIsActive !== null} onOpenChange={(open) => { if (!open) setPendingIsActive(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingIsActive ? 'Re-enable account access?' : 'Revoke account access?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingIsActive
                ? `This will restore ${user.firstName || user.displayName}'s access to Bluu Backend. They will be able to log in immediately.`
                : `This will immediately block ${user.firstName || user.displayName} from logging in. If they are currently logged in, they will be signed out and redirected to an access-revoked screen within seconds. This action can be undone at any time.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmIsActiveChange}
              style={pendingIsActive === false ? { background: '#ef4444' } : undefined}
            >
              {pendingIsActive ? 'Enable Access' : 'Revoke Access'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
