'use client';

import { SearchIcon, XIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { GrowthAccount } from '@/types/firestore';

/**
 * Search across the tracked accounts, by handle or by the platform's own account
 * id.
 *
 * **Why the id is searchable at all.** The handle is the only name this
 * subsystem has, and handles change — a renamed account keeps its numeric id and
 * loses everything else, so the id is the one key that survives. It is scraped
 * free inside the already-billed profile result (`platformAccountId`), and it is
 * absent on accounts that have never been read or whose actor did not report
 * one; `matchesAccountQuery` treats a missing id as "no match on that field"
 * rather than excluding the account, so searching by name always works.
 *
 * It sits **below the chart** because it filters the chart as well as the table:
 * a control placed above them would push both down as results narrow, and the
 * page already learned that lesson with the range control (see `page.tsx`). The
 * summary tiles above are deliberately *not* filtered by it — they answer "how
 * is the roster doing", and mutating content off-screen upward while someone
 * types is the exact jump this layout is arranged to avoid.
 */

/** Case-insensitive substring match on the handle, or a prefix match on the id. */
export function matchesAccountQuery(account: GrowthAccount, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (account.handle.toLowerCase().includes(q)) return true;
  // An id is an opaque number nobody remembers the middle of: matching it as a
  // prefix keeps a query like "17" from dragging in every account whose id
  // happens to contain those digits, while a full paste still resolves.
  return account.platformAccountId !== null && account.platformAccountId.startsWith(q);
}

export function AccountSearch({
  value,
  onChange,
  resultCount,
  totalCount,
}: {
  value: string;
  onChange: (next: string) => void;
  resultCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full max-w-xs">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-500"
          aria-hidden
        />
        <Input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search accounts by name or ID"
          aria-label="Search accounts by name or ID"
          autoComplete="off"
          spellCheck={false}
          className="h-8 pr-8 pl-8 text-sm"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-1 text-zinc-400 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] focus-visible:outline-none"
          >
            <XIcon className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {/* Stated, not implied: with the chart filtered too, a narrow result set
          otherwise looks like missing data rather than an active filter. */}
      {value.trim() && (
        <p role="status" className="text-xs text-zinc-400 tabular-nums">
          {resultCount} of {totalCount} {totalCount === 1 ? 'account' : 'accounts'}
        </p>
      )}
    </div>
  );
}
