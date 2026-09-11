'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TONE_CHIP } from '../_lib/session';
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

interface MemberRow {
  uid: string;
  displayName: string;
  workEmail: string;
  isArchived: boolean;
  glEmail: string;
  folderName: string;
  linked: boolean;
  joined: boolean;
  seatMissing: boolean;
  memberAddedAtMs: number | null;
}

interface Candidate {
  uid: string;
  displayName: string;
  workEmail: string;
}

interface Overview {
  members: MemberRow[];
  candidates: Candidate[];
  unmapped: { memberId: string; email: string; joined: boolean; role: string }[];
  seats: { used: number; max: number | null; planName: string };
  workspaceName: string;
}

/**
 * Workspace membership — who holds a **paid GoLogin seat**.
 *
 * This is the gate on the whole feature, not a nicety. A free GoLogin account
 * cannot generate an API token, so nobody without a seat can use GoLogin through
 * Bluu whatever page permissions they hold. Granting one here also creates the
 * person's folder and scopes them to it, which is why this panel sits beside
 * profile assignment rather than somewhere in the admin portal: the two are one
 * workflow, add then assign.
 *
 * **Removing a seat costs a person their access and is confirmed.** Assignment
 * toggles are one click with an undo path, but this is a different kind of act:
 * it ends a paid seat and cuts someone off mid-shift, and there is no undo that
 * restores their GoLogin invitation state.
 */
