'use client';

import { useCallback, useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { auth } from '@/firebase-config';
import {
  DEFAULT_SNIP_SHORTCUT,
  SNIP_RETENTION_OPTIONS,
  type SnipRetention,
  type SnipSettings,
} from '@/lib/snips';
import { ShortcutRecorder } from './ShortcutRecorder';

/**
 * The settings card behind the page's gear button.
 *
 * A `Popover`, not a dialog — DESIGN.md's "don't reach for a modal first". These
 * are four preferences that a user adjusts while looking at their snips, not a
 * task that deserves to take the screen.
 *
 * **Every change saves immediately**, with no Save button. The toggles arm
 * native surfaces (a tray item, a global accelerator) whose effect is instantly
 * visible outside the app, so a staged edit would leave the setting and the
 * machine disagreeing until the user found the button.
 */
export function SnipSettingsPopover({
  settings,
  platform,
}: {
  /** The live value off the `users/{uid}` snapshot. It is the authority: the
   *  draft below exists only for the moment a save is in flight. */
  settings: SnipSettings;
  platform: 'darwin' | 'other';
}) {
  // Local mirror so a toggle flips under the cursor rather than after a round
  // trip, reconciled from the prop whenever the server's answer lands.
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  const save = useCallback(
    async (patch: Partial<SnipSettings>) => {
      const previous = draft;
      const optimistic = { ...draft, ...patch };
      setDraft(optimistic);
      setSaving(true);
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error('Session expired — sign in again.');

        const res = await fetch('/api/snips/settings', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          let message = 'Could not save that setting';
          // Guarded: a non-JSON error body (an HTML 500, a proxy timeout) would
          // otherwise throw a SyntaxError that replaces the real failure.
          try {
            const body = await res.json();
            if (typeof body?.error === 'string' && body.error) message = body.error;
          } catch {}
          throw new Error(message);
        }

        const { settings: saved } = (await res.json()) as { settings: SnipSettings };
        // The snapshot will deliver this within a beat and the effect above will
        // reconcile; applying it here closes the gap in between.
        setDraft(saved);

        // Retention is the one change with a consequence the user cannot see on
        // this card — it re-dates every snip they already have — so it is the
        // one that says what it did.
        if (patch.retention) {
          toast.success(
            patch.retention === 'never'
              ? 'Snips will be kept until you delete them'
              : `Snips will be deleted after ${SNIP_RETENTION_OPTIONS.find(o => o.value === patch.retention)?.label}`,
            { description: 'Applied to snips you already have, counted from when each was taken.' },
          );
        }
      } catch (error) {
        setDraft(previous);
        toast.error(error instanceof Error ? error.message : 'Could not save that setting');
      } finally {
        setSaving(false);
      }
    },
    [draft],
  );

  const trayLabel = platform === 'darwin' ? 'Menu bar icon' : 'Taskbar tray icon';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="size-8 shrink-0" aria-label="Snipping Tool settings">
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-white/[0.07] px-4 py-3">
          <p className="text-sm font-semibold">Snipping Tool</p>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="snip-tray" className="text-xs text-zinc-400">{trayLabel}</Label>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                One click to start a snip, without opening the app.
              </p>
            </div>
            <Switch
              id="snip-tray"
              checked={draft.trayIconEnabled}
              disabled={saving}
              onCheckedChange={checked => save({ trayIconEnabled: checked })}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="snip-shortcut" className="text-xs text-zinc-400">Keyboard shortcut</Label>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                Works anywhere on this machine.
              </p>
            </div>
            <Switch
              id="snip-shortcut"
              checked={draft.shortcutEnabled}
              disabled={saving}
              onCheckedChange={checked => save({ shortcutEnabled: checked })}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <ShortcutRecorder
              value={draft.shortcut}
              platform={platform}
              disabled={saving || !draft.shortcutEnabled}
              onChange={accelerator => save({ shortcut: accelerator })}
            />
            {draft.shortcut !== DEFAULT_SNIP_SHORTCUT && (
              <Button
                variant="ghost"
                size="xs"
                disabled={saving || !draft.shortcutEnabled}
                className="text-zinc-400 hover:text-zinc-200"
                onClick={() => save({ shortcut: DEFAULT_SNIP_SHORTCUT })}
              >
                Reset
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-white/[0.07] pt-4">
            <Label htmlFor="snip-retention" className="text-xs text-zinc-400">Auto Delete</Label>
            <Select
              value={draft.retention}
              disabled={saving}
              onValueChange={value => save({ retention: value as SnipRetention })}
            >
              <SelectTrigger id="snip-retention" className="h-8 border-zinc-700 bg-zinc-800 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SNIP_RETENTION_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-zinc-400">
              {draft.retention === 'never'
                ? 'Snips are kept until you delete them.'
                : 'Snips and their links are deleted permanently once they reach this age.'}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
