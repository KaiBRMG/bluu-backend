'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  SNIP_DESCRIPTION_MAX,
  SNIP_TITLE_MAX,
  normaliseSnipDescription,
  normaliseSnipTitle,
} from '@/lib/snips';
import type { SnipRow } from '@/types/snips';

/**
 * Name a snip the user already has.
 *
 * **A dialog, not an inline field on the card**, which is the one place this
 * departs from DESIGN.md's "don't reach for a modal first". Two reasons: the
 * card is a 3-column grid cell with no room for a two-field form without
 * reflowing the row its neighbours sit in, and a description is a paragraph —
 * an inline `Textarea` would push every card below it down the page while the
 * user typed.
 *
 * It is deliberately **not** a save-on-blur surface like the settings popover.
 * These are two fields edited together and then done with, so an explicit Save
 * is the honest shape; the popover's toggles arm native surfaces and have to
 * take effect the instant they are flipped, which is a different problem.
 */
export function SnipDetailsDialog({
  snip,
  open,
  onOpenChange,
  onSave,
}: {
  /** The row being edited, or null while the dialog is closed. */
  snip: SnipRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves with the server's row, which is the authority on what was
   *  stored — the normalisers here and on the route must agree, and when they
   *  disagree it is the route that is right. */
  onSave: (snip: SnipRow, values: { title: string; description: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-seeded whenever a different row is opened, and on re-open of the same
  // one — keyed on the id plus the stored values rather than on the `snip`
  // object, whose identity changes every time the grid re-renders around it.
  const seed = `${snip?.id ?? ''}|${snip?.title ?? ''}|${snip?.description ?? ''}`;
  useEffect(() => {
    setTitle(snip?.title ?? '');
    setDescription(snip?.description ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, open]);

  if (!snip) return null;

  // Compared through the normalisers, so trailing whitespace or a title of
  // spaces is not a change — Save would otherwise be enabled on an edit that
  // the server is going to discard.
  const dirty =
    normaliseSnipTitle(title) !== (snip.title ?? null) ||
    normaliseSnipDescription(description) !== (snip.description ?? null);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(snip, { title, description });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save those details');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Snip details</DialogTitle>
          {/* Says where the text ENDS UP, which is the fact that changes what
              someone writes. A field whose contents turn out to be public is
              the kind of surprise that has to be prevented at the point of
              typing, not explained afterwards. */}
          <DialogDescription>
            Both are shown to anyone you send the link to, above the{' '}
            {snip.kind === 'video' ? 'recording' : 'screenshot'}.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={event => {
            event.preventDefault();
            if (!saving) void submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="snip-title" className="text-xs text-zinc-400">Title</Label>
            <Input
              id="snip-title"
              value={title}
              maxLength={SNIP_TITLE_MAX}
              autoFocus
              placeholder="Checkout crash on step 3"
              onChange={event => setTitle(event.target.value)}
            />
            {/* `maxLength` stops the typing silently, so the field has to say
                so before it happens — the description already did, and a cap
                that announces itself in one field and not the other reads as a
                bug in whichever one you hit second. */}
            {title.length > SNIP_TITLE_MAX - 20 && (
              <p className="text-[11px] tabular-nums text-zinc-400">
                {SNIP_TITLE_MAX - title.length} characters left
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="snip-description" className="text-xs text-zinc-400">
              Description
            </Label>
            <Textarea
              id="snip-description"
              value={description}
              maxLength={SNIP_DESCRIPTION_MAX}
              rows={4}
              placeholder="What the recipient should look at, or what you tried."
              onChange={event => setDescription(event.target.value)}
            />
            {/* The counter appears only once it is worth watching. A counter on
                an empty field is a constraint announced before it is relevant. */}
            {description.length > SNIP_DESCRIPTION_MAX - 80 && (
              <p className="text-[11px] tabular-nums text-zinc-400">
                {SNIP_DESCRIPTION_MAX - description.length} characters left
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
