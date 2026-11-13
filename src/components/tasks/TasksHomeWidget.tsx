'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Circle, CircleCheck, LogOut } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useBootPhase } from '@/contexts/BootLoaderContext';
import { useTasks } from '@/hooks/useTasks';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { ACTION_BLUE } from '@/lib/actionBlue';
import { compareByDueThenRecent, formatDue, isAssignedTask, isClosed, isOutstanding } from '@/lib/taskAccess';
import { todayStr } from '@/lib/utils/timezone';
import { cn } from '@/lib/utils';
import type { TaskDocument } from '@/types/task';

const TASKS_HREF = '/applications/apps-tasks';
/** Rows shown before "+N more" — the widget is a glance, the page is the list. */
const MAX_ROWS = 5;
const MAX_ROLE_CHIPS = 3;

/**
 * Home widget: your own outstanding tasks, soonest due first, and the roles you
 * hold. The one action is checking a task off (with an Undo) — everything else
 * lives on the Tasks page, one click away.
 *
 * Always YOUR tasks: for an admin `useTasks` also returns everyone's, so the
 * assignee filter here is what keeps the widget personal.
 */
export function TasksHomeWidget() {
  const { tasks, loading, actor, setStatus } = useTasks();
  const { timezone } = useViewerTimezone();
  useBootPhase('home-tasks', loading);
  const today = todayStr(timezone);

  const { open, roles } = useMemo(() => {
    const mine = (tasks ?? []).filter(t => t.assigneeUid === actor.uid);
    return {
      open: mine.filter(t => t.kind === 'once-off' && !isClosed(t)).sort(compareByDueThenRecent),
      roles: mine.filter(t => t.kind === 'role' && isOutstanding(t)).sort((a, b) => a.title.localeCompare(b.title)),
    };
  }, [tasks, actor.uid]);

  const markDone = (task: TaskDocument) => {
    const previous = task.status;
    setStatus(task.id, 'Done').then(
      () =>
        toast('Marked done', {
          description: task.title,
          action: {
            label: 'Undo',
            onClick: () =>
              void setStatus(task.id, previous).catch(e =>
                toast.error(e instanceof Error ? e.message : 'Could not undo')
              ),
          },
        }),
      e => toast.error(e instanceof Error ? e.message : 'Could not update the task')
    );
  };

  const shown = open.slice(0, MAX_ROWS);
  const hidden = open.length - shown.length;

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            Tasks
            {open.length > 0 && <span className="tabular-nums text-zinc-400">{open.length}</span>}
          </span>
          <Link href={TASKS_HREF} prefetch={false} className="text-xs font-medium text-zinc-400 transition-colors hover:text-white">
            View all
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-1">
                <Skeleton className="size-5 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-[60%]" />
                  <Skeleton className="h-2.5 w-[30%]" />
                </div>
              </div>
            ))}
          </div>
        ) : open.length === 0 && roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing outstanding.{' '}
            <Link href={TASKS_HREF} prefetch={false} className="text-foreground underline underline-offset-2">
              Add a task
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {open.length > 0 ? (
              <ul className="-mx-1 flex flex-col">
                {shown.map(t => {
                  const overdue = t.dueDate !== null && t.dueDate < today;
                  return (
                    <li
                      key={t.id}
                      className="relative flex items-center gap-2.5 rounded-lg px-1 py-1.5 transition-colors focus-within:bg-white/[0.055] hover:bg-white/[0.055]"
                    >
                      {/* Row = one link to the page; only the check button sits above it. */}
                      <Link
                        href={TASKS_HREF}
                        prefetch={false}
                        aria-label={`Open ${t.title || 'untitled task'} in Tasks`}
                        className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2"
                        style={{ ['--tw-ring-color' as string]: ACTION_BLUE }}
                      />
                      <button
                        type="button"
                        onClick={() => markDone(t)}
                        aria-label={`Mark ${t.title || 'task'} done`}
                        title="Mark done"
                        className="group/check relative flex size-7 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2"
                        style={{ ['--tw-ring-color' as string]: ACTION_BLUE }}
                      >
                        <Circle className="size-5 text-zinc-500 group-hover/check:hidden group-focus-visible/check:hidden" aria-hidden />
                        <CircleCheck className="hidden size-5 text-green-400 group-hover/check:block group-focus-visible/check:block" aria-hidden />
                      </button>
                      <div className="pointer-events-none min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{t.title || 'Untitled'}</p>
                        {(t.dueDate || isAssignedTask(t) || t.blocksClockOut) && (
                          <p className="flex items-center gap-x-2 overflow-hidden whitespace-nowrap text-xs text-zinc-400">
                            {t.dueDate && (
                              <span className={cn('shrink-0 tabular-nums', overdue && 'font-medium text-red-400')}>
                                {overdue ? 'Overdue · ' : 'Due '}
                                {formatDue(t.dueDate)}
                              </span>
                            )}
                            {isAssignedTask(t) && <span className="min-w-0 truncate">From {t.createdByName ?? 'a deleted user'}</span>}
                            {t.blocksClockOut && (
                              <span className="inline-flex shrink-0 items-center gap-1 text-orange-400">
                                <LogOut className="size-3" aria-hidden /> Checked at clock-out
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No open tasks.</p>
            )}

            {hidden > 0 && (
              <Link href={TASKS_HREF} prefetch={false} className="text-xs text-zinc-400 transition-colors hover:text-white">
                +{hidden} more
              </Link>
            )}

            {roles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.07] pt-3">
                <span className="mr-1 text-xs text-zinc-400">Roles</span>
                {roles.slice(0, MAX_ROLE_CHIPS).map(r => (
                  <span key={r.id} className="max-w-[10rem] truncate rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
                    {r.title}
                  </span>
                ))}
                {roles.length > MAX_ROLE_CHIPS && (
                  <span className="text-xs tabular-nums text-zinc-400">+{roles.length - MAX_ROLE_CHIPS}</span>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
