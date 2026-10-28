'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTrainingCandidates } from '@/hooks/useTrainingAdmin';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { AdminStateBadge } from './AdminStateBadge';
import CandidateSheet from './CandidateSheet';
import { formatWhen } from './zonedTime';

/**
 * Every candidate across every session, most pressing first (a live clock, then
 * something to start, then what is coming, then what ended). The status is the
 * state of their most pressing part, with what it is about under it; the row is
 * the whole target and opens everything they have submitted. While anyone's part
 * is open or running the list refreshes itself, updating rows where they stand.
 */
export default function CandidatesPanel() {
  const { timezone } = useViewerTimezone();
  const { candidates, error, refetch } = useTrainingCandidates();
  const [query, setQuery] = useState('');
  // By id, so the panel's header follows the row as the list refreshes.
  const [openHash, setOpenHash] = useState<string | null>(null);
  const open = candidates?.find((c) => c.emailHash === openHash) ?? null;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!candidates || !q) return candidates;
    return candidates.filter((c) => `${c.name ?? ''} ${c.email}`.toLowerCase().includes(q));
  }, [candidates, query]);

  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-6">
        <p className="text-sm font-medium text-red-400">Couldn&apos;t load candidates</p>
        <p className="mt-1 text-sm text-zinc-400">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={refetch}>
          Try again
        </Button>
      </div>
    );
  }

  if (!shown) {
    return (
      <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-white/[0.07] px-4 py-4 last:border-b-0">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ml-auto h-5 w-24 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search candidates"
            className="pl-8"
          />
        </div>
        <p className="text-[11px] text-zinc-400 tabular-nums" aria-live="polite">
          {shown.length} {shown.length === 1 ? 'candidate' : 'candidates'}
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-8 text-center">
          <p className="text-sm font-medium text-white">{candidates?.length ? 'No one matches that' : 'No candidates yet'}</p>
          <p className="mt-1 text-sm text-zinc-400">
            {candidates?.length ? 'Try part of a name or an email address.' : 'People appear here once you add them to a session.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]">
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.07] hover:bg-transparent">
                <TableHead>Candidate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Parts done</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => {
                const display = c.name ?? c.email;
                return (
                  <TableRow
                    key={c.emailHash}
                    onClick={() => setOpenHash(c.emailHash)}
                    className="cursor-pointer border-white/[0.07] hover:bg-white/[0.055] active:bg-white/[0.08]"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8 shrink-0" style={{ background: getAvatarColor(display) }}>
                          <AvatarFallback style={{ background: getAvatarColor(display), color: '#fff' }} className="text-[10px]">
                            {getInitials(display)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenHash(c.emailHash);
                            }}
                            className="block max-w-full truncate text-left font-medium text-white outline-none hover:underline focus-visible:underline"
                          >
                            {display}
                          </button>
                          <p className="truncate text-[11px] text-zinc-400">
                            {c.name ? `${c.email} · ` : ''}
                            {c.name ? 'Signed in' : 'Not signed in yet'}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <AdminStateBadge state={c.status} />
                      {c.statusDetail && <p className="mt-1 max-w-[18rem] truncate text-[11px] text-zinc-400">{c.statusDetail}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.sessionCount}</TableCell>
                    <TableCell className="text-right tabular-nums text-zinc-300">
                      {c.partsTotal > 0 ? `${c.partsSubmitted} of ${c.partsTotal}` : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums text-zinc-300">{formatWhen(c.lastActivityMs, timezone)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CandidateSheet candidate={open} timezone={timezone} onClose={() => setOpenHash(null)} />
    </div>
  );
}
