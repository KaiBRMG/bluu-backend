"use client";

import { Search, X } from 'lucide-react';
import type { AdminGroup } from '@/hooks/useAdminUsers';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const ALL = '__all__';

interface RegistryFiltersProps {
  groups: AdminGroup[];
  groupFilter: string;
  statusFilter: string;
  employmentTypeFilter: string;
  searchQuery: string;
  onGroupFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onEmploymentTypeFilterChange: (value: string) => void;
  onSearchQueryChange: (value: string) => void;
}

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contractor', 'Intern'];

export default function RegistryFilters({
  groups,
  groupFilter,
  statusFilter,
  employmentTypeFilter,
  searchQuery,
  onGroupFilterChange,
  onStatusFilterChange,
  onEmploymentTypeFilterChange,
  onSearchQueryChange,
}: RegistryFiltersProps) {
  const hasActiveFilters =
    !!groupFilter || !!statusFilter || !!employmentTypeFilter || !!searchQuery;

  const clearAll = () => {
    onGroupFilterChange('');
    onStatusFilterChange('');
    onEmploymentTypeFilterChange('');
    onSearchQueryChange('');
  };

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Select
        value={groupFilter || ALL}
        onValueChange={(v) => onGroupFilterChange(v === ALL ? '' : v)}
      >
        <SelectTrigger size="sm" className="min-w-[140px]">
          <SelectValue placeholder="All Groups" />
        </SelectTrigger>
        <SelectContent className="dark">
          <SelectItem value={ALL}>All Groups</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={statusFilter || ALL}
        onValueChange={(v) => onStatusFilterChange(v === ALL ? '' : v)}
      >
        <SelectTrigger size="sm" className="min-w-[120px]">
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent className="dark">
          <SelectItem value={ALL}>All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={employmentTypeFilter || ALL}
        onValueChange={(v) => onEmploymentTypeFilterChange(v === ALL ? '' : v)}
      >
        <SelectTrigger size="sm" className="min-w-[160px]">
          <SelectValue placeholder="All Employment Types" />
        </SelectTrigger>
        <SelectContent className="dark">
          <SelectItem value={ALL}>All Employment Types</SelectItem>
          {EMPLOYMENT_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearAll} className="text-foreground-secondary">
          <X /> Clear
        </Button>
      )}

      <div className="relative ml-auto w-full sm:w-auto">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" />
        <Input
          type="text"
          placeholder="Search by name..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          className="h-8 w-full pl-8 sm:w-[240px]"
        />
      </div>
    </div>
  );
}
