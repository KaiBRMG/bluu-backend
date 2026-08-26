'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useResources } from '@/hooks/useResources';
import { usePinnedResources } from '@/hooks/usePinnedResources';
import { useBasicUsers } from '@/hooks/useBasicUsers';
import { getReadableGroups } from '@/lib/resourceAccess';
import { GROUP_DISPLAY_NAMES } from '@/types/firestore';
import { FilterRail, type Facet } from './components/FilterRail';
import { ResourceIndex } from './components/ResourceIndex';
import { ResourceFormDialog } from './components/ResourceFormDialog';
import type { MultiOption } from './components/OptionMultiSelect';
import type { ResourceDocument } from '@/types/resource';

/** Rows rendered per lazy-load step. */
const PAGE_SIZE = 24;

type StatusFilter = 'all' | 'Active' | 'Unlisted';

interface FilterState {
  q: string;
  types: string[];
  groups: string[];
  status: StatusFilter;
}

/**
 * Does this resource survive the given filters? Facet counts call it with one
 * facet omitted, which is what makes the counts in the rail honest — the number
 * beside "Guide" is how many rows you would get *if you clicked it*, not how
 * many exist in the collection overall.
 */
function matches(
  doc: ResourceDocument,
  f: FilterState,
  groupLabel: (id: string) => string,
  statusEnforced: boolean,
): boolean {
  if (statusEnforced && f.status !== 'all' && doc.status !== f.status) return false;
  if (f.types.length > 0 && !doc.types.some(t => f.types.includes(t))) return false;
  if (f.groups.length > 0 && !doc.groups.some(g => f.groups.includes(g))) return false;
  if (!f.q) return true;
  const haystack = [
    doc.name,
    doc.url ?? '',
    ...doc.groups,
    ...doc.groups.map(groupLabel),
    ...doc.types,
  ].join(' ').toLowerCase();
  return haystack.includes(f.q);
}

/** Pinned first, then A–Z. See `ResourceIndex` for why this ordering. */
function compareForIndex(a: ResourceDocument, b: ResourceDocument, pinnedSet: Set<string>) {
  const ap = pinnedSet.has(a.id) ? 0 : 1;
  const bp = pinnedSet.has(b.id) ? 0 : 1;
  if (ap !== bp) return ap - bp;
  return (a.name || 'Untitled').localeCompare(b.name || 'Untitled', undefined, {
    sensitivity: 'base',
  });
}

function IndexSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2 pl-2.5">
          <Skeleton className="size-5 shrink-0 rounded-[4px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-[38%]" />
            <Skeleton className="h-2.5 w-[24%]" />
          </div>
          <Skeleton className="h-5 w-16 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/**
 * Resources — one page for reading and for managing.
 *
 * There is no separate admin surface: what the viewer may do is decided by the
 * access matrix in `lib/resourceAccess.ts` and expressed here by gating the
 * "New" button, the Status facet and the per-row options menu. The server
 * enforces the same matrix, so nothing here is load-bearing for security.
 *
 * The layout is a faceted index: a filter rail carrying counts on the left, the
 * A–Z resource index on the right. See `FilterRail` and `ResourceIndex` for why
 * each replaced what it did.
 */
