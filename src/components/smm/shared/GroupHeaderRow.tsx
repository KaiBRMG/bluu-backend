'use client';

import { ChevronRightIcon } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * A collapsible group-header row rendered inside a shared table — a chevron that
 * rotates on expand plus arbitrary label content. Mirrors the Account Database's
 * network group rows so every SMM table groups the same way. Supports nesting via
 * `buttonClassName` (e.g. left padding for a sub-group).
 */
export function GroupHeaderRow({
  open,
  onToggle,
  colSpan,
  children,
  rowClassName,
  buttonClassName,
}: {
  open: boolean;
  onToggle: () => void;
  colSpan: number;
  children: React.ReactNode;
  rowClassName?: string;
  buttonClassName?: string;
}) {
  return (
    <TableRow className={cn('bg-muted/30 hover:bg-muted/30', rowClassName)}>
      <TableCell colSpan={colSpan} className="p-0">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-muted/50',
            buttonClassName,
          )}
          aria-expanded={open}
        >
          <ChevronRightIcon
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
          {children}
        </button>
      </TableCell>
    </TableRow>
  );
}
