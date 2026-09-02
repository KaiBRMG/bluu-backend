'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2Icon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PLATFORM_LABEL, parseProfileUrl, type GrowthPlatform } from '@/lib/growth/platform';
import type { AddGrowthAccountPayload } from '@/hooks/useGrowthTracking';

const PLACEHOLDER: Record<GrowthPlatform, string> = {
  facebook: 'https://www.facebook.com/adamtwinkx',
  twitter: 'https://x.com/TwinkLoad',
};

/**
 * Add an account to the nightly scrape.
 *
 * Two things shape this dialog, both about cost:
 *
 * The URL is parsed **client-side as you type** with the same function the
 * server uses, so a malformed link is caught before it becomes a billed request.
 * The parse result is shown as the resolved handle rather than a green tick —
 * seeing "@TwinkLoad" is what actually confirms you pasted the right link.
 *
 * Submitting runs a real scrape, so it takes 10–30 seconds and the button says
 * so. That wait is the validation: the server writes nothing unless the account
 * genuinely resolves, and the message on failure is the one the user needs.
 */
export function AddAccountDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (payload: AddGrowthAccountPayload) => Promise<void>;
}) {
  const [platform, setPlatform] = useState<GrowthPlatform>('twitter');
  const [profileUrl, setProfileUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mounted only while open (below), so this resets the draft per opening
  // without an effect syncing props into state.
  useEffect(() => { setError(null); }, [platform, profileUrl]);

  const parsed = profileUrl.trim() ? parseProfileUrl(platform, profileUrl) : null;
  const canSubmit = parsed !== null && !saving;

  const submit = async () => {
    if (!parsed) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd({ platform, profileUrl: profileUrl.trim() });
      toast.success(`Now tracking @${parsed.handle}`);
      onOpenChange(false);
      setProfileUrl('');
    } catch (err) {
      // Stays open with the draft intact — the message usually asks for a
      // correction to the very field they just filled in.
      setError(err instanceof Error ? err.message : 'Could not add that account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Track an account</DialogTitle>
          <DialogDescription>
            Its follower count is read once a night, at midnight UTC. We check the account
            exists now, which takes a few seconds.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="growth-platform" className="mb-1 text-xs text-zinc-400">Platform</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as GrowthPlatform)}>
              <SelectTrigger id="growth-platform" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PLATFORM_LABEL) as GrowthPlatform[]).map((p) => (
                  <SelectItem key={p} value={p}>{PLATFORM_LABEL[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="growth-url" className="mb-1 text-xs text-zinc-400">Profile link</Label>
            <Input
              id="growth-url"
              value={profileUrl}
              onChange={(e) => setProfileUrl(e.target.value)}
              placeholder={PLACEHOLDER[platform]}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="growth-url-hint"
            />
            <p id="growth-url-hint" className="mt-1 text-[11px] text-zinc-400">
              {parsed
                ? <>Reads as <span className="text-zinc-300">@{parsed.handle}</span></>
                : profileUrl.trim()
                  ? `Not a ${PLATFORM_LABEL[platform]} profile link yet.`
                  : 'Paste the link to the page itself.'}
            </p>
          </div>


          {error && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
            {saving ? 'Checking the account…' : 'Start tracking'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
