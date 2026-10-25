'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { splitEmails } from '@/lib/training/emails';
import { TRAINING_MODULES, type TrainingModuleId } from '@/lib/training/modules';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { trainingAdmin } from '@/hooks/useTrainingAdmin';
import { msToWall, wallToMs } from './zonedTime';

const HOUR = 60 * 60 * 1000;
const ACCESS_AFTER_LAST_OPEN_MS = 48 * HOUR;

/**
 * Creates a training session: a name, a module, who is on it, and when each
 * part opens. Source images are attached afterwards, on the session page —
 * they are bulky, and a session with no images is valid until a part opens.
 *
 * "Access ends" follows the last part's open time until the admin touches it,
 * so the common case is two fields and a paste.
 */
export default function CreateSessionDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const { timezone } = useViewerTimezone();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const [moduleId, setModuleId] = useState<TrainingModuleId>(Object.keys(TRAINING_MODULES)[0] as TrainingModuleId);
  const [emails, setEmails] = useState('');
  const [opens, setOpens] = useState<Record<string, string>>({});
  const [closesOverride, setClosesOverride] = useState<string | null>(null);
  const [error, setError] = useState('');

  const mod = TRAINING_MODULES[moduleId];

  // Fresh defaults each time the dialog opens: next whole hour for every part.
  function handleOpenChange(next: boolean) {
    if (saving) return;
    if (next) {
      const nextHour = Math.ceil((Date.now() + 5 * 60_000) / HOUR) * HOUR;
      setOpens(Object.fromEntries(mod.parts.map((p) => [p.id, msToWall(nextHour, timezone)])));
      setClosesOverride(null);
      setLabel('');
      setEmails('');
      setError('');
    }
    setOpen(next);
  }

  const lastOpenMs = useMemo(() => {
    const values = Object.values(opens).map((w) => wallToMs(w, timezone)).filter(Number.isFinite);
    return values.length ? Math.max(...values) : NaN;
  }, [opens, timezone]);

  // "Access ends" follows the last open time until the admin sets it themselves.
  const closes = closesOverride ?? (Number.isFinite(lastOpenMs) ? msToWall(lastOpenMs + ACCESS_AFTER_LAST_OPEN_MS, timezone) : '');

  const { valid, invalid } = splitEmails(emails);
  const count = valid.length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await trainingAdmin<{ id: string }>('sessions', 'POST', {
        label,
        moduleId,
        emails,
        opensAtMs: Object.fromEntries(Object.entries(opens).map(([k, w]) => [k, wallToMs(w, timezone)])),
        closesAtMs: wallToMs(closes, timezone),
      });
      toast.success('Session created');
      setOpen(false);
      onCreated(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the session');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          New session
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New training session</DialogTitle>
            <DialogDescription>
              People you add can sign in at the training link with the email you enter. Times are in your timezone ({timezone}).
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1">
            <Label htmlFor="ts-label" className="text-xs text-zinc-400">
              Session name
            </Label>
            <Input id="ts-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="October intake" maxLength={80} required />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-zinc-400">Module</Label>
            <Select value={moduleId} onValueChange={(v) => setModuleId(v as TrainingModuleId)}>
              <SelectTrigger aria-label="Module">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(TRAINING_MODULES).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="ts-emails" className="text-xs text-zinc-400">
              Emails
            </Label>
            <Textarea
              id="ts-emails"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="One per line, or paste a list"
              rows={5}
              required
            />
            <p className="text-[11px] text-zinc-400 tabular-nums">
              {count} {count === 1 ? 'person' : 'people'}
              {invalid.length > 0 && (
                <span className="text-red-400"> · not an email: {invalid.slice(0, 3).join(', ')}{invalid.length > 3 ? '…' : ''}</span>
              )}
            </p>
          </div>

          {mod.parts.map((part) => (
            <div key={part.id} className="flex flex-col gap-1">
              <Label htmlFor={`ts-open-${part.id}`} className="text-xs text-zinc-400">
                {part.title} opens
              </Label>
              <Input
                id={`ts-open-${part.id}`}
                type="datetime-local"
                value={opens[part.id] ?? ''}
                onChange={(e) => setOpens((prev) => ({ ...prev, [part.id]: e.target.value }))}
                required
              />
            </div>
          ))}

          <div className="flex flex-col gap-1">
            <Label htmlFor="ts-closes" className="text-xs text-zinc-400">
              Access ends
            </Label>
            <Input
              id="ts-closes"
              type="datetime-local"
              value={closes}
              onChange={(e) => setClosesOverride(e.target.value)}
              required
            />
            <p className="text-[11px] text-zinc-400">After this, nobody on the session can sign in to it.</p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || count === 0 || invalid.length > 0 || !label.trim()}>
              {saving && <Loader2 className="activity-spinner size-4 animate-spin" />}
              Create session
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
