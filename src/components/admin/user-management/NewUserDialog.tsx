'use client';

import { useState } from 'react';
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
}

/**
 * Registers an employee before their first login.
 *
 * This dialog is now the *only* door into the system: the email entered here is
 * what the login allowlist checks, so a typo means the new hire is turned away
 * with "your account is not in the system". That is why the email field carries
 * an explicit warning rather than being just another input.
 */
export default function NewUserDialog({ groups, onCreate }: NewUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [groupId, setGroupId] = useState(UNASSIGNED);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const assignableGroups = groups.filter((g) => g.id !== UNASSIGNED);

  const reset = () => {
    setFirstName('');
    setLastName('');
    setDisplayName('');
    setEmail('');
    setGroupId(UNASSIGNED);
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
      toast.success(`${displayName.trim()} can now sign in with ${email.trim()}`);
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
        <Button size="sm">
          <UserPlus className="size-4" />
          New
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
              />
            </Field>
            <Field id="lastName" label="Last name" error={errors.lastName}>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="off"
                disabled={saving}
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
            />
          </Field>

          <Field
            id="groupId"
            label="User group"
            hint="Decides which pages they can reach. Can be changed later."
          >
            <Select value={groupId} onValueChange={setGroupId} disabled={saving}>
              <SelectTrigger id="groupId" className="w-full">
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
        <p className="text-xs" style={{ color: '#ef4444' }}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-foreground-muted">{hint}</p>
      ) : null}
    </div>
  );
}
