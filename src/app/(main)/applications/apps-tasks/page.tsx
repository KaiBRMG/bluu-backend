'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { UserAvatarLabel } from '@/components/UserAvatarLabel';
import { FacetButton, FacetSection, type Facet } from '@/components/facets/Facet';
import { useTasks } from '@/hooks/useTasks';
import { useBasicUsers } from '@/hooks/useBasicUsers';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { isAssignableUser, isClosed, isClosedStatus, statusesFor } from '@/lib/taskAccess';
import { todayStr } from '@/lib/utils/timezone';
import { ONCE_OFF_STATUSES, ROLE_STATUSES, type TaskDocument, type TaskKind, type TaskStatus } from '@/types/task';
import { TaskRow } from './components/TaskRow';
import { TaskDialog, type AssigneeOption } from './components/TaskDialog';

type Scope = 'mine' | 'everyone';
type KindFilter = 'all' | TaskKind;
const ALL_STATUSES: TaskStatus[] = [...ONCE_OFF_STATUSES, ...ROLE_STATUSES];
/** Completed rows are capped so a long history never buries the live work. */
const CLOSED_CAP = 25;

interface Filters {
  q: string;
  kind: KindFilter;
  statuses: TaskStatus[];
  assignees: string[];
}

function matches(t: TaskDocument, f: Filters): boolean {
  if (f.kind !== 'all' && t.kind !== f.kind) return false;
  if (f.statuses.length > 0 && !f.statuses.includes(t.status)) return false;
  if (f.assignees.length > 0 && !f.assignees.includes(t.assigneeUid)) return false;
  return !f.q || `${t.title} ${t.text}`.toLowerCase().includes(f.q);
}

/** Soonest due first, undated last, then most recently touched. */
function byDueThenRecent(a: TaskDocument, b: TaskDocument): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

interface Section {
  key: string;
  label: React.ReactNode;
  tasks: TaskDocument[];
}

/** Roles, then open tasks, then (when shown) what is finished — one person's list. */
function arrange(tasks: TaskDocument[], showClosed: boolean) {
  const open = tasks.filter(t => !isClosed(t));
  return {
    roles: open.filter(t => t.kind === 'role').sort((a, b) => a.title.localeCompare(b.title)),
    once: open.filter(t => t.kind === 'once-off').sort(byDueThenRecent),
    closed: showClosed
      ? tasks.filter(isClosed).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, CLOSED_CAP)
      : [],
  };
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2 pl-2.5">
          <Skeleton className="h-5 w-[6.25rem] rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-[40%]" />
            <Skeleton className="h-2.5 w-[22%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Tasks — an org-wide page (a universal page, like Resources): everyone sees and
 * works their own; admins can also see and manage everyone's. Which of those a
 * viewer gets is decided by `lib/taskAccess.ts` on the server (`/api/tasks`) —
 * nothing here is load-bearing for security.
 */
