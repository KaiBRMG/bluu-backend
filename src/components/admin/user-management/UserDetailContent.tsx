"use client";

import { useState, useEffect, useId, useRef } from 'react';
import { toast } from 'sonner';
import type { AdminFullUser } from '@/hooks/useAdminUsers';
import { validateEmail, validatePhoneNumber, validateRequired } from '@/lib/validation';
import { cn } from '@/lib/utils';
import { Button } from "@/components/ui/button";
import { Badge } from '@/components/ui/badge';
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ChevronDownIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useAdminData } from '@/hooks/useAdminData';

interface UserDetailContentProps {
  user: AdminFullUser;
  onUpdateUser: (uid: string, updates: Record<string, unknown>) => Promise<void>;
  onRefetch?: () => Promise<void>;
  onDeleteUser?: () => Promise<void>;
  onClose?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

interface FormData {
  firstName: string;
  lastName: string;
  displayName: string;
  gender: string;
  DOB: string;
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
  enableIdleTimeout: boolean;
  enableScreenshots: boolean;
  hasPaidLeave: boolean;
  remainingUnpaidLeave: string;
  remainingPaidLeave: string;
}

/** Accordion section each validated field lives in, so a failed save can reveal it. */
const FIELD_SECTION: Partial<Record<keyof FormData, string>> = {
  firstName: 'identity',
  lastName: 'identity',
  phoneNumber: 'contact',
  personalEmail: 'contact',
  emergencyContactNumber: 'emergency-contact',
  emergencyContactEmail: 'emergency-contact',
  remainingUnpaidLeave: 'time-tracking',
  remainingPaidLeave: 'time-tracking',
};

const SECTION_LABELS: Record<string, string> = {
  identity: 'Identity',
  work: 'Work',
  'time-tracking': 'Time Tracking',
  address: 'Address',
  contact: 'Contact',
  'emergency-contact': 'Emergency Contact',
  'payment-notes': 'Payment & Notes',
};

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contractor', 'Intern'];
const NO_EMPLOYMENT_TYPE = '__none';
const MAX_LEAVE_DAYS = 365;

/**
 * Normalises a stored DOB to the `YYYY-MM-DD` the date input and Calendar use.
 * Both directions stay in local calendar terms — reading it back as UTC used to
 * shift the date by a day for anyone west of Greenwich.
 */
function toDateInputValue(raw: string | null | undefined): string {
  if (!raw) return '';
  const alreadyPlain = /^\d{4}-\d{2}-\d{2}/.exec(raw);
  if (alreadyPlain) return alreadyPlain[0];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-CA');
}

function buildFormData(user: AdminFullUser): FormData {
  return {
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    displayName: user.displayName || '',
    gender: user.gender || '',
    DOB: toDateInputValue(user.DOB),
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
    enableIdleTimeout: user.enableIdleTimeout ?? true,
    enableScreenshots: user.enableScreenshots ?? true,
    hasPaidLeave: user.hasPaidLeave ?? false,
    remainingUnpaidLeave: String(user.remainingUnpaidLeave ?? 4),
    remainingPaidLeave: String(user.remainingPaidLeave ?? 10),
  };
}

function validateLeaveDays(value: string, label: string): string | null {
  if (value.trim() === '') return `${label} is required`;
  if (!/^\d+$/.test(value.trim())) return `${label} must be a whole number`;
  const parsed = Number(value);
  if (parsed > MAX_LEAVE_DAYS) return `${label} cannot exceed ${MAX_LEAVE_DAYS}`;
  return null;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function UserDetailContent({
  user,
  onUpdateUser,
  onRefetch,
  onDeleteUser,
  onClose,
  onDirtyChange,
}: UserDetailContentProps) {
  const { pagePermissions, updatePermission } = useAdminData();
  const scope = useId();
  const fid = (name: string) => `${scope}-${name}`;
  const formId = fid('record-form');

  const [formData, setFormData] = useState<FormData>(() => buildFormData(user));
  const [dobOpen, setDobOpen] = useState(false);
  const originalDataRef = useRef<FormData>(buildFormData(user));
  const [hasChanges, setHasChanges] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [openSections, setOpenSections] = useState<string[]>(['identity']);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isActive, setIsActive] = useState<boolean>(user.isActive ?? true);
  const [isActiveUpdating, setIsActiveUpdating] = useState(false);
  const [pendingIsActive, setPendingIsActive] = useState<boolean | null>(null);
  const [isTimeTrackingUpdating, setIsTimeTrackingUpdating] = useState(false);
  const [timeTrackingOverride, setTimeTrackingOverride] = useState<boolean | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showEnableConfirm, setShowEnableConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);

