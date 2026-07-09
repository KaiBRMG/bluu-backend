'use client';

import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from '@/components/ui/pagination';

/**
 * Client-side ellipsis pagination shared by the disputes and SMM tables.
 * Renders nothing for a single page.
 */
export function EllipsisPagination({
  page,
  totalPages,
  onPageChange,
  className = 'mt-4',
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  const pages: (number | 'ellipsis')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('ellipsis');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
  }

  return (
    <Pagination className={className}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            onClick={() => page > 1 && onPageChange(page - 1)}
            aria-disabled={page === 1}
            className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
          />
        </PaginationItem>
        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <PaginationItem key={`ell-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink isActive={p === page} onClick={() => onPageChange(p)} className="cursor-pointer">
                {p}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            onClick={() => page < totalPages && onPageChange(page + 1)}
            aria-disabled={page === totalPages}
            className={page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