export default function TasksPage() {
  const { tasks, loading, error, actor, createTask, updateTask, setStatus, deleteTask } = useTasks();
  const { users } = useBasicUsers(actor.isAdmin);
  const { timezone } = useViewerTimezone();

  const [scope, setScope] = useState<Scope>('mine');
  const [query, setQuery] = useState('');
  // Typing stays instant; the filter passes over every task catch up a beat behind.
  const deferredQuery = useDeferredValue(query);
  const [kind, setKind] = useState<KindFilter>('all');
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  // `null` = closed; `'new'` = creating; otherwise the id being opened.
  const [openId, setOpenId] = useState<string | 'new' | null>(null);

  const everyone = actor.isAdmin && scope === 'everyone';
  const today = todayStr(timezone);

  const people = useMemo(() => {
    const m = new Map<string, AssigneeOption>();
    for (const u of users) {
      m.set(u.uid, {
        uid: u.uid,
        name: u.displayName || `${u.firstName} ${u.lastName}`.trim() || u.workEmail,
        photoURL: u.photoURL ?? null,
      });
    }
    return m;
  }, [users]);

  /** Archived and deactivated people cannot be handed new work. */
  const assigneeOptions = useMemo(
    () => users
      .filter(isAssignableUser)
      .map(u => people.get(u.uid)!)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users, people]
  );

  const base = useMemo(
    () => (tasks ?? []).filter(t => everyone || t.assigneeUid === actor.uid),
    [tasks, everyone, actor.uid]
  );

  const filters: Filters = useMemo(
    () => ({ q: deferredQuery.trim().toLowerCase(), kind, statuses, assignees: everyone ? assignees : [] }),
    [deferredQuery, kind, statuses, assignees, everyone]
  );
  const filtered = useMemo(() => base.filter(t => matches(t, filters)), [base, filters]);

  // Facet counts are each taken against every OTHER filter, so a count is a
  // promise about what clicking it produces (the same rule as Resources).
  const kindFacets: Facet[] = useMemo(() => {
    const pool = base.filter(t => matches(t, { ...filters, kind: 'all' }));
    return [
      { value: 'all', label: 'Everything', count: pool.length },
      { value: 'once-off', label: 'Tasks', count: pool.filter(t => t.kind === 'once-off').length },
      { value: 'role', label: 'Roles', count: pool.filter(t => t.kind === 'role').length },
    ];
  }, [base, filters]);

  const statusFacets: Facet[] = useMemo(() => {
    const pool = base.filter(t => matches(t, { ...filters, statuses: [] }));
    const counts = new Map<TaskStatus, number>();
    for (const t of pool) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    const kinds = kind === 'all' ? ALL_STATUSES : [...statusesFor(kind)];
    return kinds
      .filter(s => (counts.get(s) ?? 0) > 0 || statuses.includes(s))
      .map(s => ({ value: s, label: s, count: counts.get(s) ?? 0 }));
  }, [base, filters, kind, statuses]);

  const assigneeFacets: Facet[] = useMemo(() => {
    if (!everyone) return [];
    const pool = base.filter(t => matches(t, { ...filters, assignees: [] }));
    const counts = new Map<string, number>();
    for (const t of pool) counts.set(t.assigneeUid, (counts.get(t.assigneeUid) ?? 0) + 1);
    return [...counts].map(([uid, count]) => ({
      value: uid,
      label: people.get(uid)?.name ?? 'Deleted user',
      count,
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [everyone, base, filters, people]);

  const closedCount = filtered.filter(isClosed).length;
  // Picking a finished status in the rail is an explicit ask to see them.
  const closedPicked = statuses.some(isClosedStatus);
  const closedVisible = showClosed || closedPicked;

  const sections: Section[] = useMemo(() => {
    if (!everyone) {
      const { roles, once, closed } = arrange(filtered, closedVisible);
      return [
        { key: 'roles', label: 'Roles', tasks: roles },
        { key: 'once', label: roles.length > 0 ? 'Tasks' : null, tasks: once },
        { key: 'closed', label: 'Completed', tasks: closed },
      ].filter(s => s.tasks.length > 0);
    }
    const byPerson = new Map<string, TaskDocument[]>();
    for (const t of filtered) {
      const list = byPerson.get(t.assigneeUid);
      if (list) list.push(t);
      else byPerson.set(t.assigneeUid, [t]);
    }
    return [...byPerson]
      .map(([uid, list]) => {
        const { roles, once, closed } = arrange(list, closedVisible);
        const p = people.get(uid);
        return {
          key: uid,
          sortName: p?.name ?? '~',
          label: <UserAvatarLabel name={p?.name ?? ''} photoURL={p?.photoURL ?? null} size="md" />,
          tasks: [...roles, ...once, ...closed],
        };
      })
      .filter(s => s.tasks.length > 0)
      .sort((a, b) => a.sortName.localeCompare(b.sortName));
  }, [everyone, filtered, closedVisible, people]);

  const shown = sections.reduce((n, s) => n + s.tasks.length, 0);
  const activeFilterCount = (kind === 'all' ? 0 : 1) + statuses.length + assignees.length;
  const anyFilter = activeFilterCount > 0 || filters.q.length > 0;
  const clearAll = () => { setQuery(''); setKind('all'); setStatuses([]); setAssignees([]); };
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const changeStatus = (id: string, status: TaskStatus) =>
    setStatus(id, status).catch(e => {
      toast.error(e instanceof Error ? e.message : 'Could not update the status');
    });

  const openTask = openId && openId !== 'new' ? (tasks ?? []).find(t => t.id === openId) ?? null : null;

  const rail = (
    <nav aria-label="Filter tasks" className="flex flex-col gap-5">
      <FacetSection title="Show">
        {kindFacets.map(f => (
          <FacetButton
            key={f.value}
            label={f.label}
            count={f.count}
            active={kind === f.value}
            onClick={() => { setKind(f.value as KindFilter); setStatuses([]); }}
          />
        ))}
      </FacetSection>
      {statusFacets.length > 0 && (
        <FacetSection title="Status">
          {statusFacets.map(f => (
            <FacetButton
              key={f.value}
              label={f.label}
              count={f.count}
              active={statuses.includes(f.value as TaskStatus)}
              onClick={() => setStatuses(prev => toggleIn(prev, f.value as TaskStatus))}
            />
          ))}
        </FacetSection>
      )}
      {assigneeFacets.length > 0 && (
        <FacetSection title="Assigned to">
          {assigneeFacets.map(f => (
            <FacetButton
              key={f.value}
              label={f.label}
              count={f.count}
              active={assignees.includes(f.value)}
              onClick={() => setAssignees(prev => toggleIn(prev, f.value))}
            />
          ))}
        </FacetSection>
      )}
    </nav>
  );

  const hasFacets = base.length > 0;

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-2xl font-bold tracking-tight">Tasks</h1>
            <p className="text-sm text-zinc-400">
              {everyone
                ? 'Everyone’s tasks and roles. Assign work and set what has to be done before clock-out.'
                : 'What you need to do, and the roles you hold.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {actor.isAdmin && (
              <ToggleGroup
                type="single"
                value={scope}
                onValueChange={v => v && setScope(v as Scope)}
                variant="outline"
                aria-label="Whose tasks"
              >
                <ToggleGroupItem value="mine" className="px-3">Mine</ToggleGroupItem>
                <ToggleGroupItem value="everyone" className="px-3">Everyone</ToggleGroupItem>
              </ToggleGroup>
            )}
            <Button onClick={() => setOpenId('new')} className="shrink-0">
              <Plus className="size-4" /> New task
            </Button>
          </div>
        </div>

        <div className="mt-8 grid items-start gap-x-10 gap-y-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
          {hasFacets && !loading && <div className="hidden lg:sticky lg:top-4 lg:block">{rail}</div>}
          {loading && (
            <div className="hidden flex-col gap-2 lg:flex">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full rounded-md" />)}
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-3 lg:col-start-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                <Input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search tasks"
                  aria-label="Search tasks by title or details"
                  className="h-10 pl-9 text-sm"
                />
              </div>
              {hasFacets && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-10 shrink-0 lg:hidden">
                      <SlidersHorizontal className="size-4" /> Filters
                      {activeFilterCount > 0 && <span className="tabular-nums text-zinc-400">{activeFilterCount}</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="max-h-[70vh] w-64 overflow-y-auto p-3">{rail}</PopoverContent>
                </Popover>
              )}
            </div>

            {!loading && (anyFilter || closedCount > 0) && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                {anyFilter && (
                  <>
                    <span className="tabular-nums">{filtered.length} {filtered.length === 1 ? 'match' : 'matches'}</span>
                    <Button variant="ghost" size="xs" onClick={clearAll} className="h-6 gap-1 px-1.5 text-zinc-400 hover:text-white">
                      <X className="size-3" /> Clear
                    </Button>
                  </>
                )}
                {closedCount > 0 && !closedPicked && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setShowClosed(v => !v)}
                    aria-pressed={showClosed}
                    className="ml-auto h-6 px-1.5 text-zinc-400 hover:text-white"
                  >
                    {showClosed ? 'Hide' : 'Show'} completed ({closedCount})
                  </Button>
                )}
              </div>
            )}

            {loading ? (
              <ListSkeleton />
            ) : error ? (
              <p className="py-6 text-sm text-zinc-400">Couldn&apos;t load tasks. Please refresh the page.</p>
            ) : base.length === 0 ? (
              <div className="py-8 text-sm text-zinc-400">
                <p className="text-zinc-200">{everyone ? 'Nobody has any tasks yet.' : 'You have no tasks.'}</p>
                <p className="mt-1">
                  Anything an admin assigns you appears here.{' '}
                  <button type="button" onClick={() => setOpenId('new')} className="text-white underline underline-offset-2 hover:no-underline">
                    Add one for yourself
                  </button>
                  .
                </p>
              </div>
            ) : shown === 0 ? (
              <p className="py-6 text-sm text-zinc-400">
                {anyFilter ? (
                  <>
                    Nothing matches these filters.{' '}
                    <button type="button" onClick={clearAll} className="text-white underline underline-offset-2 hover:no-underline">Clear them</button>.
                  </>
                ) : (
                  <>Nothing outstanding. {closedCount > 0 && 'Your finished work is under “Show completed”.'}</>
                )}
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {sections.map(s => (
                  <section key={s.key} aria-label={typeof s.label === 'string' ? s.label : 'Tasks'}>
                    {s.label && (
                      <h2 className="px-2.5 pb-1 text-xs font-medium text-zinc-400">{s.label}</h2>
                    )}
                    <ul className="flex flex-col">
                      {s.tasks.map(t => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          today={today}
                          onOpen={() => setOpenId(t.id)}
                          onSetStatus={st => void changeStatus(t.id, st)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
                <p className="text-xs tabular-nums text-zinc-400">
                  {shown} {shown === 1 ? 'item' : 'items'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {openId && (openId === 'new' || openTask) && (
        <TaskDialog
          key={openId}
          open
          onOpenChange={o => !o && setOpenId(null)}
          task={openTask}
          actor={actor}
          assigneeOptions={assigneeOptions}
          onCreate={createTask}
          onUpdate={updateTask}
          onDelete={deleteTask}
          onSetStatus={changeStatus}
        />
      )}
    </AppLayout>
  );
}
