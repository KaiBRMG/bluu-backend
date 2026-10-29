'use client';

import { RotateCcw, UserMinus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SURFACE } from '@/lib/surfaces';
import type { AdminAttemptCell, AdminModuleDetail, AdminParticipant } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { AdminStateBadge } from './AdminStateBadge';
import { MirrorMark } from './SubmissionSlots';
import { TimeLeft } from './TimeLeft';

/** What goes under the state badge: the figure the state is about, and the Drive mirror in words. */
function CellNote({ cell, skewMs }: { cell: AdminAttemptCell; skewMs: number }) {
  const uploaded = cell.slotsTotal > 0 ? `${cell.slotsFilled} of ${cell.slotsTotal} uploaded` : null;
  return (
    <span className="flex flex-col items-start gap-0.5 text-[11px] text-zinc-400 tabular-nums">
      {cell.state === 'in-progress' && cell.deadlineMs ? (
        <span>
          {cell.reopenedAtMs ? 'reopened · ' : ''}
          <TimeLeft deadlineMs={cell.deadlineMs} skewMs={skewMs} /> left{uploaded ? ` · ${uploaded}` : ''}
        </span>
      ) : cell.state === 'submitted' || cell.state === 'timed-out' ? (
        uploaded && <span>{uploaded}</span>
      ) : null}
      <MirrorMark state={cell.mirror} />
    </span>
  );
}

interface RosterProps {
  detail: AdminModuleDetail;
  skewMs: number;
  onView: (person: AdminParticipant) => void;
  onReopen: (person: AdminParticipant, testId: string) => void;
  onRemove: (person: AdminParticipant) => void;
  onRestore: (person: AdminParticipant) => void;
}

/**
 * Everyone on the module against T1–T7, in one matrix — a module holds fewer
 * than ~15 candidates, so there is no pagination. The open test's column is
 * emphasised. Rows keep the order people were added in, so a live re-read never
 * moves a row under the reader.
 */
export default function Roster({ detail, skewMs, onView, onReopen, onRemove, onRestore }: RosterProps) {
  const openId = detail.module.openTestId;
  return (
    <div className={cn('overflow-x-auto rounded-xl', SURFACE)}>
      <Table>
        <TableHeader>
          <TableRow className="border-white/[0.07] hover:bg-transparent">
            <TableHead className="min-w-48">Candidate</TableHead>
            {detail.tests.map((t) => (
              <TableHead key={t.id} className={cn('min-w-32', t.id === openId && 'bg-blue-400/[0.06] text-blue-200')}>
                {t.id}
                {t.id === openId && <span className="ml-1 text-[11px] font-normal">open</span>}
              </TableHead>
            ))}
            <TableHead className="w-24 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.participants.map((person) => {
            const removed = person.revokedAtMs != null;
            const display = person.name ?? person.email;
            return (
              <TableRow key={person.emailHash} className="border-white/[0.07] hover:bg-white/[0.04]">
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onView(person)}
                    className="rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                  >
                    <span className={cn('block font-medium hover:underline', removed ? 'text-zinc-400' : 'text-white')}>{display}</span>
                    <span className="block text-[11px] text-zinc-400">
                      {person.name ? `${person.email} · ` : ''}
                      {removed ? 'Access removed' : person.name ? 'Signed in' : 'Not signed in yet'}
                    </span>
                  </button>
                </TableCell>
                {detail.tests.map((t) => {
                  const cell = person.tests[t.id];
                  return (
                    <TableCell key={t.id} className={cn('align-top', t.id === openId && 'bg-blue-400/[0.06]')}>
                      {cell && cell.state !== 'locked' && (
                        <div className="flex flex-col items-start gap-1">
                          <AdminStateBadge state={cell.state} />
                          <CellNote cell={cell} skewMs={skewMs} />
                          {!removed && cell.startedAtMs !== null && cell.state !== 'in-progress' && (
                            <Button
                              variant="ghost"
                              size="xs"
                              className="-ml-2 text-zinc-400 hover:text-white"
                              aria-label={`Reopen ${t.id} for ${display}`}
                              onClick={() => onReopen(person, t.id)}
                            >
                              <RotateCcw className="size-3.5" />
                              Reopen
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right align-top">
                  {removed ? (
                    <Button variant="ghost" size="xs" onClick={() => onRestore(person)}>
                      <UserPlus className="size-3.5" />
                      Restore
                    </Button>
                  ) : (
                    <Button variant="ghost" size="xs" className="text-zinc-400 hover:text-red-400" onClick={() => onRemove(person)}>
                      <UserMinus className="size-3.5" />
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
