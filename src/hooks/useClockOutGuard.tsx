'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { ListTodo, Repeat } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import { ACTION_BLUE_DEEP } from '@/lib/actionBlue';
import { formatDue } from '@/lib/taskAccess';
import type { BlockingTask } from '@/types/task';

const TASKS_HREF = '/applications/apps-tasks';
/** Long enough for a slow link, short enough that it never feels like the button hung. */
const CHECK_TIMEOUT_MS = 2500;

/**
 * Puts a question between the Clock Out button and the clock-out itself when an
 * admin has marked a task or role of the user's as blocking and it is still
 * outstanding. Cancel, Clock Out Anyway, or Go to Tasks (the default).
 *
 * **A nudge, not a lock.** Every failure — offline, a slow answer, a 500 —
 * clocks the user out as normal; a person must never be unable to end their
 * shift because the Tasks service hiccuped. That is also why this lives at the
 * button and not inside `stopTracking`: the soft clock-outs (app close, sign-out,
 * the pre-update install) end a session with nobody at the keyboard to answer a
 * dialog, and must stay unconditional (time-tracking.md).
 *
 * Who is exempt (admins) is decided by `/api/tasks/blocking`, not here.
 * Returns the handler for the button and the `dialog` node to render once.
 */
export function useClockOutGuard() {
  const authFetch = useAuthFetch();
  const { stopTracking } = useTimeTrackingContext();
  const [checking, setChecking] = useState(false);
  const [blocking, setBlocking] = useState<BlockingTask[]>([]);
  const [open, setOpen] = useState(false);
  const inFlight = useRef(false);

  const requestClockOut = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    let outstanding: BlockingTask[] = [];
    try {
      outstanding = (
        await authFetch('/api/tasks/blocking', { cache: 'no-store', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
      ).tasks ?? [];
    } catch {
      // Fail open — see the note above.
    } finally {
      setChecking(false);
      inFlight.current = false;
    }
    if (outstanding.length === 0) {
      await stopTracking();
      return;
    }
    setBlocking(outstanding);
    setOpen(true);
  }, [authFetch, stopTracking]);

  const clockOutAnyway = useCallback(() => {
    setOpen(false);
    void stopTracking();
  }, [stopTracking]);

  const count = blocking.length;
  const dialog = (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent
        // Radix focuses Cancel by default; the default here is Go to Tasks.
        onOpenAutoFocus={e => {
          e.preventDefault();
          document.getElementById('clock-out-guard-go')?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1 ? 'You still have 1 outstanding item' : `You still have ${count} outstanding items`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Your admin asked for {count === 1 ? 'this' : 'these'} to be dealt with before you clock out.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto" aria-label="Outstanding tasks">
          {blocking.map(t => (
            <li
              key={t.id}
              className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-3 py-2 text-sm"
            >
              {t.kind === 'role' ? (
                <Repeat className="size-4 shrink-0 text-zinc-400" aria-label="Role" />
              ) : (
                <ListTodo className="size-4 shrink-0 text-zinc-400" aria-label="Task" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium text-white">{t.title}</span>
              <span className="shrink-0 text-xs text-zinc-400">
                {t.dueDate ? `Due ${formatDue(t.dueDate)} · ` : ''}
                {t.status}
              </span>
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={clockOutAnyway} className="text-red-400 hover:text-red-300">
            Clock Out Anyway
          </Button>
          {/* A real link, so NavigationWatchdog's own click listener arms itself —
              no manual watchNavigation call, and no borrowed telemetry label. */}
          <AlertDialogAction
            asChild
            className="text-white hover:brightness-110 focus-visible:ring-2"
            style={{ backgroundColor: ACTION_BLUE_DEEP }}
          >
            <Link id="clock-out-guard-go" href={TASKS_HREF} prefetch={false}>
              Go to Tasks
            </Link>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { requestClockOut, checking, dialog };
}
