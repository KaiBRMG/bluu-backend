'use client';

import { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import type { AnalyticsUserRow } from '@/hooks/useAnalyticsData';
import { formatDuration, formatPercent } from './analyticsTypes';
import { ChartCard } from './ChartCard';

type SortKey =
  | 'displayName' | 'workingSeconds' | 'daysWorked' | 'activityMean'
  | 'focusRatio' | 'fragmentationRatio' | 'punctuality' | 'noBreakDays';

interface Column {
  key: SortKey;
  label: string;
  align?: 'left' | 'right';
  render: (u: AnalyticsUserRow) => string;
}

const COLUMNS: Column[] = [
  { key: 'displayName',    label: 'Employee', align: 'left',  render: u => u.displayName },
  { key: 'workingSeconds', label: 'Worked',   align: 'right', render: u => formatDuration(u.workingSeconds + u.breakSeconds) },
  { key: 'daysWorked',     label: 'Days',     align: 'right', render: u => String(u.daysWorked) },
  { key: 'activityMean',   label: 'Activity', align: 'right', render: u => u.activityMean !== null ? `${Math.round(u.activityMean)}%` : '—' },
  { key: 'focusRatio',     label: 'Focus',    align: 'right', render: u => formatPercent(u.focusRatio) },
  { key: 'fragmentationRatio', label: 'Interrupts/h', align: 'right', render: u => u.fragmentationRatio !== null ? u.fragmentationRatio.toFixed(1) : '—' },
  { key: 'punctuality',    label: 'Punctual', align: 'right', render: u => formatPercent(u.punctuality) },
  { key: 'noBreakDays',    label: 'No-break', align: 'right', render: u => String(u.noBreakDays) },
];

/**
 * The table IS the accessible view of the charts above — every metric is
 * available as a number here, so nothing is conveyed by colour alone.
 */
export function UserComparisonTable({ byUser }: { byUser: AnalyticsUserRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('workingSeconds');
  const [asc, setAsc] = useState(false);

  const sorted = [...byUser].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    let cmp: number;
    if (typeof av === 'string' || typeof bv === 'string') {
      cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' });
    } else {
      // Nulls sort last regardless of direction — "no data" is not "zero".
      if (av === null && bv === null) cmp = 0;
      else if (av === null) return 1;
      else if (bv === null) return -1;
      else cmp = (av as number) - (bv as number);
    }
    return asc ? cmp : -cmp;
  });

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAsc(v => !v);
    else { setSortKey(key); setAsc(key === 'displayName'); }
  };

  return (
    <ChartCard
      title="By employee"
      description="Every charted metric as a number. Click a column to sort."
      empty={byUser.length === 0}
      emptyMessage="No employees with activity in this range."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {COLUMNS.map(c => (
                <th
                  key={c.key}
                  onClick={() => toggle(c.key)}
                  className="py-2 px-2 font-medium select-none"
                  style={{
                    textAlign: c.align ?? 'right',
                    cursor: 'pointer',
                    color: 'var(--foreground-muted)',
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortKey === c.key && (
                      asc
                        ? <ChevronUpIcon style={{ width: 12, height: 12 }} />
                        : <ChevronDownIcon style={{ width: 12, height: 12 }} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(u => (
              <tr key={u.userId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {COLUMNS.map(c => (
                  <td
                    key={c.key}
                    className="py-2 px-2 tabular-nums"
                    style={{ textAlign: c.align ?? 'right', whiteSpace: 'nowrap' }}
                  >
                    {c.render(u)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
