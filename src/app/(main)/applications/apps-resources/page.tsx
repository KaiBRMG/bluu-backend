'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { useResources } from '@/hooks/useResources';
import { DocumentRow } from './components/DocumentRow';
import { colorForType } from './components/typeColors';

const PAGE_SIZE = 10;
const ALL_VALUE = '__ALL__';

export default function ResourcesPage() {
  const { documents, types, loading, error } = useResources();

  const [query, setQuery] = useState('');
  // Empty array means the "All" pseudo-toggle is on (show every document).
  // Any non-empty array means the user has picked specific types and "All" is off.
  const [activeTypes, setActiveTypes] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const isAllOn = activeTypes.length === 0;
  const toggleValue = isAllOn ? [ALL_VALUE] : activeTypes;

  const handleToggleChange = (next: string[]) => {
    const hadAll = isAllOn;
    const hasAll = next.includes(ALL_VALUE);

    // User clicked "All" while it was off — clear every type filter.
    if (hasAll && !hadAll) {
      setActiveTypes([]);
      setPage(1);
      return;
    }
    // Drop the sentinel; what remains is the explicit type selection.
    const onlyTypes = next.filter(v => v !== ALL_VALUE);
    // Block "all off" — clicking the lone "All" chip is a no-op rather than
    // showing an empty list. Toggle a type instead to deselect "All".
    if (onlyTypes.length === 0 && hadAll) return;
    setActiveTypes(onlyTypes);
    setPage(1);
  };

  const filtered = useMemo(() => {
    if (!documents) return [];
    const q = query.trim().toLowerCase();
    const activeSet = new Set(activeTypes);
    const allOn = activeSet.size === 0;
    return documents.filter(d => {
      if (q && !d.name.toLowerCase().includes(q)) return false;
      if (allOn) return true;
      if (d.types.length === 0) return false;
      return d.types.some(t => activeSet.has(t));
    });
  }, [documents, query, activeTypes]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showPagination = filtered.length > PAGE_SIZE;

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">Resources</h1>
        {/* <p className="text-sm text-muted-foreground">
          Internal documents and Notion pages shared with your team.
        </p> */}

        <div className="mt-8 flex flex-col gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                // Typing always searches the full set — reset to "All".
                setActiveTypes([]);
                setPage(1);
              }}
              placeholder="Search all resources"
              className="h-11 pl-9 text-sm"
            />
          </div>

          {/* Type toggles */}
          {!types ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-20 rounded-md" />
              ))}
            </div>
          ) : types.length === 0 ? null : (
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
              {types.map(t => {
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
        </div>

        {/* Document list */}
        <div className="mt-6 flex flex-col gap-2">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <Skeleton className="h-6 w-6 shrink-0 rounded" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                  <Skeleton className="h-5 w-14 rounded-md" />
                  <Skeleton className="h-5 w-16 rounded-md" />
                </div>
                <Skeleton className="ml-1 h-8 w-8 rounded-md" />
              </div>
            ))
          ) : error ? (
            <div
              className="rounded-lg p-8 text-center text-sm text-muted-foreground"
              style={{
                background: 'var(--sidebar-background)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Couldn&apos;t load resources. Please refresh the page.
            </div>
          ) : visible.length === 0 ? (
            <div
              className="rounded-lg p-8 text-center text-sm text-muted-foreground"
              style={{
                background: 'var(--sidebar-background)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {documents && documents.length === 0
                ? 'No resources are shared with your group yet.'
                : 'No resources match your filters.'}
            </div>
          ) : (
            visible.map(doc => <DocumentRow key={doc.id} doc={doc} />)
          )}
        </div>

        {/* Pagination */}
        {showPagination && !loading && (
          <div className="mt-6">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={e => {
                      e.preventDefault();
                      setPage(p => Math.max(1, p - 1));
                    }}
                    aria-disabled={page === 1}
                    className={page === 1 ? 'pointer-events-none opacity-50' : ''}
                  />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <PaginationItem key={p}>
                    <PaginationLink
                      href="#"
                      isActive={p === page}
                      onClick={e => {
                        e.preventDefault();
                        setPage(p);
                      }}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={e => {
                      e.preventDefault();
                      setPage(p => Math.min(totalPages, p + 1));
                    }}
                    aria-disabled={page === totalPages}
                    className={page === totalPages ? 'pointer-events-none opacity-50' : ''}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
