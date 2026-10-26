'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Check, Copy, Loader2, UserMinus, UserPlus } from 'lucide-react';
import AddPeopleDialog from './AddPeopleDialog';
import { AdminStateBadge } from './AdminStateBadge';
import SourceImages from './SourceImages';
import SubmissionDialog from './SubmissionDialog';
import { formatWhen, msToWall, wallToMs } from './zonedTime';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTrainingSession } from '@/hooks/useTrainingAdmin';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { PUBLIC_APP_ORIGIN } from '@/lib/publicOrigin';
import { TRAINING_MODULES } from '@/lib/training/modules';
import type { AdminParticipant } from '@/lib/training/types';

const TRAINING_URL = `${PUBLIC_APP_ORIGIN}/training`;

/** What goes under the state badge: the figure the state is about. */
function partNote(p: AdminParticipant['parts'][string], total: number, timezone: string): string {
  if (p.state === 'in-progress' && p.deadlineMs) return `ends ${formatWhen(p.deadlineMs, timezone)}`;
  if (p.state === 'submitted' || p.state === 'timed-out') return `${p.slotsFilled} of ${total} uploaded`;
  return '';
}

/**
 * One training session: schedule, source images, and each person's progress.
 * Rendered inside the page's `AppLayout` and `<Suspense>` (the route param is
 * read on the server — see the page).
 */
