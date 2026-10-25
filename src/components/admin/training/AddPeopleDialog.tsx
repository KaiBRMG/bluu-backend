'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { splitEmails } from '@/lib/training/emails';

export default function AddPeopleDialog({ onAdd }: { onAdd: (emails: string) => Promise<number> }) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { valid, invalid } = splitEmails(emails);
  const count = valid.length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const added = await onAdd(emails);
      toast.success(added === 0 ? 'Everyone was already on the session' : `Added ${added} ${added === 1 ? 'person' : 'people'}`);
      setEmails('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add them');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus className="size-4" />
          Add people
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add people</DialogTitle>
            <DialogDescription>They can sign in to the training link straight away.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ap-emails" className="text-xs text-zinc-400">
              Emails
            </Label>
            <Textarea id="ap-emails" value={emails} onChange={(e) => setEmails(e.target.value)} rows={5} placeholder="One per line, or paste a list" required />
            <p className="text-[11px] text-zinc-400 tabular-nums">
              {count} {count === 1 ? 'person' : 'people'}
              {invalid.length > 0 && <span className="text-red-400"> · not an email: {invalid.slice(0, 3).join(', ')}</span>}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || count === 0 || invalid.length > 0}>
              {saving && <Loader2 className="activity-spinner size-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