  const timeTrackingPermDoc = pagePermissions.find((p) => p.pageId === 'time-tracking');
  const enableTimeTracking =
    timeTrackingOverride ?? (user.permittedPageIds?.includes('time-tracking') ?? false);

  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName;
  const shortName = user.firstName || user.displayName || fullName;
  const deleteConfirmPhrase = fullName || user.workEmail;
  const isArchived = !!user.isArchived;

  // Change detection — the drawer reads this to guard against closing over edits.
  useEffect(() => {
    const changed = JSON.stringify(formData) !== JSON.stringify(originalDataRef.current);
    setHasChanges(changed);
    onDirtyChange?.(changed);
  }, [formData, onDirtyChange]);

  // Keep the access switch honest if the record changes underneath us (another
  // admin, or a refetch triggered by a save on this same panel).
  useEffect(() => {
    setIsActive(user.isActive ?? true);
  }, [user.isActive]);

  // Focus the first invalid field once its accordion section has actually opened.
  useEffect(() => {
    if (!pendingFocusId) return;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(pendingFocusId);
        el?.focus();
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setPendingFocusId(null);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocusId]);

  const errorCountFor = (section: string) =>
    (Object.keys(errors) as (keyof FormData)[]).filter((f) => FIELD_SECTION[f] === section).length;

