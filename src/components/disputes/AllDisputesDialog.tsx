'use client';

import { PlusIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DisputesWorkspace } from './DisputesWorkspace';

/**
 * Every dispute, on top of the dashboard.
 *
 * The Sale Disputes column carries the decisions with a deadline on them; this
 * is where the reader goes for the rest — the resolved history, the full
 * ledger of what they have claimed, the pagination. It is deliberately **the
 * same `DisputesWorkspace`** the `/ca-portal/disputes` page rendered, not a
 * second build of it, so the page that was removed lost its route and nothing
 * else.
 *
 * Sized like `FullScheduleDialog` and for the same reason: the ledger is a
 * seven-column table with a `min-w-[46rem]` floor, which at the app's default
 * `sm:max-w-lg` would be a horizontal scrollbar around every row. Capped at the
 * viewport height with the body scrolling, so the two feeds never push their
 * own heading off screen.
 */

export function AllDisputesDialog({
  open,
  onOpenChange,
  timezone,
  onNewDispute,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  /** Opens the host's create form — the dialog never owns a second one. */
  onNewDispute: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b border-white/[0.07] px-6 py-4">
          {/* pr-10 keeps the button clear of the dialog's own close control,
              which is absolutely positioned in the same corner. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pr-10">
            <div className="min-w-0">
              <DialogTitle>All disputes</DialogTitle>
              <DialogDescription className="mt-1">
                Claim a sale that landed outside your shift, and rule on the ones raised against
                yours.
              </DialogDescription>
            </div>

            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => {
                // Closed first: the create form is a dialog too, and two
                // stacked modals put the reader behind two overlays with one
                // Esc between them.
                onOpenChange(false);
                onNewDispute();
              }}
            >
              <PlusIcon aria-hidden />
              New dispute
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <DisputesWorkspace userTimezone={timezone} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
