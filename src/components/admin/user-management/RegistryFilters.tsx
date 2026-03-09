"use client";

import { ChevronDownIcon } from 'lucide-react';
import type { AdminGroup } from '@/hooks/useAdminUsers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface RegistryFiltersProps {
  groups: AdminGroup[];
  groupFilter: string;
  statusFilter: string;
  employmentTypeFilter: string;
  onGroupFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onEmploymentTypeFilterChange: (value: string) => void;
}

export default function RegistryFilters({
  groups,
  groupFilter,
  statusFilter,
  employmentTypeFilter,
  onGroupFilterChange,
  onStatusFilterChange,
  onEmploymentTypeFilterChange,
}: RegistryFiltersProps) {
  const groupLabel = groupFilter ? (groups.find(g => g.id === groupFilter)?.name ?? 'All Groups') : 'All Groups';
  const statusLabel = statusFilter === 'active' ? 'Active' : statusFilter === 'inactive' ? 'Inactive' : 'All Status';
  const employmentLabel = employmentTypeFilter || 'All Employment Types';

  return (
    <div className="flex gap-3 mb-5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="form-input text-sm flex items-center justify-between gap-2"
            style={{ cursor: 'pointer', maxWidth: '200px', minWidth: '140px' }}
          >
            <span>{groupLabel}</span>
            <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="dark min-w-[140px]">
          <DropdownMenuItem onSelect={() => onGroupFilterChange('')}>All Groups</DropdownMenuItem>
          {groups.map((g) => (
            <DropdownMenuItem key={g.id} onSelect={() => onGroupFilterChange(g.id)}>{g.name}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="form-input text-sm flex items-center justify-between gap-2"
            style={{ cursor: 'pointer', maxWidth: '200px', minWidth: '120px' }}
          >
            <span>{statusLabel}</span>
            <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="dark min-w-[120px]">
          <DropdownMenuItem onSelect={() => onStatusFilterChange('')}>All Status</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onStatusFilterChange('active')}>Active</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onStatusFilterChange('inactive')}>Inactive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="form-input text-sm flex items-center justify-between gap-2"
            style={{ cursor: 'pointer', maxWidth: '200px', minWidth: '160px' }}
          >
            <span>{employmentLabel}</span>
            <ChevronDownIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="dark min-w-[160px]">
          <DropdownMenuItem onSelect={() => onEmploymentTypeFilterChange('')}>All Employment Types</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEmploymentTypeFilterChange('Full-time')}>Full-time</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEmploymentTypeFilterChange('Part-time')}>Part-time</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEmploymentTypeFilterChange('Contractor')}>Contractor</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEmploymentTypeFilterChange('Intern')}>Intern</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
