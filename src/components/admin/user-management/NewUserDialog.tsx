'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isPlausibleEmail } from '@/lib/authEmail';
import type { AdminGroup } from '@/hooks/useAdminUsers';

const UNASSIGNED = 'unassigned';

interface NewUserDialogProps {
  groups: AdminGroup[];
  onCreate: (payload: {
    firstName: string;
    lastName: string;
    displayName: string;
    email: string;
    groupId: string;
  }) => Promise<void>;
  disabled?: boolean;
}

/**
 * Registers an employee before their first login — the page's primary action.
 *
 * This dialog is the *only* door into the system: the email entered here is
 * what the login allowlist checks, so a typo means the new hire is turned away
 * with "your account is not in the system". That is why the email field carries
 * an explicit warning rather than being just another input.
 *
 * The group defaults to the org's default group rather than to "Unassigned".
 * Assigning a group is half of what this action is *for*, and a Select showing
 * "Unassigned — decide later" reads as a filled, deliberate choice rather than
 * as a skipped step — so the old default quietly shipped hires who signed in to
 * an empty sidebar. Unassigned is still available; it just is not the default.
 */
export default function NewUserDialog({ groups, onCreate, disabled = false }: NewUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [groupId, setGroupId] = useState(UNASSIGNED);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const assignableGroups = groups.filter((g) => g.id !== UNASSIGNED);
  const defaultGroupId = groups.find((g) => g.isDefault && g.id !== UNASSIGNED)?.id ?? UNASSIGNED;

  // Groups arrive asynchronously, so the default is seeded when they land
  // rather than in the initial state — but never over a choice already made.
  useEffect(() => {
    if (!open) setGroupId(defaultGroupId);
  }, [defaultGroupId, open]);

  const reset = () => {
    setFirstName('');
    setLastName('');
    setDisplayName('');
    setEmail('');
    setGroupId(defaultGroupId);
    setErrors({});
  };

  const handleOpenChange = (next: boolean) => {
    if (saving) return;
    setOpen(next);
    if (!next) reset();
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.firstName = 'First name is required';
    if (!lastName.trim()) next.lastName = 'Last name is required';
    if (!displayName.trim()) next.displayName = 'Nickname is required';
    if (!email.trim()) next.email = 'Email is required';
    else if (!isPlausibleEmail(email)) next.email = 'Enter a valid email address';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !validate()) return;

    setSaving(true);
    try {
      await onCreate({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName: displayName.trim(),
        email: email.trim(),
        groupId,
      });
      const group = assignableGroups.find((g) => g.id === groupId);
      toast.success(`${displayName.trim()} can now sign in with ${email.trim()}`, {
        description: group
          ? `Added to ${group.name}.`
          : 'No group yet — they can only reach org-wide pages until you assign one.',
      });
      setOpen(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to register user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <UserPlus className="size-4" />
          Add employee
        </Button>
      </DialogTrigger>

      <DialogContent className="dark sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register a new employee</DialogTitle>
          <DialogDescription>
            They can sign in as soon as this is saved. Their first login starts onboarding.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="firstName" label="First name" error={errors.firstName}>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="off"
                disabled={saving}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'firstName-error' : undefined}
              />
            </Field>
            <Field id="lastName" label="Last name" error={errors.lastName}>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="off"
                disabled={saving}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? 'lastName-error' : undefined}
              />
            </Field>
          </div>

          <Field
            id="displayName"
            label="Nickname"
            hint="What the app calls them, and what their avatar is generated from."
            error={errors.displayName}
          >
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="off"
              disabled={saving}
              aria-invalid={!!errors.displayName}
              aria-describedby={errors.displayName ? 'displayName-error' : 'displayName-hint'}
            />
          </Field>

          <Field
            id="email"
            label="Login email"
            hint="Their personal Google account. This exact address is what lets them in — if it's wrong, their login will be blocked."
            error={errors.email}
          >
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@gmail.com"
              autoComplete="off"
              disabled={saving}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : 'email-hint'}
            />
          </Field>

          <Field
            id="groupId"
            label="User group"
            hint="Decides which pages they can reach. You can change it on their record later."
          >
            <Select value={groupId} onValueChange={setGroupId} disabled={saving}>
              <SelectTrigger id="groupId" className="w-full" aria-describedby="groupId-hint">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="dark">
                {assignableGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
                <SelectItem value={UNASSIGNED}>Unassigned — decide later</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Registering…
                </>
              ) : (
                'Register'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        // `role="alert"` so a validation failure is announced, not just painted.
        // Status red is the palette's -400 step: #ef4444 measures 3.56:1 on this
        // surface and fails AA (DESIGN.md §2).
        <p id={`${id}-error`} role="alert" className="text-xs text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
