'use client';

/**
 * The ledger — "Your disputes".
 *
 * Opposite task to the queue: nothing here needs a decision, you are checking
 * where your filings got to. So it stays a real table (amounts align in a
 * column), with one derived Status cell instead of two raw approval enums, and
 * the comment on an expandable sub-row rather than clipped to 15 characters
 * behind a hover card that a keyboard can never reach.
 */

import { Fragment, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { DisputeDocument } from '@/types/firestore';
import { formatMoney } from './disputeStatus';
import { PersonTag, SaleDate, StagePill, QuietLine, LoadError } from './disputeUi';
import { FeedFooter } from './DisputeReviewQueue';

const COLUMN_COUNT = 7;

interface DisputeLedgerProps {
  disputes: DisputeDocument[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  userTimezone: string;
  emptyLine: string;
}

export function DisputeLedger({
  disputes,
  loading,
  error,
  onRetry,
  page,
  totalPages,
  total,
  onPageChange,
  userTimezone,
  emptyLine,
}: DisputeLedgerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (error) return <LoadError onRetry={onRetry} />;
  if (loading) return <LedgerSkeleton />;
  if (disputes.length === 0) return <QuietLine>{emptyLine}</QuietLine>;

  return (
    <div>
      {/* Seven columns crush before they scroll in a narrow window; the
          container above them is already `overflow-x-auto`. */}
      <Table className="min-w-[46rem]">
        <TableHeader>
          <TableRow>
            <TableHead>Sale date</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Fan</TableHead>
            <TableHead>Creator</TableHead>
            <TableHead>Reviewer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-8">
              <span className="sr-only">Comment</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {disputes.map(d => {
            const expanded = expandedId === d.id;
            return (
              <Fragment key={d.id}>
                <TableRow className={expanded ? 'border-b-0' : undefined}>
                  <TableCell>
                    <SaleDate iso={d.saleDate} timezone={userTimezone} className="text-zinc-400" />
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-white">
                    {formatMoney(d.saleAmount)}
                  </TableCell>
                  <TableCell className="max-w-[14rem] truncate" title={d.fanName}>
                    {d.fanName}
                  </TableCell>
                  <TableCell className="max-w-[12rem]">
                    <PersonTag name={d.creatorName} photoURL={d.creatorPhotoURL} />
                  </TableCell>
                  <TableCell className="max-w-[12rem]">
                    <PersonTag name={d.assignedToName} photoURL={d.assignedToPhotoURL} />
                  </TableCell>
                  <TableCell>
                    <StagePill dispute={d} />
                  </TableCell>
                  <TableCell className="text-right">
                    {d.Comment && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-expanded={expanded}
                        aria-controls={`comment-${d.id}`}
                        aria-label={expanded ? 'Hide your comment' : 'Show your comment'}
                        onClick={() => setExpandedId(expanded ? null : d.id)}
                        className="text-zinc-400 hover:text-white"
                      >
                        <ChevronDownIcon
                          className={`transition-transform duration-[120ms] ease-out ${expanded ? 'rotate-180' : ''}`}
                        />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>

                {expanded && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={COLUMN_COUNT} className="pt-0">
                      <p id={`comment-${d.id}`} className="max-w-[75ch] text-sm text-pretty text-zinc-400">
                        {d.Comment}
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>

      <FeedFooter shown={disputes.length} total={total} page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}

// ─── Skeleton — same column rhythm as the table above ─────────────────

const SKELETON_HEADERS = ['Sale date', 'Amount', 'Fan', 'Creator', 'Reviewer', 'Status', ''];
const SKELETON_WIDTHS = ['w-32', 'w-16', 'w-24', 'w-28', 'w-28', 'w-24', 'w-4'];

function LedgerSkeleton() {
  return (
    <Table className="min-w-[46rem]">
      <TableHeader>
        <TableRow>
          {SKELETON_HEADERS.map((label, i) => (
            <TableHead key={i} className={i === COLUMN_COUNT - 1 ? 'w-8' : undefined}>
              {label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {[0, 1, 2, 3].map(row => (
          <TableRow key={row}>
            {SKELETON_WIDTHS.map((w, i) => (
              <TableCell key={i}>
                <Skeleton className={`h-4 ${w} ${i === 1 ? 'ml-auto' : ''}`} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