export default function SessionView({ sessionId }: { sessionId: string }) {
  const { timezone } = useViewerTimezone();
  const { detail, error, refetch, update, addPeople, revoke, addSource, removeSource, loadSubmission } =
    useTrainingSession(sessionId);

  // Edits only. A field shows the server's value until it is touched, so the
  // 30s refresh never overwrites what is being typed and nothing needs an
  // effect to seed it.
  const [draft, setDraft] = useState<{ label?: string; closes?: string; opens: Record<string, string> }>({ opens: {} });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewing, setViewing] = useState<{ emailHash: string; partId: string; label: string } | null>(null);
  const [revoking, setRevoking] = useState<AdminParticipant | null>(null);
  const [busyRevoke, setBusyRevoke] = useState(false);

  const session = detail?.session;
  const mod = session ? TRAINING_MODULES[session.moduleId] : null;

  const label = draft.label ?? session?.label ?? '';
  const closes = draft.closes ?? (session ? msToWall(session.closesAtMs, timezone) : '');
  const opensFor = (partId: string) =>
    draft.opens[partId] ?? (session?.parts[partId] ? msToWall(session.parts[partId].opensAtMs, timezone) : '');

  const dirty =
    !!session &&
    (label.trim() !== session.label ||
      wallToMs(closes, timezone) !== session.closesAtMs ||
      Object.entries(session.parts).some(([k, v]) => wallToMs(opensFor(k), timezone) !== v.opensAtMs));

  const header = (title: string, sub?: string) => (
    <div className="mb-6">
      <Link
        href="/admin-portal/training"
        prefetch={false}
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-zinc-400 outline-none hover:text-zinc-200 focus-visible:text-white"
      >
        <ArrowLeft className="size-3.5" />
        Training
      </Link>
      <h1 className="mb-2 text-2xl font-bold tracking-tight">{title}</h1>
      {sub && <p className="text-sm text-zinc-400">{sub}</p>}
    </div>
  );

  if (error && !detail) {
    return (
        <div className="max-w-6xl">
          {header('Training session')}
          <div role="alert" className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-6">
            <p className="text-sm font-medium text-red-400">Couldn&apos;t load this session</p>
            <p className="mt-1 text-sm text-zinc-400">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        </div>
    );
  }

  if (!detail || !session || !mod) {
    return (
        <div className="max-w-6xl" aria-hidden>
          {header('Training session')}
          <Skeleton className="mb-6 h-40 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
    );
  }

  const now = detail.nowMs;
  const live = detail.participants.filter((p) => p.revokedAtMs == null);

  async function save() {
    setSaving(true);
    try {
      const changedOpens = Object.fromEntries(
        Object.entries(session!.parts)
          .filter(([k, v]) => wallToMs(opensFor(k), timezone) !== v.opensAtMs)
          .map(([k]) => [k, wallToMs(opensFor(k), timezone)]),
      );
      await update({
        ...(label.trim() !== session!.label ? { label } : {}),
        closesAtMs: wallToMs(closes, timezone),
        ...(Object.keys(changedOpens).length ? { opensAtMs: changedOpens } : {}),
      });
      setDraft({ opens: {} });
      toast.success('Session updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="max-w-6xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          {header(session.label, `${mod.title} · ${live.length} ${live.length === 1 ? 'person' : 'people'} · access ends ${formatWhen(session.closesAtMs, timezone)}`)}
          <Button
            variant="outline"
            size="sm"
            className="mt-7 shrink-0"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(TRAINING_URL);
                setCopied(true);
                toast.success('Training link copied');
                window.setTimeout(() => setCopied(false), 1600);
              } catch {
                toast.error('Could not copy. The link is ' + TRAINING_URL);
              }
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            Copy link
          </Button>
        </div>

        <section aria-labelledby="parts-heading" className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="parts-heading" className="text-lg font-semibold">
              Parts
            </h2>
            {dirty && (
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="activity-spinner size-4 animate-spin" />}
                Save changes
              </Button>
            )}
          </div>

          <div className="mb-3 grid gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="s-label" className="text-xs text-zinc-400">
                Session name
              </Label>
              <Input id="s-label" value={label} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="s-closes" className="text-xs text-zinc-400">
                Access ends ({timezone})
              </Label>
              <Input id="s-closes" type="datetime-local" value={closes} onChange={(e) => setDraft((d) => ({ ...d, closes: e.target.value }))} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {mod.parts.map((part) => {
              const cfg = session.parts[part.id];
              if (!cfg) return null;
              const opened = cfg.opensAtMs <= now;
              const ready = cfg.sources.length >= part.task.pickCount;
              return (
                <div key={part.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold">{part.title}</h3>
                      <p className="text-[11px] text-zinc-400 tabular-nums">
                        {Math.round(part.durationMs / 60_000)} minutes each · {part.task.slots.length} edits
                        {opened ? ' · opened' : ''}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`o-${part.id}`} className="text-xs text-zinc-400">
                        Opens ({timezone})
                      </Label>
                      <Input
                        id={`o-${part.id}`}
                        type="datetime-local"
                        disabled={opened}
                        value={opensFor(part.id)}
                        onChange={(e) => setDraft((d) => ({ ...d, opens: { ...d.opens, [part.id]: e.target.value } }))}
                        className="w-52"
                      />
                    </div>
                  </div>
                  {!ready && opened && (
                    <p role="alert" className="mt-3 text-sm text-orange-300">
                      This part is open but has {cfg.sources.length} {cfg.sources.length === 1 ? 'image' : 'images'}, and candidates need at least {part.task.pickCount} to start it.
                    </p>
                  )}
                  <div className="mt-4">
                    <SourceImages
                      images={cfg.sources}
                      minimum={part.task.pickCount}
                      locked={opened}
                      onAdd={(file) => addSource(part.id, file)}
                      onRemove={(imageId) => removeSource(part.id, imageId)}
                      onBatchDone={refetch}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="people-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="people-heading" className="text-lg font-semibold">
              People
            </h2>
            <AddPeopleDialog onAdd={addPeople} />
          </div>

          <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025]">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.07] hover:bg-transparent">
                  <TableHead>Candidate</TableHead>
                  {mod.parts.map((p) => (
                    <TableHead key={p.id}>{p.title}</TableHead>
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
                    <TableRow key={person.emailHash} className={`border-white/[0.07] hover:bg-white/[0.04] ${removed ? 'opacity-60' : ''}`}>
                      <TableCell>
                        <p className="font-medium text-white">{display}</p>
                        <p className="text-[11px] text-zinc-400">
                          {person.name ? `${person.email} · ` : ''}
                          {removed ? 'Access removed' : person.name ? 'Signed in' : 'Not signed in yet'}
                        </p>
                      </TableCell>
                      {mod.parts.map((part) => {
                        const cell = person.parts[part.id];
                        const canView = !!cell && (cell.state === 'in-progress' || cell.state === 'submitted' || cell.state === 'timed-out');
                        const note = cell ? partNote(cell, part.task.slots.length, timezone) : '';
                        return (
                          <TableCell key={part.id}>
                            {cell && (
                              <button
                                type="button"
                                disabled={!canView}
                                onClick={() => setViewing({ emailHash: person.emailHash, partId: part.id, label: display })}
                                className="flex flex-col items-start gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 enabled:cursor-pointer enabled:hover:opacity-80"
                                aria-label={`${display}, ${part.title}: ${cell.state}${canView ? '. View work' : ''}`}
                              >
                                <AdminStateBadge state={cell.state} />
                                {note && <span className="text-[11px] text-zinc-400 tabular-nums">{note}</span>}
                              </button>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right">
                        {removed ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={async () => {
                              try {
                                await addPeople(person.email);
                                toast.success(`${display} restored`);
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : 'Could not restore');
                              }
                            }}
                          >
                            <UserPlus className="size-3.5" />
                            Restore
                          </Button>
                        ) : (
                          <Button variant="ghost" size="xs" className="text-zinc-400 hover:text-red-400" onClick={() => setRevoking(person)}>
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
        </section>
      </div>

      <SubmissionDialog
        target={viewing}
        moduleId={session.moduleId}
        timezone={timezone}
        load={loadSubmission}
        onClose={() => setViewing(null)}
      />

      <AlertDialog open={!!revoking} onOpenChange={(open) => !busyRevoke && !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {revoking?.name ?? revoking?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this session straight away, even if they are signed in. Anything they already submitted is kept
              here, and you can restore them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyRevoke}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyRevoke}
              onClick={async (e) => {
                e.preventDefault();
                if (!revoking) return;
                setBusyRevoke(true);
                try {
                  await revoke(revoking.emailHash);
                  toast.success('Access removed');
                  setRevoking(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not remove access');
                } finally {
                  setBusyRevoke(false);
                }
              }}
            >
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
