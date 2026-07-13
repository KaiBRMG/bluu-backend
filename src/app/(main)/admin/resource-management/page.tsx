'use client';

import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader } from '@/components/ui/loader';
import { cn } from '@/lib/utils';
import { useAdminResources } from '@/hooks/useAdminResources';
import { useBasicUsers } from '@/hooks/useBasicUsers';
import { ResourceTable } from './components/ResourceTable';
import { ResourceFormDialog } from './components/ResourceFormDialog';
import type { MultiOption } from './components/OptionMultiSelect';
import type { ResourceDocument } from '@/types/resource';

// Group filter badges requested for the top of the table. "All" clears the group
// filter; CA / SMM narrow to that group.
const GROUP_FILTERS = [
  { value: '__ALL__', label: 'All Types' },
  { value: 'CA', label: 'CA' },
  { value: 'SMM', label: 'SMM' },
];

export default function ResourceManagementPage() {
  const {
    documents, loading, error, createResource, updateResource, deleteResource,
  } = useAdminResources();
  const { users, groups } = useBasicUsers();

  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('__ALL__');
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter(d => {
      if (groupFilter !== '__ALL__' && !d.groups.includes(groupFilter)) return false;
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
  }, [documents, query, groupFilter, groupLabel]);

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
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New
            </Button>
          </div>

          {/* Group filter badges */}
          <div className="flex flex-wrap gap-2">
            {GROUP_FILTERS.map(f => {
              const active = groupFilter === f.value;
              return (
                <Badge
                  key={f.value}
                  role="button"
                  tabIndex={0}
                  onClick={() => setGroupFilter(f.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setGroupFilter(f.value); }
                  }}
                  variant="outline"
                  className={cn(
                    'cursor-pointer px-3 py-1 select-none',
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {f.label}
                </Badge>
              );
            })}
          </div>

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
