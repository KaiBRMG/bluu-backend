'use client';

import type { ReactNode } from 'react';

interface ChartCardProps {
  title: string;
  description?: string;
  /** Shown as a caveat under the title — e.g. how a metric should be read. */
  caveat?: string;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Shared shell for the analytics charts, so every card carries the same
 * surface, spacing and empty state. Matches the surrounding shift-management
 * panels (var(--background) on var(--border-subtle)).
 */
export function ChartCard({
  title, description, caveat, empty, emptyMessage = 'No data in this range.',
  children, className,
}: ChartCardProps) {
  return (
    <div
      className={`rounded-lg p-4 ${className ?? ''}`}
      style={{ background: 'var(--background)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="mb-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>{description}</p>
        )}
        {caveat && (
          <p className="text-xs mt-1 italic" style={{ color: 'var(--foreground-muted)' }}>{caveat}</p>
        )}
      </div>
      {empty ? (
        <div className="flex items-center justify-center py-16 text-sm" style={{ color: 'var(--foreground-muted)' }}>
          {emptyMessage}
        </div>
      ) : children}
    </div>
  );
}
