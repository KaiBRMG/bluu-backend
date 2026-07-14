'use client';

import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader } from '@/components/ui/loader';
import { useAdminResources } from '@/hooks/useAdminResources';
import { useBasicUsers } from '@/hooks/useBasicUsers';
import { colorForType } from '@/app/(main)/applications/apps-resources/components/typeColors';
import { ResourceTable } from './components/ResourceTable';
import { ResourceFormDialog } from './components/ResourceFormDialog';
import type { MultiOption } from './components/OptionMultiSelect';
import type { ResourceDocument } from '@/types/resource';

// Sentinel for the "All" filter badge — an empty type selection means show all.
const ALL_VALUE = '__ALL__';

export default function ResourceManagementPage() {
  const {
    documents, loading, error, createResource, updateResource, deleteResource,
  } = useAdminResources();
  const { users, groups } = useBasicUsers();

  const [query, setQuery] = useState('');
  // Empty = "All" badge on (every type). Non-empty = explicit type selection.
  const [activeTypes, setActiveTypes] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Unlisted'>('all');
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
  const isAllOn = activeTypes.length === 0;
  const toggleValue = isAllOn ? [ALL_VALUE] : activeTypes;

  const handleToggleChange = (next: string[]) => {
    const hadAll = isAllOn;
    const hasAll = next.includes(ALL_VALUE);
    // Clicking "All" while it was off clears every type filter.
    if (hasAll && !hadAll) {
      setActiveTypes([]);
      return;
    }
    const onlyTypes = next.filter(v => v !== ALL_VALUE);
    // Clicking the lone "All" chip is a no-op rather than showing an empty list.
    if (onlyTypes.length === 0 && hadAll) return;
    setActiveTypes(onlyTypes);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const activeSet = new Set(activeTypes);
    const allOn = activeSet.size === 0;
    return documents.filter(d => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (!allOn && !d.types.some(t => activeSet.has(t))) return false;
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
  }, [documents, query, activeTypes, statusFilter, groupLabel]);

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
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by name, group, or type"
                className="h-10 pl-9 text-sm"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={v => setStatusFilter(v as 'all' | 'Active' | 'Unlisted')}
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
            <ToggleGroup
              type="multiple"
              value={toggleValue}
              onValueChange={handleToggleChange}
              className="flex flex-wrap gap-2 w-full justify-start"
            >
              <ToggleGroupItem
                value={ALL_VALUE}
                aria-label="Show all resources"
                variant="outline"
                size="sm"
                className="!rounded-md !border gap-2 data-[state=on]:bg-slate-100 data-[state=on]:text-slate-900 data-[state=on]:border-slate-300 dark:data-[state=on]:bg-slate-500/15 dark:data-[state=on]:text-slate-100 dark:data-[state=on]:border-slate-500/30"
              >
                <span className="h-2 w-2 rounded-full bg-slate-500" aria-hidden />
                All
              </ToggleGroupItem>
              {allTypes.map(t => {
                const c = colorForType(t);
                return (
                  <ToggleGroupItem
                    key={t}
                    value={t}
                    aria-label={`Toggle ${t}`}
                    variant="outline"
                    size="sm"
                    className={`!rounded-md !border gap-2 ${c.toggle}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden />
                    {t}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          )}

          <ResourceTable
            resources={filtered}
            groupLabel={groupLabel}
            onEdit={setEditing}
            onDelete={deleteResource}
          />
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
