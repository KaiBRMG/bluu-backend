'use client';

import { Check, ChevronDown, LogOut, Repeat } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ACTION_BLUE } from '@/lib/actionBlue';
import { formatDue, isAssignedTask, isClosed, statusesFor } from '@/lib/taskAccess';
import { TASK_STATUS_COLORS } from '@/lib/taskStatus';
import type { TaskDocument, TaskStatus } from '@/types/task';

/**
 * The status as a pill that is also the control: one click, a menu of the
 * statuses this KIND of task has. It is the most frequent action on the page, so
 * it never opens a dialog.
 */
function StatusPill({
  task,
  onSetStatus,
  className,
}: {
  task: Pick<TaskDocument, 'title' | 'kind' | 'status'>;
  onSetStatus: (status: TaskStatus) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Status of ${task.title || 'task'}: ${task.status}. Change status`}
          className={cn(
            'inline-flex w-[6.25rem] shrink-0 items-center justify-between gap-1 rounded-full px-2 py-0.5',
            'text-xs font-medium transition-[filter] hover:brightness-125',
            'focus-visible:outline-none focus-visible:ring-2',
            TASK_STATUS_COLORS[task.status],
            className
          )}
          style={{ ['--tw-ring-color' as string]: ACTION_BLUE }}
        >
          <span className="truncate">{task.status}</span>
          <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        {statusesFor(task.kind).map(s => (
          <DropdownMenuItem key={s} onSelect={() => s !== task.status && onSetStatus(s)}>
            <span className="flex-1">{s}</span>
            {s === task.status && <Check className="size-3.5 text-zinc-300" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** First non-empty line of the body, for scanning — the full text lives in the dialog. */
function firstLine(text: string): string {
  return text.split('\n').find(l => l.trim())?.replace(/^-\s*/, '').trim() ?? '';
}

export function TaskRow({
  task,
  today,
  onOpen,
  onSetStatus,
}: {
  task: TaskDocument;
  /** `YYYY-MM-DD` in the viewer's zone, for the overdue test. */
  today: string;
  onOpen: () => void;
  onSetStatus: (status: TaskStatus) => void;
}) {
  const closed = isClosed(task);
  const overdue = !closed && task.dueDate !== null && task.dueDate < today;
  const preview = firstLine(task.text);

  return (
    <li className="group relative flex items-center gap-3 rounded-lg py-2 pl-2.5 pr-3 transition-colors hover:bg-white/[0.055] focus-within:bg-white/[0.055]">
      {/* The whole row is one target for "open"; the pill and nothing else sits above it. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${task.title || 'untitled task'}`}
        className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2"
        style={{ ['--tw-ring-color' as string]: ACTION_BLUE }}
      />
      <StatusPill task={task} onSetStatus={onSetStatus} className="relative" />

      <div className="pointer-events-none min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', closed ? 'text-zinc-400 line-through decoration-zinc-600' : 'text-white')}>
          {task.title || 'Untitled'}
        </p>
        <p className="flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-xs text-zinc-400">
          {task.kind === 'role' && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
              <Repeat className="size-3" aria-hidden /> Role
            </span>
          )}
          {task.dueDate && (
            <span className={cn('shrink-0 tabular-nums', overdue && 'font-medium text-red-400')}>
              {overdue ? 'Overdue · ' : 'Due '}
              {formatDue(task.dueDate)}
            </span>
          )}
          {isAssignedTask(task) && (
            <span className="shrink-0">From {task.createdByName ?? 'a deleted user'}</span>
          )}
          {task.blocksClockOut && !closed && (
            <span className="inline-flex shrink-0 items-center gap-1 text-orange-400">
              <LogOut className="size-3" aria-hidden /> Checked at clock-out
            </span>
          )}
          {preview && <span className="min-w-0 truncate">{preview}</span>}
        </p>
      </div>

    </li>
  );
}
