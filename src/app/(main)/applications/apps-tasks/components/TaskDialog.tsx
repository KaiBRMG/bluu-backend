'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ListTodo, LogOut, Pencil, Repeat } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { RICH_TEXT_MARK_CLASSES, RichPromptEditor } from '@/components/rich-text/RichPromptEditor';
import { UserAvatarLabel } from '@/components/UserAvatarLabel';
import { ACTION_BLUE_DEEP } from '@/lib/actionBlue';
import { promptBodyHtml } from '@/lib/promptHtml';
import { canDeleteTask, canEditTask, formatDue, isClosed, defaultStatus, remapStatus, statusesFor, type TaskActor } from '@/lib/taskAccess';
import {
  TASK_TEXT_MAX,
  TASK_TITLE_MAX,
  type TaskDocument,
  type TaskKind,
  type TaskPayload,
  type TaskStatus,
} from '@/types/task';

export interface AssigneeOption {
  uid: string;
  name: string;
  photoURL: string | null;
}

/**
 * One dialog for creating, editing and reading a task.
 *
 *  - **Create** and **edit** show every field the caller may change.
 *  - A task an admin assigned opens **read-only** for its assignee (`canEditTask`
 *    is false): the text is rendered, not editable, and the status select is the
 *    one live control, saving the moment it changes.
 *
 * An existing task always OPENS read-only; **Edit** (offered only where
 * `canEditTask` allows — an admin, or the assignee of a task they made
 * themselves) switches it to the form. Creating opens straight into the form.
 * While reading, the status stays a live control that saves as it changes, so
 * moving a task along never needs Edit.
 *
 * The body is the Prompt Library's `RichPromptEditor` (bold / italic / underline /
 * highlight / bullets, plain-text paste). Saving OVERWRITES the task — Tasks has
 * no version history. Escape, the overlay and Cancel all pass through one
 * discard guard so a half-written task is never dropped silently.
 */
