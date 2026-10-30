'use client';

import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SURFACE } from '@/lib/surfaces';
import type { AdminParticipant } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { formatWhen } from './zonedTime';

interface RemovedListProps {
  people: AdminParticipant[];
  timezone: string;
  onView: (person: AdminParticipant) => void;
  onRestore: (person: AdminParticipant) => void;
}

/**
 * Everyone whose access was removed — kept apart from the live roster so a module that runs
 * continuously stays readable. Their work is still here: click a name for the same sheet the
 * roster opens. Most recently removed first.
 */
export default function RemovedList({ people, timezone, onView, onRestore }: RemovedListProps) {
  if (people.length === 0) {
    return <p className="text-sm text-zinc-400">No one has been removed.</p>;
  }
  const sorted = [...people].sort((a, b) => (b.revokedAtMs ?? 0) - (a.revokedAtMs ?? 0));
  return (
    <div className={cn('overflow-x-auto rounded-xl', SURFACE)}>
      <Table>
        <TableHeader>
          <TableRow className="border-white/[0.07] hover:bg-transparent">
            <TableHead className="min-w-48">Candidate</TableHead>
            <TableHead className="min-w-40">Removed</TableHead>
            <TableHead className="min-w-32">Work</TableHead>
            <TableHead className="w-24 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((person) => {
            const display = person.name ?? person.email;
            const tests = Object.values(person.tests);
            const started = tests.filter((c) => c.startedAtMs !== null).length;
            return (
              <TableRow key={person.emailHash} className="border-white/[0.07] hover:bg-white/[0.04]">
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onView(person)}
                    className="rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                  >
                    <span className="block font-medium text-zinc-300 hover:underline">{display}</span>
                    {person.name && <span className="block text-[11px] text-zinc-400">{person.email}</span>}
                  </button>
                </TableCell>
                <TableCell className="text-sm text-zinc-400 tabular-nums">
                  {person.revokedAtMs ? formatWhen(person.revokedAtMs, timezone) : '—'}
                </TableCell>
                <TableCell className="text-sm text-zinc-400 tabular-nums">
                  {started > 0 ? `${started} of ${tests.length} tests started` : 'No tests started'}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="xs" onClick={() => onRestore(person)}>
                    <UserPlus className="size-3.5" />
                    Restore
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
