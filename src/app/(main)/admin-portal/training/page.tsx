'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import CandidatesPanel from '@/components/admin/training/CandidatesPanel';
import CreateSessionDialog from '@/components/admin/training/CreateSessionDialog';
import { formatWhen } from '@/components/admin/training/zonedTime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTrainingSessions } from '@/hooks/useTrainingAdmin';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { TRAINING_MODULES } from '@/lib/training/modules';
import type { AdminSessionRow } from '@/lib/training/types';

function status(row: AdminSessionRow, now: number): { label: string; tone: string } {
  if (now > row.closesAtMs) return { label: 'Closed', tone: 'border-white/10 bg-white/[0.04] text-zinc-400' };
  if (now >= row.firstOpensAtMs) return { label: 'Running', tone: 'border-blue-400/30 bg-blue-400/10 text-blue-300' };
  return { label: 'Upcoming', tone: 'border-white/10 bg-white/[0.04] text-zinc-200' };
}

/**
 * Training sessions: who is sitting what, and when. A session is the unit an
 * admin creates; its page shows the parts, the source images and each person's
 * progress. The candidate side lives at /training (documentation/training.md).
 */
export default function AdminTrainingPage() {
  const router = useRouter();
  const { timezone } = useViewerTimezone();
  const { sessions, nowMs, error, refetch } = useTrainingSessions();
  const [tab, setTab] = useState('sessions');

  const header = (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Training</h1>
        <p className="text-sm text-zinc-400">Timed sessions for prospective staff, and how each person is getting on.</p>
      </div>
      {tab === 'sessions' && <CreateSessionDialog onCreated={(id) => router.push(`/admin-portal/training/${id}`)} />}
    </div>
  );

  return (
    <AppLayout>
      <div className="max-w-6xl">
        {header}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="candidates">Candidates</TabsTrigger>
          </TabsList>

          <TabsContent value="sessions" className="mt-4">
            {error ? (
              <div role="alert" className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-6">
                <p className="text-sm font-medium text-red-400">Couldn&apos;t load sessions</p>
                <p className="mt-1 text-sm text-zinc-400">{error}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()}>
                  Try again
                </Button>
              </div>
            ) : !sessions ? (
              <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-4 border-b border-white/[0.07] px-4 py-4 last:border-b-0">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="ml-auto h-4 w-24" />
                  </div>
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-8 text-center">
                <p className="text-sm font-medium text-white">No sessions yet</p>
                <p className="mt-1 text-sm text-zinc-400">Create one to give a group of candidates access to a training module.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/[0.07] hover:bg-transparent">
                      <TableHead>Session</TableHead>
                      <TableHead className="text-right">People</TableHead>
                      <TableHead>Opens</TableHead>
                      <TableHead>Access ends</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((row) => {
                      const st = status(row, nowMs);
                      return (
                        <TableRow
                          key={row.id}
                          onClick={() => router.push(`/admin-portal/training/${row.id}`)}
                          className="cursor-pointer border-white/[0.07] hover:bg-white/[0.055] active:bg-white/[0.08]"
                        >
                          <TableCell>
                            <Link
                              href={`/admin-portal/training/${row.id}`}
                              prefetch={false}
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-white outline-none hover:underline focus-visible:underline"
                            >
                              {row.label}
                            </Link>
                            <p className="text-[11px] text-zinc-400">{TRAINING_MODULES[row.moduleId]?.title ?? row.moduleId}</p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{row.participantCount}</TableCell>
                          <TableCell className="tabular-nums text-zinc-300">{formatWhen(row.firstOpensAtMs, timezone)}</TableCell>
                          <TableCell className="tabular-nums text-zinc-300">{formatWhen(row.closesAtMs, timezone)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`font-medium ${st.tone}`}>
                              {st.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Mounted lazily by `Tabs`, so the all-candidates read happens when the tab is first opened. */}
          <TabsContent value="candidates" className="mt-4">
            <CandidatesPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
