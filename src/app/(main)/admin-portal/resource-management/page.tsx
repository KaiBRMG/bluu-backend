'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader } from '@/components/ui/loader';
import { cn } from '@/lib/utils';
import { useAdminResources } from '@/hooks/useAdminResources';
import { useBasicUsers } from '@/hooks/useBasicUsers';
import { colorForType } from '@/app/(main)/applications/apps-resources/components/typeColors';
import { ResourceTable } from './components/ResourceTable';
import { ResourceFormDialog } from './components/ResourceFormDialog';
import type { MultiOption } from './components/OptionMultiSelect';
import type { ResourceDocument } from '@/types/resource';

// User-group filter badges (second row).
const GROUP_FILTERS = ['CA', 'SMM'];

const PAGE_SIZE = 10;

/** A clickable pill filter built from the shared Badge component. */
function FilterBadge({
  active,
  onToggle,
  className,
  children,
}: {
  active: boolean;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Badge
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onToggle}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
      }}
      variant="outline"
      className={cn(
        'cursor-pointer select-none gap-2 rounded-md px-3 py-1',
        !active && 'hover:bg-accent hover:text-accent-foreground',
        className,
      )}
    >
      {children}
    </Badge>
  );
}

export default function ResourceManagementPage() {
  const {
    documents, loading, error, createResource, updateResource, deleteResource,
  } = useAdminResources();
  const { users, groups } = useBasicUsers();

  const [query, setQuery] = useState('');
  // Empty = "All" badge on (every type/group). Non-empty = explicit selection.
  const [activeTypes, setActiveTypes] = useState<string[]>([]);
  const [activeGroups, setActiveGroups] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Unlisted'>('all');
  // Lazy load: render this many rows, growing as the user scrolls to the bottom.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ResourceDocument | null>(null);

  // Dropdown option sets for the form dialogs.
  const groupOptions: MultiOption[] = useMemo(
    () => groups
      .filter(g => g.id !== 'unassigned')
      .map(g => ({ value: g.id, label: g.name || g.id })),
    [groups]
  );
  const groupLabel = useMemo(() => {
    const map = new Map(groups.map(g => [g.id, g.name || g.id]));
    return (id: string) => map.get(id) ?? id;
  }, [groups]);

  const typeOptions: MultiOption[] = useMemo(() => {
    const set = new Set<string>();
    for (const d of documents) for (const t of d.types) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b)).map(t => ({ value: t, label: t }));
  }, [documents]);

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

  // One filter badge per distinct type, plus the "All" badge.
  const allTypes = useMemo(() => typeOptions.map(o => o.value), [typeOptions]);

  // Any filter change restarts the lazy-load window at the first page.
  const resetPaging = () => setVisibleCount(PAGE_SIZE);

  // Toggle a value in/out of a multi-select filter set.
  const toggleFrom = (setter: React.Dispatch<React.SetStateAction<string[]>>) =>
    (value: string) => {
      setter(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]));
      resetPaging();
    };
  const toggleType = toggleFrom(setActiveTypes);
  const toggleGroup = toggleFrom(setActiveGroups);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const typeSet = new Set(activeTypes);
    const groupSet = new Set(activeGroups);
    return documents.filter(d => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (typeSet.size > 0 && !d.types.some(t => typeSet.has(t))) return false;
      if (groupSet.size > 0 && !d.groups.some(g => groupSet.has(g))) return false;
      if (!q) return true;
      // Search across name, groups, and types.
      const haystack = [
        d.name,
        ...d.groups,
        ...d.groups.map(groupLabel),
        ...d.types,
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [documents, query, activeTypes, activeGroups, statusFilter, groupLabel]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // Grow the window when the sentinel at the bottom of the list scrolls into view.
  // A callback ref (re)attaches the observer as the sentinel mounts/unmounts.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) setVisibleCount(c => c + PAGE_SIZE);
    }, { rootMargin: '200px' });
    observerRef.current.observe(node);
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64"><Loader /></div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64 text-center">
          <div>
            <div className="text-red-400 mb-2">Error loading resources</div>
            <div className="text-sm text-muted-foreground">{error}</div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">Resource Management</h1>
        <p className="text-sm text-muted-foreground">
          Manage the documents shown on the Resources page.
        </p>

        <div className="mt-8 flex flex-col gap-4">
          {/* Search + New */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => { setQuery(e.target.value); resetPaging(); }}
                placeholder="Search by name, group, or type"
                className="h-10 pl-9 text-sm"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={v => {
                setStatusFilter(v as 'all' | 'Active' | 'Unlisted');
                resetPaging();
              }}
            >
              <SelectTrigger className="h-10 w-[9rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Unlisted">Unlisted</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New
            </Button>
          </div>

          {/* Type filter badges — one per type, plus "All". */}
          {allTypes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <FilterBadge
                active={activeTypes.length === 0}
                onToggle={() => { setActiveTypes([]); resetPaging(); }}
                className={activeTypes.length === 0
                  ? 'bg-slate-100 text-slate-900 border-slate-300 dark:bg-slate-500/15 dark:text-slate-100 dark:border-slate-500/30'
                  : undefined}
              >
                <span className="h-2 w-2 rounded-full bg-slate-500" aria-hidden />
                All
              </FilterBadge>
              {allTypes.map(t => {
                const c = colorForType(t);
                const active = activeTypes.includes(t);
                return (
                  <FilterBadge
                    key={t}
                    active={active}
                    onToggle={() => toggleType(t)}
                    className={active ? c.badge : undefined}
                  >
                    <span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden />
                    {t}
                  </FilterBadge>
                );
              })}
            </div>
          )}

          {/* User-group filter badges (CA, SMM), plus "All". */}
          <div className="flex flex-wrap gap-2">
            <FilterBadge
              active={activeGroups.length === 0}
              onToggle={() => { setActiveGroups([]); resetPaging(); }}
              className={activeGroups.length === 0
                ? 'bg-slate-100 text-slate-900 border-slate-300 dark:bg-slate-500/15 dark:text-slate-100 dark:border-slate-500/30'
                : undefined}
            >
              <span className="h-2 w-2 rounded-full bg-slate-500" aria-hidden />
              All groups
            </FilterBadge>
            {GROUP_FILTERS.map(g => {
              const active = activeGroups.includes(g);
              return (
                <FilterBadge
                  key={g}
                  active={active}
                  onToggle={() => toggleGroup(g)}
                  className={active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : undefined}
                >
                  {groupLabel(g)}
                </FilterBadge>
              );
            })}
          </div>

          <ResourceTable
            resources={visible}
            groupLabel={groupLabel}
            onEdit={setEditing}
            onDelete={deleteResource}
          />

          {/* Lazy-load sentinel — scrolling it into view reveals the next page. */}
          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              <Loader />
            </div>
          )}
          {filtered.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              Showing {visible.length} of {filtered.length}
            </p>
          )}
        </div>
      </div>

      <ResourceFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        groupOptions={groupOptions}
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
        typeOptions={typeOptions}
        userOptions={userOptions}
        onSubmit={payload => updateResource(editing!.id, payload)}
      />
    </AppLayout>
  );
}