export default function MembersPanel({ onChanged }: { onChanged: () => void }) {
  const authFetch = useAuthFetch();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [confirming, setConfirming] = useState<MemberRow | null>(null);

  const [pickedUid, setPickedUid] = useState('');
  const [email, setEmail] = useState('');

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (force: boolean) => {
      setError(null);
      try {
        const next: Overview = await authFetch(
          `/api/gologin/admin/members${force ? '?refresh=1' : ''}`,
        );
        if (!aliveRef.current) return;
        setData(next);
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not load members.');
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    },
    [authFetch],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const candidates = data?.candidates ?? [];
  // Derived, never corrected in an effect: the chosen person can vanish on a
  // refresh (someone else added them), and writing state back during render is
  // the cascading render `react-hooks/set-state-in-effect` fails the build over.
  const picked = candidates.find((c) => c.uid === pickedUid) ?? null;

  // The work address is the default because it is usually right and always
  // editable — people sign up to GoLogin under whatever address they like, and
  // the seat must be granted to the one they will actually hold.
  const emailValue = email || picked?.workEmail || '';

  const add = async () => {
    if (!picked || !emailValue.trim() || busy) return;
    setBusy(picked.uid);
    try {
      await authFetch('/api/gologin/admin/members', {
        method: 'POST',
        body: JSON.stringify({ uid: picked.uid, email: emailValue.trim() }),
      });
      toast.success(`${picked.displayName} added. GoLogin has emailed them an invitation.`);
      setPickedUid('');
      setEmail('');
      await load(true);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add that member.');
    } finally {
      if (aliveRef.current) setBusy(null);
    }
  };

  const remove = async (member: MemberRow) => {
    setConfirming(null);
    setBusy(member.uid);
    try {
      await authFetch(`/api/gologin/admin/members?uid=${encodeURIComponent(member.uid)}`, {
        method: 'DELETE',
      });
      toast.success(`${member.displayName} removed from the workspace.`);
      await load(true);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove that member.');
    } finally {
      if (aliveRef.current) setBusy(null);
    }
  };

  const reconcile = async () => {
    setReconciling(true);
    try {
      const result: {
        provisioned: { uid: string }[];
        alreadyProvisioned: number;
        skippedAdmins: number;
        unmatched: { email: string }[];
        failed: { email: string; reason: string }[];
      } = await authFetch('/api/gologin/admin/members', {
        method: 'POST',
        body: JSON.stringify({ action: 'reconcile' }),
      });

      // Every outcome is reported, because they lead to different next steps.
      // The old copy said "Every matched member already has a folder" whenever
      // nothing was provisioned — which read as "all done" on a run where every
      // member had in fact failed to match, and sent the admin away satisfied.
      const done = result.provisioned.length;
      const parts: string[] = [];
      if (done) parts.push(`${done} set up`);
      if (result.alreadyProvisioned) parts.push(`${result.alreadyProvisioned} already done`);
      if (result.skippedAdmins) parts.push(`${result.skippedAdmins} admin${result.skippedAdmins === 1 ? '' : 's'} skipped`);
      if (result.unmatched.length) parts.push(`${result.unmatched.length} unmatched`);
      if (result.failed.length) parts.push(`${result.failed.length} failed`);

      const summary = parts.length ? parts.join(' · ') : 'Nothing to do.';
      if (result.failed.length) {
        // Every failure, named with its address — not `failed[0].reason` alone.
        // Five seats failing for five different reasons reported as one
        // unattributed sentence is indistinguishable from one seat failing, and
        // an admin cannot act on a reason without knowing whose it is. The
        // toast is capped so a wholesale failure does not become a wall; the
        // remainder is counted rather than dropped silently.
        const shown = result.failed.slice(0, 4);
        const rest = result.failed.length - shown.length;
        toast.error(summary, {
          description: [
            ...shown.map((f) => `${f.email}: ${f.reason}`),
            ...(rest > 0 ? [`…and ${rest} more.`] : []),
          ].join('\n'),
          // Long enough to read several lines, since the detail is the point.
          duration: 12_000,
        });
      } else if (done) {
        toast.success(summary);
      } else {
        // Not an error, but not a success either — nothing changed, and the
        // admin needs to know that rather than be congratulated.
        toast.info(summary, {
          description: result.unmatched.length
            ? 'Unmatched seats use a GoLogin address that no Bluu user has. Add them by hand below.'
            : undefined,
        });
      }

      await load(true);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reconcile members.');
    } finally {
      if (aliveRef.current) setReconciling(false);
    }
  };

  /**
   * Click an unmapped seat to load it into the Add form.
   *
   * The address is already known and usually already correct — retyping it is
   * pure transcription risk, and getting it wrong binds the wrong person to a
   * seat. Picks the Bluu user automatically when exactly one holds that work
   * address, which after the normalisation fix is the common case.
   */
  const mapUnmapped = (email: string) => {
    const key = email.trim().toLowerCase();
    const match = candidates.find((c) => c.workEmail.trim().toLowerCase() === key);
    setPickedUid(match?.uid ?? '');
    setEmail(email);
  };

  const seats = data?.seats;
  const unmapped = useMemo(() => data?.unmapped ?? [], [data]);

  if (loading) {
    return (
      // Shaped like the panel: the Add row (picker, address field, button) and
      // then the member list (name + badge over a meta line, with the Remove
      // control on the right). Five identical full-width bars matched neither,
      // so the layout jumped when the data landed.
      <div className="p-6" role="status" aria-label="Loading members">
        <Skeleton className="h-3 w-24 rounded" />
        <Skeleton className="mt-2 h-3 w-80 rounded" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-48 rounded-md" />
          <Skeleton className="h-9 w-64 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
        </div>

        <Skeleton className="mt-8 h-3 w-20 rounded" />
        <div className="mt-3 space-y-4">
          {['w-36', 'w-44', 'w-28', 'w-40', 'w-32'].map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className={`h-4 ${w} rounded`} />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-56 rounded" />
              </div>
              <Skeleton className="h-7 w-20 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 p-6">
        <p className="text-sm text-zinc-400">{error}</p>
        <Button variant="outline" size="sm" onClick={() => load(true)}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {/* Add */}
        <section>
          {/* A plain section label. The uppercase eyebrow is reserved for a
              window naming itself (DESIGN.md §3) — a panel inside a dialog is
              not that, and using it here made a scaffold out of a brand mark. */}
          <h3 className="text-xs font-medium text-zinc-400">Add a member</h3>
          <p className="mt-1 max-w-[62ch] text-[11px] text-zinc-400">
            Grants a paid GoLogin seat and creates their profile folder. GoLogin emails them an
            invitation; they can generate an API token once they accept it.
          </p>

          <div className="mt-3 flex flex-wrap items-start gap-2">
            {/* shadcn `Select`, not a native `<select>`. This was the only raw
                form control in the window — it inherited the OS menu, ignored
                the dark surface and looked like a different application, on the
                one control that decides *which person* gets a paid seat. */}
            <Select
              value={pickedUid}
              onValueChange={(value) => {
                setPickedUid(value);
                setEmail('');
              }}
            >
              <SelectTrigger
                aria-label="Bluu user"
                className="h-9 min-w-[12rem] border-zinc-700 bg-zinc-800"
              >
                <SelectValue placeholder="Choose a person…" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.uid} value={c.uid}>
                    {c.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={emailValue}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="GoLogin email address"
              aria-label="GoLogin email address"
              disabled={!picked}
              className="h-9 w-64 border-zinc-700 bg-zinc-800"
            />

            <Button
              size="sm"
              className="bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
              disabled={!picked || !emailValue.trim() || !!busy}
              onClick={add}
            >
              {busy === picked?.uid ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-3.5" aria-hidden />
              )}
              Add
            </Button>
          </div>

          {candidates.length === 0 && (
            <p className="mt-2 text-[11px] text-zinc-400">
              Everyone in the registry already holds a seat.
            </p>
          )}
        </section>

        {/* Pre-existing seats we cannot attribute. Reported rather than guessed
            at: binding the wrong Bluu user to a seat would show one person
            another person's profiles. */}
        {unmapped.length > 0 && (
          <section className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-white">
                  <span className="tabular-nums">{unmapped.length}</span> GoLogin{' '}
                  {unmapped.length === 1 ? 'seat is' : 'seats are'} not mapped to a Bluu user
                </h3>
                <p className="mt-1 max-w-[62ch] text-[11px] text-zinc-400">
                  They already hold a GoLogin seat but Bluu does not know who they are. Reconcile
                  matches each address to a Bluu user&rsquo;s login email, creates their profile
                  folder and scopes their existing seat to it — no new invitations and no extra
                  cost. Anyone whose GoLogin address differs from their Bluu one stays listed here;
                  click them to map it by hand.
                </p>
              </div>
              <Button variant="outline" size="sm" disabled={reconciling} onClick={reconcile}>
                {reconciling ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="size-3.5" aria-hidden />
                )}
                Reconcile
              </Button>
            </div>
            <ul className="mt-3 space-y-0.5 border-t border-white/[0.07] pt-3">
              {unmapped.map((m) => (
                <li key={m.memberId}>
                  {/* Clickable: loads the address into the Add form and picks the
                      matching Bluu user, so mapping one by hand is a click
                      rather than a retype — and a retyped address is how the
                      wrong person gets bound to a seat. */}
                  <button
                    type="button"
                    onClick={() => mapUnmapped(m.email)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6]"
                  >
                    {/* The address is the row's subject, so it takes Ink; the
                        status and the affordance are its de-emphasis step. All
                        three were previously three different greys, the lower
                        two of them below the contrast floor. */}
                    <span className="truncate font-mono text-white">{m.email}</span>
                    {!m.joined && <span className="shrink-0 text-zinc-400">· invite pending</span>}
                    <span className="ml-auto shrink-0 text-zinc-400">Map →</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Current members */}
        <section className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-medium text-zinc-400">Members</h3>
            {seats && (
              <p className="text-[11px] text-zinc-400">
                <span className="tabular-nums">{seats.used}</span>
                {seats.max ? (
                  <>
                    {' of '}
                    <span className="tabular-nums">{seats.max}</span>
                  </>
                ) : null}
                {' seats used'}
              </p>
            )}
          </div>

          {(data?.members.length ?? 0) === 0 ? (
            <p className="mt-3 max-w-[62ch] text-sm text-zinc-400">
              Nobody holds a seat through Bluu yet.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-white/[0.07]">
              {data!.members.map((member) => (
                <li key={member.uid} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">
                        {member.displayName}
                      </span>
                      {/* Each of these is a different thing being wrong, so each
                          says which. A single "inactive" badge would collapse
                          three unrelated remedies into one. */}
                      {member.seatMissing ? (
                        <Badge tone="red">Seat removed in GoLogin</Badge>
                      ) : !member.joined ? (
                        <Badge tone="zinc">Invite pending</Badge>
                      ) : !member.linked ? (
                        <Badge tone="zinc">No token yet</Badge>
                      ) : (
                        <Badge tone="green">Active</Badge>
                      )}
                      {member.isArchived && <Badge tone="red">Archived in Bluu</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                      <span className="font-mono">{member.glEmail}</span>
                      {member.folderName ? ` · ${member.folderName}` : ''}
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-7 shrink-0 text-zinc-400 hover:text-red-400"
                    disabled={busy === member.uid}
                    onClick={() => setConfirming(member)}
                  >
                    {busy === member.uid ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden />
                    )}
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirming?.displayName} from GoLogin?</AlertDialogTitle>
            <AlertDialogDescription>
              This releases their paid seat and cuts off their access immediately, including any
              profile they have open right now. Their folder and its assignments are kept, so adding
              them back restores everything — but they will have to accept a new GoLogin invitation
              and paste a new API token.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => confirming && remove(confirming)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The same triad as the profile list's row chips, from the same place.
 *
 * It was a fourth private copy of four hue pairs that also existed in the list,
 * the close guard and `session.ts`. Nothing was visibly wrong — which is the
 * problem: a fifth spelling would only have shown up as two surfaces disagreeing
 * about what "active" looks like.
 */
function Badge({ tone, children }: { tone: 'green' | 'zinc' | 'red'; children: React.ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CHIP[tone]}`}
    >
      {children}
    </span>
  );
}