  const confirmArchive = async () => {
    setIsActionSubmitting(true);
    try {
      await onUpdateUser(user.uid, { isActive: false, isArchived: true });
      toast.success(`${shortName} archived`, {
        description: 'They are signed out and moved to Archived Users. No data was deleted.',
      });
      setShowArchiveConfirm(false);
      onClose?.();
    } catch (err) {
      toast.error('Could not archive this user', { description: errorMessage(err, 'Please try again.') });
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const confirmEnable = async () => {
    setIsActionSubmitting(true);
    try {
      await onUpdateUser(user.uid, { isArchived: false, isActive: true });
      toast.success(`${shortName} restored`, {
        description: 'They are back in the Employee Registry and can log in.',
      });
      setShowEnableConfirm(false);
      onClose?.();
    } catch (err) {
      toast.error('Could not restore this user', { description: errorMessage(err, 'Please try again.') });
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!onDeleteUser || deleteConfirmText.trim() !== deleteConfirmPhrase) return;
    setIsActionSubmitting(true);
    try {
      await onDeleteUser();
      toast.success(`${shortName} permanently deleted`, {
        description: 'Their account and all associated data have been removed.',
      });
      setShowDeleteConfirm(false);
    } catch (err) {
      toast.error('Could not delete this user', { description: errorMessage(err, 'Please try again.') });
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const confirmIsActiveChange = async () => {
    if (pendingIsActive === null) return;
    const next = pendingIsActive;
    setIsActiveUpdating(true);
    try {
      await onUpdateUser(user.uid, { isActive: next });
      setIsActive(next);
      toast.success(next ? `Access restored for ${shortName}` : `Access revoked for ${shortName}`);
    } catch (err) {
      toast.error('Could not change account access', { description: errorMessage(err, 'Please try again.') });
    } finally {
      setIsActiveUpdating(false);
      setPendingIsActive(null);
    }
  };

  const handleTimeTrackingToggle = async (checked: boolean) => {
    setIsTimeTrackingUpdating(true);
    setTimeTrackingOverride(checked);
    try {
      const currentGroups = { ...(timeTrackingPermDoc?.groups || {}) } as Record<string, true>;
      const currentUsers = { ...(timeTrackingPermDoc?.users || {}) } as Record<string, true>;
      if (checked) {
        currentUsers[user.uid] = true;
      } else {
        delete currentUsers[user.uid];
      }
      await updatePermission('time-tracking', { groups: currentGroups, users: currentUsers });
      // updatePermission only refreshes the admin-data cache; permittedPageIds
      // lives on the users list, so without this the switch snaps back.
      await onRefetch?.();
      setTimeTrackingOverride(null);
      toast.success(checked ? 'Time Tracking access granted' : 'Time Tracking access removed');
    } catch (err) {
      setTimeTrackingOverride(null);
      toast.error('Could not update Time Tracking access', {
        description: errorMessage(err, 'Please try again.'),
      });
    } finally {
      setIsTimeTrackingUpdating(false);
    }
  };

  const handleChange = (field: keyof FormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleCancel = () => {
    setFormData(originalDataRef.current);
    setErrors({});
  };

  const handleSave = async () => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};
    const assign = (field: keyof FormData, err: string | null) => {
      if (err) newErrors[field] = err;
    };

    assign('firstName', validateRequired(formData.firstName, 'First name'));
    assign('lastName', validateRequired(formData.lastName, 'Last name'));
    assign('personalEmail', validateEmail(formData.personalEmail));
    assign('phoneNumber', validatePhoneNumber(formData.phoneNumber));
    assign('emergencyContactNumber', validatePhoneNumber(formData.emergencyContactNumber));
    assign('emergencyContactEmail', validateEmail(formData.emergencyContactEmail));
    assign('remainingUnpaidLeave', validateLeaveDays(formData.remainingUnpaidLeave, 'Unpaid leave'));
    if (formData.hasPaidLeave) {
      assign('remainingPaidLeave', validateLeaveDays(formData.remainingPaidLeave, 'Paid leave'));
    }

    const invalidFields = Object.keys(newErrors) as (keyof FormData)[];
    if (invalidFields.length > 0) {
      setErrors(newErrors);

      // Reveal every section holding an error — otherwise the message renders
      // into a collapsed panel and the save looks like it did nothing.
      const sections = Array.from(
        new Set(invalidFields.map((f) => FIELD_SECTION[f]).filter((s): s is string => !!s))
      );
      setOpenSections((prev) => Array.from(new Set([...prev, ...sections])));
      setPendingFocusId(fid(invalidFields[0]));

      toast.error(
        invalidFields.length === 1
          ? 'One field needs fixing before saving'
          : `${invalidFields.length} fields need fixing before saving`,
        { description: sections.map((s) => SECTION_LABELS[s]).join(', ') }
      );
      return;
    }

    setIsSubmitting(true);

    try {
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
        enableIdleTimeout: formData.enableIdleTimeout,
        enableScreenshots: formData.enableScreenshots,
        hasPaidLeave: formData.hasPaidLeave,
        remainingUnpaidLeave: Number(formData.remainingUnpaidLeave),
        remainingPaidLeave: Number(formData.remainingPaidLeave),
      };

      await onUpdateUser(user.uid, profileUpdates);

      originalDataRef.current = { ...formData };
      setHasChanges(false);
      onDirtyChange?.(false);
      toast.success('Changes saved');
    } catch (err) {
      toast.error('Could not save changes', { description: errorMessage(err, 'Please try again.') });
    } finally {
      setIsSubmitting(false);
    }
  };

  const fieldError = (field: keyof FormData) =>
    errors[field] ? (
      <p id={fid(`${field}-error`)} className="form-error">
        {errors[field]}
      </p>
    ) : null;

  const fieldProps = (field: keyof FormData) => ({
    id: fid(field),
    'aria-invalid': !!errors[field],
    'aria-describedby': errors[field] ? fid(`${field}-error`) : undefined,
  });

  const accountState = isArchived
    ? {
        label: 'Archived',
        hint: 'Removed from the registry and blocked from logging in.',
        text: 'text-zinc-300',
        dot: 'bg-zinc-400',
        shell: 'border-zinc-500/30 bg-zinc-500/10',
      }
    : isActive
      ? {
          label: 'Account Active',
          hint: 'Can sign in and use the system.',
          text: 'text-green-400',
          dot: 'bg-green-400',
          shell: 'border-green-500/30 bg-green-500/10',
        }
      : {
          label: 'Account Disabled',
          hint: 'Blocked from logging in.',
          text: 'text-red-400',
          dot: 'bg-red-400',
          shell: 'border-red-500/30 bg-red-500/10',
        };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {/* Access & permissions — every control here writes immediately. */}
          <section
            aria-labelledby={fid('access-heading')}
            className="mb-6 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"
          >
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 id={fid('access-heading')} className="text-sm font-semibold">
                Access &amp; Permissions
              </h3>
              <span className="text-xs text-zinc-400">Applies immediately</span>
            </div>

            <div className={cn('flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5', accountState.shell)}>
              <div className="flex items-center gap-2.5">
                <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', accountState.dot)} />
                <div>
                  <Label htmlFor={fid('isActive')} className={cn('text-sm font-medium', accountState.text)}>
                    {accountState.label}
                  </Label>
                  <p className="mt-0.5 text-xs text-zinc-400">{accountState.hint}</p>
                </div>
              </div>
              <Switch
                id={fid('isActive')}
                checked={isActive}
                onCheckedChange={(checked) => setPendingIsActive(checked === true)}
                disabled={isActiveUpdating || isArchived}
              />
            </div>
            {isArchived && (
              <p className="mt-2 text-xs text-zinc-400">
                Restore this user from the archive to change their access.
              </p>
            )}

            <div className="mt-4 flex items-start justify-between gap-4">
              <div>
                <Label htmlFor={fid('timeTracking')} className="text-sm font-medium">
                  Time Tracking Access
                </Label>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Grants this user the Time Tracking page.
                </p>
              </div>
              <Switch
                id={fid('timeTracking')}
                checked={enableTimeTracking}
                onCheckedChange={(checked) => handleTimeTrackingToggle(checked === true)}
                disabled={isTimeTrackingUpdating}
              />
            </div>
          </section>

          {/* Employee record — deferred, saved with the footer button. */}
          <form
            id={formId}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">Employee Record</h3>
              <span className="text-xs text-zinc-400">Saved with the button below</span>
            </div>

            <Accordion type="multiple" value={openSections} onValueChange={setOpenSections}>
              {/* Identity Section */}
              <AccordionItem value="identity">
                <AccordionTrigger>
                  <SectionLabel section="identity" count={errorCountFor('identity')} />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor={fid('firstName')} className="mb-1 block text-xs text-zinc-400">
                          First Name
                        </Label>
                        <Input
                          type="text"
                          className={`form-input w-full ${errors.firstName ? 'error' : ''}`}
                          value={formData.firstName}
                          onChange={(e) => handleChange('firstName', e.target.value)}
                          {...fieldProps('firstName')}
                        />
                        {fieldError('firstName')}
                      </div>
                      <div>
                        <Label htmlFor={fid('lastName')} className="mb-1 block text-xs text-zinc-400">
                          Last Name
                        </Label>
                        <Input
                          type="text"
                          className={`form-input w-full ${errors.lastName ? 'error' : ''}`}
                          value={formData.lastName}
                          onChange={(e) => handleChange('lastName', e.target.value)}
                          {...fieldProps('lastName')}
                        />
                        {fieldError('lastName')}
                      </div>
                    </div>

                    <div>
                      <Label htmlFor={fid('displayName')} className="mb-1 block text-xs text-zinc-400">
                        Preferred Nickname
                      </Label>
                      <Input
                        type="text"
                        className="form-input w-full"
                        value={formData.displayName}
                        onChange={(e) => handleChange('displayName', e.target.value)}
                        {...fieldProps('displayName')}
                      />
                    </div>

                    <fieldset>
                      <legend className="mb-1 block text-xs text-zinc-400">Gender</legend>
                      <RadioGroup
                        value={formData.gender}
                        onValueChange={(value) => handleChange('gender', value)}
                        className="flex gap-6"
                      >
                        {['Male', 'Female', 'Other'].map((option) => (
                          <div key={option} className="flex items-center gap-2">
                            <RadioGroupItem value={option} id={fid(`gender-${option}`)} />
                            <Label htmlFor={fid(`gender-${option}`)} className="cursor-pointer text-sm">
                              {option}
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </fieldset>

                    <div>
                      <Label htmlFor={fid('DOB')} className="mb-1 block text-xs text-zinc-400">
                        Date of Birth
                      </Label>
                      <Popover open={dobOpen} onOpenChange={setDobOpen}>
                        <PopoverTrigger asChild>
                          <button
                            id={fid('DOB')}
                            type="button"
                            className="form-input flex cursor-pointer items-center justify-between gap-2"
                          >
                            {formData.DOB || 'Select date'}
                            <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="dark w-auto overflow-hidden p-0" align="start">
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
                <AccordionTrigger>
                  <SectionLabel section="work" count={errorCountFor('work')} />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor={fid('jobTitle')} className="mb-1 block text-xs text-zinc-400">
                        Job Title
                      </Label>
                      <Input
                        type="text"
                        className="form-input w-full"
                        value={formData.jobTitle}
                        onChange={(e) => handleChange('jobTitle', e.target.value)}
                        placeholder="e.g., Chat Agent"
                        {...fieldProps('jobTitle')}
                      />
                    </div>

                    <div>
                      <Label htmlFor={fid('employmentType')} className="mb-1 block text-xs text-zinc-400">
                        Employment Type
                      </Label>
                      <Select
                        value={formData.employmentType || NO_EMPLOYMENT_TYPE}
                        onValueChange={(value) =>
                          handleChange('employmentType', value === NO_EMPLOYMENT_TYPE ? '' : value)
                        }
                      >
                        <SelectTrigger id={fid('employmentType')} className="form-input w-full">
                          <SelectValue placeholder="Not set" />
                        </SelectTrigger>
                        <SelectContent className="dark">
                          <SelectItem value={NO_EMPLOYMENT_TYPE}>Not set</SelectItem>
                          {EMPLOYMENT_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
                      <div className="col-span-2">
                        <dt className="text-xs text-zinc-400">Work Email</dt>
                        <dd className="mt-0.5 text-sm break-all">{user.workEmail}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-zinc-400">Time Zone</dt>
                        <dd className="mt-0.5 text-sm">
                          {user.timezone
                            ? `${user.timezone}${user.timezoneOffset ? ` (UTC${user.timezoneOffset})` : ''}`
                            : 'Not set'}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-zinc-400">Additional Time Zones</dt>
                        <dd className="mt-0.5 text-sm">
                          {user.additionalTimezones && user.additionalTimezones.length > 0
                            ? user.additionalTimezones.join(', ')
                            : 'None'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-zinc-400">Created</dt>
                        <dd className="mt-0.5 text-sm tabular-nums">
                          {user.createdAt
                            ? new Date(user.createdAt).toLocaleDateString('en-US', {
                                timeZone: user.timezone || undefined,
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })
                            : 'Unknown'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-zinc-400">Last Login</dt>
                        <dd className="mt-0.5 text-sm tabular-nums">
                          {user.lastLoginAt
                            ? new Date(user.lastLoginAt).toLocaleDateString('en-US', {
                                timeZone: user.timezone || undefined,
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })
                            : 'Never'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Time Tracking Section */}
              <AccordionItem value="time-tracking">
                <AccordionTrigger>
                  <SectionLabel section="time-tracking" count={errorCountFor('time-tracking')} />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4">
                    {!enableTimeTracking && (
                      <p className="text-xs text-zinc-400">
                        Grant Time Tracking access above to configure these settings.
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-4">
                      <Label
                        htmlFor={fid('enableIdleTimeout')}
                        className={cn('text-sm', !enableTimeTracking && 'text-zinc-500')}
                      >
                        Enable Idle Timeout
                      </Label>
                      <Switch
                        id={fid('enableIdleTimeout')}
                        checked={formData.enableIdleTimeout}
                        onCheckedChange={(checked) => handleChange('enableIdleTimeout', checked === true)}
                        disabled={!enableTimeTracking}
                      />
                    </div>

                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <Label
                          htmlFor={fid('enableScreenshots')}
                          className={cn('text-sm', !enableTimeTracking && 'text-zinc-500')}
                        >
                          Enable Screenshots
                        </Label>
                        <p className="mt-1 text-xs text-zinc-400">
                          Activity % is not monitored when disabled.
                        </p>
                      </div>
                      <Switch
                        id={fid('enableScreenshots')}
                        checked={formData.enableScreenshots}
                        onCheckedChange={(checked) => handleChange('enableScreenshots', checked === true)}
                        disabled={!enableTimeTracking}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <Label
                        htmlFor={fid('hasPaidLeave')}
                        className={cn('text-sm', !enableTimeTracking && 'text-zinc-500')}
                      >
                        Has Paid Leave
                      </Label>
                      <Switch
                        id={fid('hasPaidLeave')}
                        checked={formData.hasPaidLeave}
                        onCheckedChange={(checked) => handleChange('hasPaidLeave', checked === true)}
                        disabled={!enableTimeTracking}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label
                          htmlFor={fid('remainingUnpaidLeave')}
                          className={cn('mb-1 block text-xs text-zinc-400', !enableTimeTracking && 'text-zinc-500')}
                        >
                          Unpaid Leave Remaining
                        </Label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_LEAVE_DAYS}
                          className={`form-input w-full tabular-nums ${errors.remainingUnpaidLeave ? 'error' : ''}`}
                          value={formData.remainingUnpaidLeave}
                          onChange={(e) => handleChange('remainingUnpaidLeave', e.target.value)}
                          disabled={!enableTimeTracking}
                          {...fieldProps('remainingUnpaidLeave')}
                        />
                        {fieldError('remainingUnpaidLeave')}
                      </div>
                      <div>
                        <Label
                          htmlFor={fid('remainingPaidLeave')}
                          className={cn(
                            'mb-1 block text-xs text-zinc-400',
                            (!enableTimeTracking || !formData.hasPaidLeave) && 'text-zinc-500'
                          )}
                        >
                          Paid Leave Remaining
                        </Label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_LEAVE_DAYS}
                          className={`form-input w-full tabular-nums ${errors.remainingPaidLeave ? 'error' : ''}`}
                          value={formData.remainingPaidLeave}
                          onChange={(e) => handleChange('remainingPaidLeave', e.target.value)}
                          disabled={!enableTimeTracking || !formData.hasPaidLeave}
                          {...fieldProps('remainingPaidLeave')}
                        />
                        {fieldError('remainingPaidLeave')}
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Address Section */}
              <AccordionItem value="address">
                <AccordionTrigger>
                  <SectionLabel section="address" count={errorCountFor('address')} />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor={fid('street')} className="mb-1 block text-xs text-zinc-400">
                        Street Address
                      </Label>
                      <Input
                        type="text"
                        className="form-input w-full"
                        value={formData.street}
                        onChange={(e) => handleChange('street', e.target.value)}
                        {...fieldProps('street')}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor={fid('city')} className="mb-1 block text-xs text-zinc-400">
                          City
                        </Label>
                        <Input
                          type="text"
                          className="form-input"
                          value={formData.city}
                          onChange={(e) => handleChange('city', e.target.value)}
                          {...fieldProps('city')}
                        />
                      </div>
                      <div>
                        <Label htmlFor={fid('state')} className="mb-1 block text-xs text-zinc-400">
                          State / Province
                        </Label>
                        <Input
                          type="text"
                          className="form-input"
                          value={formData.state}
                          onChange={(e) => handleChange('state', e.target.value)}
                          {...fieldProps('state')}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor={fid('zipCode')} className="mb-1 block text-xs text-zinc-400">
                          Zip / Postal Code
                        </Label>
                        <Input
                          type="text"
                          className="form-input"
                          value={formData.zipCode}
                          onChange={(e) => handleChange('zipCode', e.target.value)}
                          {...fieldProps('zipCode')}
                        />
                      </div>
                      <div>
                        <Label htmlFor={fid('country')} className="mb-1 block text-xs text-zinc-400">
                          Country
                        </Label>
                        <Input
                          type="text"
                          className="form-input"
                          value={formData.country}
                          onChange={(e) => handleChange('country', e.target.value)}
                          {...fieldProps('country')}
                        />
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Contact Section */}
              <AccordionItem value="contact">
                <AccordionTrigger>
                  <SectionLabel section="contact" count={errorCountFor('contact')} />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4">
                    <div>
                      <span className="mb-1 block text-xs text-zinc-400">Phone Number</span>
                      <div className="flex items-start gap-2">
                        <div className="w-[72px] shrink-0">
                          <Label htmlFor={fid('countryCode')} className="sr-only">
                            Country calling code
                          </Label>
                          <Input
                            type="text"
                            className="form-input text-center"
                            value={formData.countryCode}
                            onChange={(e) => handleChange('countryCode', e.target.value)}
                            placeholder="+1"
                            {...fieldProps('countryCode')}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <Label htmlFor={fid('phoneNumber')} className="sr-only">
                            Phone number
                          </Label>
                          <Input
                            type="tel"
                            className={`form-input w-full ${errors.phoneNumber ? 'error' : ''}`}
                            value={formData.phoneNumber}
                            onChange={(e) => handleChange('phoneNumber', e.target.value)}
                            placeholder="Phone number"
                            {...fieldProps('phoneNumber')}
                          />
                        </div>
                      </div>
                      {fieldError('phoneNumber')}
                    </div>

                    <div>
                      <Label htmlFor={fid('personalEmail')} className="mb-1 block text-xs text-zinc-400">
                        Personal Email
                      </Label>
                      <Input
                        type="email"
                        className={`form-input w-full ${errors.personalEmail ? 'error' : ''}`}
                        value={formData.personalEmail}
                        onChange={(e) => handleChange('personalEmail', e.target.value)}
                        {...fieldProps('personalEmail')}
                      />
                      {fieldError('personalEmail')}
                    </div>

                    <div>
                      <Label htmlFor={fid('telegramHandle')} className="mb-1 block text-xs text-zinc-400">
                        Telegram Handle
                      </Label>
                      <Input
                        type="text"
                        className="form-input w-full"
                        value={formData.telegramHandle}
                        onChange={(e) => handleChange('telegramHandle', e.target.value)}
                        placeholder="@username"
                        {...fieldProps('telegramHandle')}
                      />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Emergency Contact Section */}
              <AccordionItem value="emergency-contact">
                <AccordionTrigger>
                  <SectionLabel section="emergency-contact" count={errorCountFor('emergency-contact')} />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor={fid('emergencyContactName')} className="mb-1 block text-xs text-zinc-400">
                        Name
                      </Label>
                      <Input
                        type="text"
                        className="form-input w-full"
                        value={formData.emergencyContactName}
                        onChange={(e) => handleChange('emergencyContactName', e.target.value)}
                        {...fieldProps('emergencyContactName')}
                      />
                    </div>
                    <div>
                      <Label htmlFor={fid('emergencyContactNumber')} className="mb-1 block text-xs text-zinc-400">
                        Phone Number
                      </Label>
                      <Input
                        type="tel"
                        className={`form-input w-full ${errors.emergencyContactNumber ? 'error' : ''}`}
                        value={formData.emergencyContactNumber}
                        onChange={(e) => handleChange('emergencyContactNumber', e.target.value)}
                        {...fieldProps('emergencyContactNumber')}
                      />
                      {fieldError('emergencyContactNumber')}
                    </div>
                    <div>
                      <Label htmlFor={fid('emergencyContactEmail')} className="mb-1 block text-xs text-zinc-400">
                        Email
                      </Label>
                      <Input
                        type="email"
                        className={`form-input w-full ${errors.emergencyContactEmail ? 'error' : ''}`}
                        value={formData.emergencyContactEmail}
                        onChange={(e) => handleChange('emergencyContactEmail', e.target.value)}
                        {...fieldProps('emergencyContactEmail')}
                      />
                      {fieldError('emergencyContactEmail')}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Payment & Notes Section */}
              <AccordionItem value="payment-notes">
                <AccordionTrigger>
                  <SectionLabel section="payment-notes" count={errorCountFor('payment-notes')} />
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor={fid('paymentMethod')} className="mb-1 block text-xs text-zinc-400">
                        Payment Method
                      </Label>
                      <Input
                        type="text"
                        className="form-input w-full"
                        value={formData.paymentMethod}
                        onChange={(e) => handleChange('paymentMethod', e.target.value)}
                        placeholder="e.g., Bank Transfer, PayPal"
                        {...fieldProps('paymentMethod')}
                      />
                    </div>

                    <div>
                      <Label htmlFor={fid('paymentInfo')} className="mb-1 block text-xs text-zinc-400">
                        Payment Info
                      </Label>
                      <Input
                        type="text"
                        className="form-input w-full"
                        value={formData.paymentInfo}
                        onChange={(e) => handleChange('paymentInfo', e.target.value)}
                        placeholder="Account details or payment address"
                        {...fieldProps('paymentInfo')}
                      />
                    </div>

                    <div>
                      <Label htmlFor={fid('userComments')} className="mb-1 block text-xs text-zinc-400">
                        Comments
                      </Label>
                      <Textarea
                        className="form-input min-h-24 w-full resize-y"
                        value={formData.userComments}
                        onChange={(e) => handleChange('userComments', e.target.value)}
                        placeholder="Any additional notes or comments"
                        {...fieldProps('userComments')}
                      />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </form>
        </div>

        {/* Footer — lifecycle actions kept well clear of the primary action. */}
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle bg-background px-6 py-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="text-zinc-400 hover:text-zinc-200">
                Actions
                <ChevronDownIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="dark min-w-[180px]">
              {isArchived ? (
                <DropdownMenuItem onSelect={() => setShowEnableConfirm(true)}>
                  Restore from Archive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setShowArchiveConfirm(true)}>
                  Archive User
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setDeleteConfirmText('');
                  setShowDeleteConfirm(true);
                }}
              >
                Delete Permanently
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex gap-3">
            {hasChanges && (
              <Button type="button" onClick={handleCancel} variant="outline" disabled={isSubmitting}>
                Cancel
              </Button>
            )}
            <Button type="submit" form={formId} disabled={!hasChanges || isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>

      {/* Archive confirmation */}
      <AlertDialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <AlertDialogContent className="dark">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate {shortName}&apos;s account and move them to the Archived Users list.
              They will be immediately signed out and blocked from logging in. Their data, such as
              timesheets and screenshots, is <strong>not</strong> deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmArchive();
              }}
              disabled={isActionSubmitting}
            >
              {isActionSubmitting ? 'Archiving...' : 'Archive User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore confirmation */}
      <AlertDialog open={showEnableConfirm} onOpenChange={setShowEnableConfirm}>
        <AlertDialogContent className="dark">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this user from the archive?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore {shortName}&apos;s account, move them back into the Employee Registry,
              and allow them to log in immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmEnable();
              }}
              disabled={isActionSubmitting}
            >
              {isActionSubmitting ? 'Restoring...' : 'Restore User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation — irreversible, so it requires typing the name. */}
      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={(open) => {
          setShowDeleteConfirm(open);
          if (!open) setDeleteConfirmText('');
        }}
      >
        <AlertDialogContent className="dark">
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {shortName}&apos;s account and{' '}
              <strong>all of their data</strong> — including their timesheets, screenshots, shifts,
              leave requests, and notifications — remove them from all groups, and revoke all page
              permissions. <strong>This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor={fid('delete-confirm')} className="mb-1 block text-xs text-zinc-400">
              Type <span className="font-medium text-foreground">{deleteConfirmPhrase}</span> to confirm
            </Label>
            <Input
              id={fid('delete-confirm')}
              type="text"
              autoComplete="off"
              className="form-input w-full"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={isActionSubmitting || deleteConfirmText.trim() !== deleteConfirmPhrase}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isActionSubmitting ? 'Deleting...' : 'Delete Permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Account access confirmation */}
      <AlertDialog
        open={pendingIsActive !== null}
        onOpenChange={(open) => {
          if (!open) setPendingIsActive(null);
        }}
      >
        <AlertDialogContent className="dark">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingIsActive ? 'Re-enable account access?' : 'Revoke account access?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingIsActive
                ? `This will restore ${shortName}'s access to Bluu Backend. They will be able to log in immediately.`
                : `This will immediately block ${shortName} from logging in. If they are currently logged in, they will be signed out and redirected to an access-revoked screen within seconds. This action can be undone at any time.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActiveUpdating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmIsActiveChange();
              }}
              disabled={isActiveUpdating}
              className={pendingIsActive === false ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            >
              {isActiveUpdating
                ? 'Updating...'
                : pendingIsActive
                  ? 'Enable Access'
                  : 'Revoke Access'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Accordion trigger label with an error count, so a collapsed section can still shout. */
function SectionLabel({ section, count }: { section: string; count: number }) {
  return (
    <span className="flex items-center gap-2">
      {SECTION_LABELS[section]}
      {count > 0 && (
        <Badge variant="destructive" className="h-5 px-1.5 text-[11px] tabular-nums">
          {count}
        </Badge>
      )}
    </span>
  );
}