export default function ResourcesPage() {
  const {
    documents, types, loading, error,
    canManage, writableGroups, canEdit, actor,
    createResource, updateResource, deleteResource,
  } = useResources();
  const { pinned, isPinned, togglePin } = usePinnedResources();
  // Only managers open the form dialog, and only it needs the user/group lists.
  const { users, groups } = useBasicUsers(canManage);

  const [query, setQuery] = useState('');
  // Empty = every type / group. Non-empty = an explicit selection.
  const [activeTypes, setActiveTypes] = useState<string[]>([]);
  const [activeGroups, setActiveGroups] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // Lazy load: render this many rows, growing as the user scrolls to the bottom.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ResourceDocument | null>(null);

  const docs = useMemo(() => documents ?? [], [documents]);

  const groupLabel = useMemo(() => {
    // useBasicUsers is skipped for readers, so fall back to the static names.
    const map = new Map(groups.map(g => [g.id, g.name || g.id]));
    return (id: string) => map.get(id) ?? GROUP_DISPLAY_NAMES[id] ?? id;
  }, [groups]);

  /** Only the groups the viewer may tag a resource with. */
  const groupOptions: MultiOption[] = useMemo(
    () => writableGroups.map(g => ({ value: g, label: groupLabel(g) })),
    [writableGroups, groupLabel]
  );

  const typeOptions: MultiOption[] = useMemo(
    () => (types ?? []).map(t => ({ value: t, label: t })),
    [types]
  );

  const userOptions: MultiOption[] = useMemo(
    () => users
      .filter(u => !u.isArchived)
      .map(u => ({
        value: u.uid,
        label: u.displayName || `${u.firstName} ${u.lastName}`.trim() || u.workEmail,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [users]
  );

  /**
   * The group facet is only worth showing to someone who reads more than one
   * group's resources — a CA user sees CA resources and nothing else.
   */
  const readableGroupIds = useMemo(() => {
    if (actor.isAdmin) {
      // Admins read everything, so drive the facet off what is actually there.
      const present = new Set<string>();
      for (const d of docs) for (const g of d.groups) present.add(g);
      return Array.from(present).sort();
    }
    return Array.from(getReadableGroups(actor)).sort();
  }, [actor, docs]);

  const filters: FilterState = useMemo(
    () => ({
      q: query.trim().toLowerCase(),
      types: activeTypes,
      groups: activeGroups,
      status: statusFilter,
    }),
    [query, activeTypes, activeGroups, statusFilter]
  );

  const filtered = useMemo(
    () => docs.filter(d => matches(d, filters, groupLabel, canManage)),
    [docs, filters, groupLabel, canManage]
  );

  // Facet counts: each facet counts against every filter *except itself*, so a
  // count is a promise about what clicking it will produce.
  const typeFacets: Facet[] = useMemo(() => {
    const pool = docs.filter(d => matches(d, { ...filters, types: [] }, groupLabel, canManage));
    const counts = new Map<string, number>();
    for (const d of pool) for (const t of d.types) counts.set(t, (counts.get(t) ?? 0) + 1);
    return (types ?? [])
      .map(t => ({ value: t, label: t, count: counts.get(t) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [docs, types, filters, groupLabel, canManage]);

  const groupFacets: Facet[] = useMemo(() => {
    const pool = docs.filter(d => matches(d, { ...filters, groups: [] }, groupLabel, canManage));
    const counts = new Map<string, number>();
    for (const d of pool) for (const g of d.groups) counts.set(g, (counts.get(g) ?? 0) + 1);
    return readableGroupIds.map(g => ({
      value: g,
      label: groupLabel(g),
      count: counts.get(g) ?? 0,
    }));
  }, [docs, readableGroupIds, filters, groupLabel, canManage]);

  const statusFacets: Facet[] = useMemo(() => {
    if (!canManage) return [];
    const pool = docs.filter(d => matches(d, { ...filters, status: 'all' }, groupLabel, true));
    const active = pool.filter(d => d.status === 'Active').length;
    return [
      { value: 'all', label: 'All statuses', count: pool.length },
      { value: 'Active', label: 'Active', count: active },
      { value: 'Unlisted', label: 'Unlisted', count: pool.length - active },
    ];
  }, [docs, filters, groupLabel, canManage]);

  /** Total behind the "All types" / "All groups" rows: everything else applied. */
  const railTotal = useMemo(
    () => docs.filter(d =>
      matches(d, { ...filters, types: [], groups: [] }, groupLabel, canManage)
    ).length,
    [docs, filters, groupLabel, canManage]
  );

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => compareForIndex(a, b, pinnedSet)),
    [filtered, pinnedSet]
  );

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  // Any filter change restarts the lazy-load window at the first page.
  const resetPaging = () => setVisibleCount(PAGE_SIZE);

  const toggleFrom = (setter: React.Dispatch<React.SetStateAction<string[]>>) =>
    (value: string) => {
      setter(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]));
      resetPaging();
    };
  const toggleType = toggleFrom(setActiveTypes);
  const toggleGroup = toggleFrom(setActiveGroups);

  const activeFilterCount =
    activeTypes.length + activeGroups.length + (statusFilter === 'all' ? 0 : 1);
  const anyFilter = activeFilterCount > 0 || filters.q.length > 0;

  const clearAll = () => {
    setQuery('');
    setActiveTypes([]);
    setActiveGroups([]);
    setStatusFilter('all');
    resetPaging();
  };

  // Grow the window when the sentinel at the bottom of the list scrolls into
  // view. A callback ref (re)attaches the observer as the sentinel mounts.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) setVisibleCount(c => c + PAGE_SIZE);
    }, { rootMargin: '400px' });
    observerRef.current.observe(node);
  }, []);

  const rail = (
    <FilterRail
      typeFacets={typeFacets}
      activeTypes={activeTypes}
      onToggleType={toggleType}
      onClearTypes={() => { setActiveTypes([]); resetPaging(); }}
      groupFacets={groupFacets}
      activeGroups={activeGroups}
      onToggleGroup={toggleGroup}
      onClearGroups={() => { setActiveGroups([]); resetPaging(); }}
      showStatus={canManage}
      statusFacets={statusFacets}
      status={statusFilter}
      onSetStatus={v => { setStatusFilter(v); resetPaging(); }}
      totalCount={railTotal}
    />
  );

  const hasFacets = typeFacets.length > 0 || groupFacets.length > 1 || canManage;

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">Resources</h1>
            <p className="text-sm text-zinc-400">
              {canManage
                ? 'Documents shared with your team. Resources you manage can be edited here.'
                : 'Internal documents shared with your team.'}
            </p>
          </div>
          {canManage && (
            <Button
              onClick={() => setCreateOpen(true)}
              className="shrink-0"
            >
              <Plus className="size-4" /> New resource
            </Button>
          )}
        </div>

        <div className="mt-8 grid items-start gap-x-10 gap-y-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
          {/* The rail is a permanent column on wide screens (the Electron window
              is always one) and folds into a popover below `lg`. */}
          {hasFacets && !loading && (
            <div className="hidden lg:block lg:sticky lg:top-4">{rail}</div>
          )}
          {loading && (
            <div className="hidden flex-col gap-2 lg:flex">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full rounded-md" />
              ))}
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-3 lg:col-start-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden
                />
                <Input
                  value={query}
                  onChange={e => { setQuery(e.target.value); resetPaging(); }}
                  placeholder="Search resources"
                  aria-label="Search resources by name, link, group, or type"
                  className="h-10 pl-9 text-sm"
                />
              </div>

              {hasFacets && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-10 shrink-0 lg:hidden">
                      <SlidersHorizontal className="size-4" />
                      Filters
                      {activeFilterCount > 0 && (
                        <span className="tabular-nums text-zinc-400">{activeFilterCount}</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="max-h-[70vh] w-64 overflow-y-auto p-3"
                  >
                    {rail}
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {anyFilter && !loading && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="tabular-nums">
                  {sorted.length} {sorted.length === 1 ? 'match' : 'matches'}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={clearAll}
                  className="h-6 gap-1 px-1.5 text-zinc-400 hover:text-white"
                >
                  <X className="size-3" /> Clear
                </Button>
              </div>
            )}

            {loading ? (
              <IndexSkeleton />
            ) : error ? (
              <p className="py-6 text-sm text-zinc-400">
                Couldn&apos;t load resources. Please refresh the page.
              </p>
            ) : docs.length === 0 ? (
              <p className="py-6 text-sm text-zinc-400">
                No resources are shared with your group yet.
              </p>
            ) : sorted.length === 0 ? (
              <p className="py-6 text-sm text-zinc-400">
                Nothing matches these filters.{' '}
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-white underline underline-offset-2 hover:no-underline"
                >
                  Clear them
                </button>{' '}
                to see all {docs.length}.
              </p>
            ) : (
              <>
                <ResourceIndex
                  resources={visible}
                  grouped={filters.q.length === 0}
                  groupLabel={groupLabel}
                  canManage={canManage}
                  canEdit={canEdit}
                  isPinned={isPinned}
                  onTogglePin={togglePin}
                  onEdit={setEditing}
                  onDelete={deleteResource}
                />

                {/* Lazy-load sentinel. The next page is already in memory, so it
                    arrives in the same frame — a spinner here would be theatre
                    (DESIGN §5: never a spinner mid-layout). */}
                {hasMore && <div ref={sentinelRef} className="h-px" aria-hidden />}

                <p className="pt-3 text-xs tabular-nums text-zinc-400">
                  {hasMore
                    ? `Showing ${visible.length} of ${sorted.length}`
                    : `${sorted.length} ${sorted.length === 1 ? 'resource' : 'resources'}`}
                  {pinned.length > 0 && ` · ${pinned.length} pinned`}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {canManage && (
        <>
          <ResourceFormDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            mode="create"
            groupOptions={groupOptions}
            groupsRequired={!actor.isAdmin}
            typeOptions={typeOptions}
            userOptions={userOptions}
            onSubmit={createResource}
          />

          <ResourceFormDialog
            open={!!editing}
            onOpenChange={o => !o && setEditing(null)}
            mode="edit"
            resource={editing ?? undefined}
            groupOptions={groupOptions}
            groupsRequired={!actor.isAdmin}
            typeOptions={typeOptions}
            userOptions={userOptions}
            onSubmit={payload => updateResource(editing!.id, payload)}
          />
        </>
      )}
    </AppLayout>
  );
}
