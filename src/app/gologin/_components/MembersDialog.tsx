'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import MembersPanel from './MembersPanel';

/**
 * Members — who holds a paid GoLogin seat. Was the first tab of "Management"
 * until 2026-09-30; profile access moved to the Sharing dialog, so this is now
 * members only, gated on the **Add & Remove Members** capability.
 *
 * Removing someone here does two things at once, and both are the point: their
 * GoLogin seat is deleted (so GoLogin itself stops them opening any profile,
 * from GoLogin's own app too), and the window's door — `/api/gologin/access`,
 * which requires a seat — stops opening for them.
 */
export default function MembersDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(78vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b border-white/[0.07] px-6 pb-4 pt-5 text-left">
          <DialogTitle className="text-lg font-semibold text-white">Members</DialogTitle>
          <DialogDescription className="text-[11px] text-zinc-400">
            Add people to the GoLogin workspace, or remove them. Removing someone ends their seat —
            they can no longer open any profile, here or in GoLogin&rsquo;s own app.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          {/* Mounted only while open, so its member read happens on demand. */}
          {open && <MembersPanel onChanged={onChanged} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