export function TaskDialog({
  open,
  onOpenChange,
  task,
  actor,
  assigneeOptions,
  onCreate,
  onUpdate,
  onDelete,
  onSetStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = creating. */
  task: TaskDocument | null;
  actor: TaskActor;
  /** Admins only: who a task can be given to. */
  assigneeOptions: AssigneeOption[];
  onCreate: (payload: TaskPayload) => Promise<unknown>;
  onUpdate: (id: string, payload: Partial<TaskPayload>) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onSetStatus: (id: string, status: TaskStatus) => Promise<void>;
}) {
  const creating = task === null;
  const canEdit = !creating && canEditTask(task, actor);
  const [editing, setEditing] = useState(false);
  const readOnly = !creating && !editing;
  // An admin-assigned task the viewer may work but not rewrite.
  const locked = !creating && !canEdit;
  const canDelete = !creating && canDeleteTask(task, actor);

  const initial = {
    title: task?.title ?? '',
    kind: task?.kind ?? ('once-off' as TaskKind),
    status: task?.status ?? defaultStatus('once-off'),
    dueDate: task?.dueDate ?? '',
    assigneeUid: task?.assigneeUid ?? actor.uid,
    blocks: task?.blocksClockOut ?? false,
  };
  const [title, setTitle] = useState(initial.title);
  const [kind, setKind] = useState<TaskKind>(initial.kind);
  const [status, setStatus] = useState<TaskStatus>(initial.status);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [assigneeUid, setAssigneeUid] = useState(initial.assigneeUid);
  const [blocks, setBlocks] = useState(initial.blocks);
  const [html, setHtml] = useState('');
  // The browser normalises whatever the editor is seeded with, so the baseline
  // for "is this dirty" is the FIRST value it echoes back, not what we passed in
  // (see RichPromptEditor).
  const [baseHtml, setBaseHtml] = useState<string | null>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);
  // What a confirmed discard does: close the dialog, or just leave edit mode.
  const [confirmDiscard, setConfirmDiscard] = useState<'close' | 'edit' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [titleError, setTitleError] = useState(false);

  const initialHtml = useMemo(
    () => (task ? promptBodyHtml(task.text, task.textHtml) : ''),
    [task]
  );

  const dirty =
    !readOnly &&
    (title !== initial.title ||
      kind !== initial.kind ||
      status !== initial.status ||
      (kind === 'once-off' && dueDate !== initial.dueDate) ||
      assigneeUid !== initial.assigneeUid ||
      blocks !== initial.blocks ||
      (baseHtml !== null && html !== baseHtml));

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty) setConfirmDiscard('close');
    else onOpenChange(false);
  }, [dirty, saving, onOpenChange]);

  /** Re-seeds every field from the task AS IT IS NOW — a status moved while reading must not be reverted. */
  const startEditing = () => {
    if (!task) return;
    setTitle(task.title);
    setKind(task.kind);
    setStatus(task.status);
    setDueDate(task.dueDate ?? '');
    setAssigneeUid(task.assigneeUid);
    setBlocks(task.blocksClockOut);
    setBaseHtml(null);
    setHtml('');
    setTitleError(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (dirty) setConfirmDiscard('edit');
    else setEditing(false);
  };

  const changeKind = (next: TaskKind) => {
    if (next === kind) return;
    setKind(next);
    setStatus(s => remapStatus(s, next));
    if (next === 'role') setDueDate('');
  };

  const save = async () => {
    if (readOnly || saving) return;
    if (!title.trim()) {
      setTitleError(true);
      document.getElementById('task-title')?.focus();
      return;
    }
    setSaving(true);
    try {
      const common = {
        title: title.trim(),
        textHtml: html, // the server sanitises and decides whether it is worth keeping
        kind,
        status,
        dueDate: kind === 'once-off' && dueDate ? dueDate : null,
      };
      // Admin-only fields are only ever sent by an admin — the server refuses
      // them from anyone else, so a non-admin must not even include the key.
      const admin = actor.isAdmin ? { assigneeUid, blocksClockOut: blocks } : {};
      if (creating) await onCreate({ ...common, ...admin });
      else await onUpdate(task.id, { ...common, ...admin });
      toast.success(creating ? 'Task created' : 'Task saved');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the task');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    setSaving(true);
    try {
      await onDelete(task.id);
      toast.success('Task deleted');
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the task');
    } finally {
      setSaving(false);
    }
  };

  // Reading shows the stored kind; editing shows the form's (it can be flipped).
  const statusOptions = statusesFor(readOnly && task ? task.kind : kind);
  const assignee = assigneeOptions.find(o => o.uid === assigneeUid);
  const viewAssignee = assigneeOptions.find(o => o.uid === task?.assigneeUid);

  return (
    <>
      <Dialog open={open} onOpenChange={o => (o ? onOpenChange(true) : requestClose())}>
        <DialogContent
          // `sm:` matters: the shared DialogContent sets sm:max-w-lg, which a bare max-w-2xl loses to.
          className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-2xl"
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              void save();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="sr-only">{creating ? 'New task' : readOnly ? task.title : 'Edit task'}</DialogTitle>
            <DialogDescription className="sr-only">
              {locked && readOnly ? 'An admin assigned this task. You can change its status.' : readOnly ? 'Task details. Use Edit to change them.' : 'Title, details and status.'}
            </DialogDescription>
            {readOnly ? (
              <p className="pr-8 text-lg font-semibold leading-snug text-white">{task.title}</p>
            ) : (
              <>
                <Label htmlFor="task-title" className="sr-only">Title</Label>
                <Input
                  id="task-title"
                  value={title}
                  maxLength={TASK_TITLE_MAX}
                  autoFocus
                  aria-invalid={titleError || undefined}
                  onChange={e => { setTitle(e.target.value); setTitleError(false); }}
                  placeholder={kind === 'role' ? 'Name the role' : 'What needs doing?'}
                  // A heading-weight field: no box, but a hairline underline that appears on
                  // focus (the ring is dropped, so the underline IS the focus indicator)
                  // and turns red on a failed save.
                  className="h-11 rounded-none border-0 border-b border-transparent bg-transparent px-0 pr-8 text-lg font-semibold shadow-none focus-visible:border-white/25 focus-visible:ring-0 aria-invalid:border-red-500"
                />
                {titleError && <p className="text-xs text-red-400">Give it a title.</p>}
              </>
            )}
            {readOnly && locked && (
              <p className="text-xs text-zinc-400">
                {task.kind === 'role' ? 'A role' : 'A task'} assigned to you by {task.createdByName ?? 'a deleted user'}.
                {task.dueDate && ` Due ${formatDue(task.dueDate)}.`} You can change its status.
              </p>
            )}
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            {!readOnly && (
              <div className="flex flex-col gap-1.5">
                <Label>Kind</Label>
                <ToggleGroup
                  type="single"
                  value={kind}
                  onValueChange={v => v && changeKind(v as TaskKind)}
                  variant="outline"
                  aria-label="Kind"
                >
                  <ToggleGroupItem value="once-off" className="gap-1.5 px-3">
                    <ListTodo className="size-3.5" aria-hidden /> Once-off
                  </ToggleGroupItem>
                  <ToggleGroupItem value="role" className="gap-1.5 px-3">
                    <Repeat className="size-3.5" aria-hidden /> Role
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-zinc-400">
                  {kind === 'role' ? 'Ongoing — a standing responsibility.' : 'Finished once it is done.'}
                </p>
              </div>
            )}

            {readOnly && task && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>Kind</Label>
                  <p className="flex h-9 items-center gap-1.5 text-sm text-zinc-200">
                    {task.kind === 'role' ? (
                      <><Repeat className="size-3.5 text-zinc-400" aria-hidden /> Role — ongoing</>
                    ) : (
                      <><ListTodo className="size-3.5 text-zinc-400" aria-hidden /> Once-off</>
                    )}
                  </p>
                </div>
                {task.dueDate && (
                  <div className="flex flex-col gap-1.5">
                    <Label>Due date</Label>
                    <p className="flex h-9 items-center text-sm tabular-nums text-zinc-200">{formatDue(task.dueDate)}</p>
                  </div>
                )}
                {actor.isAdmin && (
                  <div className="flex flex-col gap-1.5">
                    <Label>Assigned to</Label>
                    <div className="flex h-9 items-center text-sm text-zinc-200">
                      {viewAssignee ? (
                        <UserAvatarLabel name={viewAssignee.name} photoURL={viewAssignee.photoURL} />
                      ) : (
                        'Former employee'
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-status">Status</Label>
              <Select
                value={readOnly ? task.status : status}
                onValueChange={v => {
                  // Read-only: the one live control, saved the moment it changes.
                  if (readOnly) void onSetStatus(task.id, v as TaskStatus);
                  else setStatus(v as TaskStatus);
                }}
              >
                <SelectTrigger id="task-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {kind === 'once-off' && !readOnly && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-due">Due date <span className="font-normal text-zinc-400">(optional)</span></Label>
                <Input
                  id="task-due"
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="[color-scheme:dark]"
                />
              </div>
            )}

            {actor.isAdmin && !readOnly && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-assignee">Assigned to</Label>
                <Select value={assigneeUid} onValueChange={setAssigneeUid}>
                  <SelectTrigger id="task-assignee" className="w-full">
                    <SelectValue>
                      {assignee ? (
                        <UserAvatarLabel name={assignee.name} photoURL={assignee.photoURL} />
                      ) : (
                        'Choose a person'
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {assigneeOptions.map(o => (
                      <SelectItem key={o.uid} value={o.uid}>
                        <UserAvatarLabel name={o.name} photoURL={o.photoURL} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {readOnly && task?.blocksClockOut && !isClosed(task) && (
            <p className="flex items-center gap-1.5 text-xs text-orange-400">
              <LogOut className="size-3.5" aria-hidden />
              {actor.isAdmin ? 'The assignee is asked about this when they clock out.' : 'You will be asked about this when you clock out.'}
            </p>
          )}

          {actor.isAdmin && !readOnly && (
            <div className="flex items-start justify-between gap-4 rounded-lg bg-white/[0.04] px-3 py-2.5">
              <div className="min-w-0">
                <Label htmlFor="task-blocks" className="text-sm">Ask before they clock out</Label>
                <p className="text-xs text-zinc-400">
                  While this is outstanding, the assignee is shown it when they press Clock Out. They can still
                  clock out anyway.
                </p>
              </div>
              <Switch id="task-blocks" checked={blocks} onCheckedChange={setBlocks} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="task-body">Details</Label>
              {!readOnly && <div ref={setToolbarHost} />}
            </div>
            {readOnly ? (
              task.text ? (
                <div
                  className={`max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-white/[0.07] bg-white/[0.025] p-4 text-sm font-normal leading-relaxed text-zinc-100 ${RICH_TEXT_MARK_CLASSES}`}
                  // Re-sanitised on read by promptBodyHtml — the dialect has no
                  // href, style, src or on* to smuggle (lib/promptHtml.ts).
                  dangerouslySetInnerHTML={{ __html: promptBodyHtml(task.text, task.textHtml) }}
                />
              ) : (
                <p className="text-sm text-zinc-400">No details were added.</p>
              )
            ) : (
              <RichPromptEditor
                id="task-body"
                ariaLabel="Task details"
                toolbarLabel="Task formatting"
                initialHtml={initialHtml}
                toolbarHost={toolbarHost}
                placeholder="Add the details — what done looks like, links, who to ask."
                bodyClassName="min-h-[12rem] max-h-[40vh] font-sans"
                onChange={h => {
                  setBaseHtml(b => b ?? h);
                  setHtml(h);
                }}
              />
            )}
            {!readOnly && html.length > TASK_TEXT_MAX && (
              <p className="text-xs text-red-400">That is longer than a task can hold.</p>
            )}
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <div>
              {canDelete && (
                <Button type="button" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={creating || readOnly ? requestClose : cancelEdit}
                disabled={saving}
              >
                {readOnly ? 'Close' : 'Cancel'}
              </Button>
              {readOnly && canEdit && (
                <Button
                  type="button"
                  onClick={startEditing}
                  className="gap-1.5 text-white hover:brightness-110"
                  style={{ backgroundColor: ACTION_BLUE_DEEP }}
                >
                  <Pencil className="size-3.5" aria-hidden /> Edit
                </Button>
              )}
              {!readOnly && (
                <Button
                  type="button"
                  onClick={save}
                  disabled={saving || (!creating && !dirty)}
                  className="text-white hover:brightness-110"
                  style={{ backgroundColor: ACTION_BLUE_DEEP }}
                >
                  {saving ? 'Saving…' : creating ? 'Create task' : 'Save'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard !== null} onOpenChange={o => !o && setConfirmDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>What you have written has not been saved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const then = confirmDiscard;
                setConfirmDiscard(null);
                if (then === 'edit') setEditing(false);
                else onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {task?.kind === 'role' ? 'role' : 'task'}?</AlertDialogTitle>
            <AlertDialogDescription>
              “{task?.title}” will be removed for {task && task.assigneeUid !== actor.uid ? 'its assignee too' : 'good'}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); void remove(); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
