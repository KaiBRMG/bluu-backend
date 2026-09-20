'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, Loader2, RefreshCw, Trash2, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { formatSnipBytes, formatSnipDuration } from '@/lib/snips';
import { safeTimezone } from '@/lib/utils/timezone';
import { cn } from '@/lib/utils';
import type { PendingRecording } from '@/types/electron';

/**
 * Recordings that have not made it to Cloud Storage yet.
 *
 * **This exists because a failed upload used to be silent and permanent.** The
 * bytes are on disk in `userData` either way; without somewhere that says so,
 * the user's only evidence is a recording that never appeared in the grid, and
 * their reasonable conclusion is that it is gone. So this sits above the
 * library rather than inside it: it is a state to clear, not a row to browse.
 *
 * It renders nothing at all when the queue is empty, which is almost always —
 * a permanent empty panel explaining a failure mode nobody is having would be
 * worse than no panel.
 */
export function PendingUploads({ timezone }: {
  /** Resolved by `useViewerTimezone` upstream — never a raw `users` value
   *  (rule 9g). The fallback date below used to be `toISOString()`, i.e. UTC,
   *  on a panel sitting directly above cards formatted in the viewer's zone. */
  timezone: string;
}) {
  const [items, setItems] = useState<PendingRecording[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PendingRecording | null>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.snip;
    if (!api?.listPendingRecordings) return;
    try {
      setItems(await api.listPendingRecordings());
    } catch {
      // A queue we cannot read is one we cannot act on either; leaving the
      // last known list up is better than blanking it.
    }
  }, []);

  useEffect(() => {
    const api = window.electronAPI?.snip;
    if (!api?.listPendingRecordings) return;
    void refresh();
    // Pushed by main whenever the queue changes, so this never polls.
    api.onPendingChanged?.(setItems);
    api.onUploadProgress?.(({ token, sent, total }) => {
      setProgress(prev => ({ ...prev, [token]: total > 0 ? sent / total : 0 }));
    });
    return () => api.removePendingListeners?.();
  }, [refresh]);

  if (items.length === 0) return null;

  const retryAll = () => {
    // `SnipController` owns the upload path — it holds the one-at-a-time lock
    // that stops a retry racing a live capture — so this asks rather than
    // uploading itself.
    window.dispatchEvent(new CustomEvent('bluu:snip-retry-uploads'));
  };

  const save = async (item: PendingRecording) => {
    setBusy(item.token);
    try {
      const result = await window.electronAPI?.snip?.savePendingRecording?.(item.token);
      if (result?.success) {
        toast.success('Recording saved', { description: result.filePath });
      } else if (result && !result.canceled) {
        toast.error(result.error || 'That recording could not be saved');
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: PendingRecording) => {
    // Only claim the delete the shell actually performed. `discardRecording`
    // is optional-chained because an older build may not have it (rule 9c),
    // and an absent bridge returns `undefined` — reporting success there would
    // tell the user their file is gone while it is still on disk.
    const result = await window.electronAPI?.snip?.discardRecording?.(item.token);
    if (result === undefined) {
      toast.error('Update the desktop app to delete a queued recording.');
    } else {
      toast.success('Recording deleted');
    }
    void refresh();
  };

  // **Counted per state, never the whole list against a boolean.** The header
  // used to test "does ANY item say failed?" and then print the count of ALL
  // items beside the words "did not upload" — so one stale failure relabelled
  // every row in the panel, including a recording that was uploading
  // successfully at that moment. A headline that contradicts the row beneath
  // it is why a working upload looked broken.
  const failedCount = items.filter(item => item.state === 'failed').length;
  const uploadingCount = items.filter(item => item.state === 'uploading').length;
  const waitingCount = items.length - failedCount - uploadingCount;
  const anyFailed = failedCount > 0;

  // Only a failure is a warning. An upload in progress wearing an orange alert
  // panel is the interface raising an alarm about itself working.
  const tone = anyFailed
    ? {
        section: 'border-orange-400/25 bg-orange-400/[0.06]',
        divider: 'border-orange-400/20',
        icon: 'text-orange-400',
      }
    : {
        section: 'border-white/[0.07] bg-white/[0.025]',
        divider: 'border-white/[0.06]',
        icon: 'text-zinc-400',
      };

  const StatusIcon = anyFailed ? AlertTriangle : Video;

  const headline = [
    failedCount > 0 && `${failedCount} recording${failedCount === 1 ? '' : 's'} did not upload`,
    uploadingCount > 0 && `${uploadingCount} uploading`,
    waitingCount > 0 && `${waitingCount} waiting to upload`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      className={cn('mb-6 rounded-xl border', tone.section)}
      aria-label={anyFailed ? 'Recordings that did not upload' : 'Recordings waiting to upload'}
    >
      <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3', tone.divider)}>
        <div className="flex items-start gap-2.5">
          {/* Orange, not red, when something has failed: nothing is lost. The
              file is on this machine and the action is a retry — red would say
              "destroyed". Neutral when nothing has. */}
          <StatusIcon className={cn('mt-0.5 size-4 shrink-0', tone.icon)} aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{headline}</h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              {/* The reassurance is the most important sentence here — but only
                  when there is something to be reassured about. */}
              {anyFailed
                ? 'Saved on this computer and retried automatically. Nothing has been lost — you can also save a copy before deleting.'
                : 'Saved on this computer until the upload finishes.'}
            </p>
          </div>
        </div>
        {/* Nothing to retry while the only thing here is already in flight. */}
        {(failedCount > 0 || waitingCount > 0) && (
          <Button variant="outline" size="sm" onClick={retryAll} className="shrink-0">
            <RefreshCw className="size-3.5" />
            Retry now
          </Button>
        )}
      </div>

      <ul className="divide-y divide-white/[0.06]">
        {items.map(item => {
          const pct = progress[item.token];
          const uploading = item.state === 'uploading';
          return (
            <li key={item.token} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Video className="size-4 shrink-0 text-zinc-500" aria-hidden />

              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-zinc-300">
                  <span className="tabular-nums">
                    {item.durationMs > 0 ? formatSnipDuration(item.durationMs) : 'Unknown length'}
                  </span>
                  <span aria-hidden> · </span>
                  <span className="tabular-nums">{formatSnipBytes(item.bytes)}</span>
                  {item.width > 0 && (
                    <>
                      <span aria-hidden> · </span>
                      <span className="tabular-nums">{item.width} × {item.height}</span>
                    </>
                  )}
                  <span aria-hidden> · </span>
                  <span className="tabular-nums">{formatWhen(item.createdAt, timezone)}</span>
                </p>

                {uploading ? (
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Uploading
                    {typeof pct === 'number' && (
                      <span className="tabular-nums"> — {Math.round(pct * 100)}%</span>
                    )}
                  </p>
                ) : item.state === 'failed' ? (
                  // Leads with the state, then the real error — not a
                  // euphemism. The person reading this is deciding whether to
                  // retry or to save a copy and give up, and "something went
                  // wrong" does not help them choose. The state word is here
                  // rather than only in the header because a panel can hold a
                  // failed row and an uploading row at the same time, and a
                  // row has to be readable on its own.
                  <p className="mt-1 text-[11px] text-orange-300">
                    <span className="font-medium">Did not upload</span>
                    <span aria-hidden> — </span>
                    {item.lastError || 'The upload failed'}
                    {item.attempts > 1 && (
                      <span className="text-zinc-400"> · {item.attempts} attempts</span>
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-zinc-400">Waiting to upload</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {uploading ? (
                  // `activity-spinner` claims the reduced-motion exemption in
                  // globals.css. Without it this freezes under
                  // `prefers-reduced-motion`, and a frozen spinner on a row
                  // whose state is "uploading" reads as a hung app.
                  <Loader2
                    className="activity-spinner mx-2 size-4 animate-spin text-zinc-400"
                    aria-hidden
                  />
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-zinc-400 hover:text-zinc-200"
                      aria-label="Save a copy of this recording"
                      title="Save a copy"
                      disabled={busy === item.token}
                      onClick={() => save(item)}
                    >
                      <Download className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-zinc-400 hover:text-destructive"
                      aria-label="Delete this recording without uploading"
                      title="Delete"
                      onClick={() => setConfirming(item)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </div>

              {uploading && typeof pct === 'number' && (
                <div
                  className="h-0.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
                  role="progressbar"
                  aria-label="Upload progress"
                  aria-valuenow={Math.round(pct * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={cn('h-full bg-action-blue transition-[width] duration-300')}
                    style={{ width: `${Math.round(pct * 100)}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Confirmed, because this is the only copy. The grid's delete removes
          something already uploaded and shareable; this removes the last copy
          of a recording that never got anywhere. */}
      <AlertDialog open={!!confirming} onOpenChange={open => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              It never uploaded, so this file on your computer is the only copy.
              Deleting it cannot be undone — save a copy first if you might want
              it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                const item = confirming;
                setConfirming(null);
                if (item) void remove(item);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * Relative for the first day, then a plain date.
 *
 * A queued recording is nearly always from the last few minutes, and "3
 * minutes ago" is what tells the user this is the one they just made. Past a
 * day the exact date matters more than the elapsed time.
 */
function formatWhen(ms: number, timezone: string): string {
  if (!ms) return 'unknown time';
  const elapsed = Date.now() - ms;
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 3_600_000) return `${Math.round(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.round(elapsed / 3_600_000)} h ago`;
  // The viewer's zone, matching `SnipCard` directly below. `toISOString()`
  // here meant a UTC calendar day, which is simply the wrong date for anyone
  // west of Greenwich after midnight UTC.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}
