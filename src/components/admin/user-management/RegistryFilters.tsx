"use client";

import type { AdminGroup } from '@/hooks/useAdminUsers';

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
  return (
    <div className="flex gap-3 mb-5">
      <select
        className="form-input text-sm"
        value={groupFilter}
        onChange={(e) => onGroupFilterChange(e.target.value)}
        style={{ maxWidth: '200px' }}
      >
        <option value="">All Groups</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      <select
        className="form-input text-sm"
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value)}
        style={{ maxWidth: '200px' }}
      >
        <option value="">All Status</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>

      <select
        className="form-input text-sm"
        value={employmentTypeFilter}
        onChange={(e) => onEmploymentTypeFilterChange(e.target.value)}
        style={{ maxWidth: '200px' }}
      >
        <option value="">All Employment Types</option>
        <option value="Full-time">Full-time</option>
        <option value="Part-time">Part-time</option>
        <option value="Contractor">Contractor</option>
        <option value="Intern">Intern</option>
      </select>
    </div>
  );
}
