'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2Icon, Plus, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CreatorAvatar } from '@/components/creators/CreatorChip';

/**
 * Managing a creator's secondary accounts.
 *
 * A creator often runs more than one account — Cole on OnlyFans, "Cole (Fansly)"
 * on Fansly. For **shift assignment and pay these are peers**: one agent can be
 * assigned Cole and another Cole (Fansly), and each counts as one account toward
 * whoever holds it. That is the whole reason this screen exists — before it a
 * two-account creator counted as one, and an admin had to override the account
 * count by hand on every day of the month.
 *
 * ## Archive, not delete
 *
 * A sub-account's id is stored on every shift it was assigned to, and those
 * shifts are what the salary engine prices. Deleting one that has been used
 * leaves those ids resolving to nothing — the shift still pays, but the chip
 * becomes a raw id nobody can identify. The server refuses that delete; this
 * dialog offers archive, which pulls it from every picker while leaving history
 * readable. Delete stays available only for one added by mistake.
 */

export interface SubAccountRow {
  subAccountId: string;
  parentCreatorId: string;
  label: string;
  stageName: string;
  OFID?: string;
  isArchived: boolean;
}

interface SubAccountsDialogProps {
  creator: { uid: string; stageName: string; photoURL?: string | null } | null;
  onClose: () => void;
  /** Called after any change, so the page can refresh its creator list. */
  onChanged?: () => void;
  apiRequest: (path: string, options?: RequestInit) => Promise<Response>;
}

export function SubAccountsDialog({ creator, onClose, onChanged, apiRequest }: SubAccountsDialogProps) {
  const [rows, setRows] = useState<SubAccountRow[] | null>(null);
  const [label, setLabel] = useState('');
  const [ofid, setOfid] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const creatorId = creator?.uid ?? null;

  const load = useCallback(async () => {
    if (!creatorId) return;
    try {
      const res = await apiRequest(`/api/admin/creators/${creatorId}/subaccounts`);
      if (!res.ok) throw new Error('Could not load sub-accounts');
      const body = (await res.json()) as { subAccounts: SubAccountRow[] };
      setRows(body.subAccounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sub-accounts');
      setRows([]);
    }
  }, [creatorId, apiRequest]);

  useEffect(() => {
    if (!creatorId) return;
    setRows(null);
    setError(null);
    setLabel('');
    setOfid('');
    void load();
  }, [creatorId, load]);

  async function send(path: string, options: RequestInit, key: string, success: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await apiRequest(path, options);
      if (!res.ok) {
        // The server's message names the actual rule — a duplicate label, an
        // account already used by a shift — which is the only useful thing here.
        let message = `Request failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        setError(message);
        return false;
      }
      toast.success(success);
      await load();
      onChanged?.();
      return true;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const active = rows?.filter(r => !r.isArchived) ?? [];
  const archived = rows?.filter(r => r.isArchived) ?? [];

  return (
    <Dialog open={creator !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sub-accounts</DialogTitle>
          <DialogDescription>
            Other accounts {creator?.stageName} runs. Each can be assigned to a shift on its own, and counts as one
            account toward that agent&apos;s hourly rate.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async event => {
            event.preventDefault();
            if (!creatorId || !label.trim()) return;
            const ok = await send(
              `/api/admin/creators/${creatorId}/subaccounts`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: label.trim(), OFID: ofid.trim() }),
              },
              'create',
              'Sub-account added',
            );
            if (ok) {
              setLabel('');
              setOfid('');
            }
          }}
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="sub-label" className="text-xs">
              Label
            </Label>
            <Input
              id="sub-label"
              value={label}
              onChange={event => setLabel(event.target.value)}
              placeholder="Fansly"
              maxLength={40}
              className="h-8"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="sub-ofid" className="text-xs">
              Handle <span className="text-zinc-400">(optional)</span>
            </Label>
            <Input
              id="sub-ofid"
              value={ofid}
              onChange={event => setOfid(event.target.value)}
              placeholder="@colefansly"
              className="h-8"
            />
          </div>
          <Button type="submit" size="sm" disabled={busy === 'create' || !label.trim()}>
            {busy === 'create' && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
            <Plus className="size-3.5" aria-hidden />
            Add
          </Button>
        </form>

        {/* The resulting name, before they commit to it — the label alone
            ("Fansly") is not what anyone will see on a shift. */}
        {label.trim() && (
          <p className="text-xs text-zinc-400">
            Will appear as{' '}
            <span className="text-foreground">
              {creator?.stageName} ({label.trim()})
            </span>
          </p>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {rows === null ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : active.length === 0 && archived.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No sub-accounts yet. Add one for each additional account {creator?.stageName} runs.
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.07] rounded-lg border border-white/[0.07]">
            {[...active, ...archived].map(row => (
              <li
                key={row.subAccountId}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-2 px-3 py-2',
                  row.isArchived && 'opacity-60',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CreatorAvatar
                    creatorId={row.subAccountId}
                    name={row.stageName}
                    photoURL={creator?.photoURL}
                    className="size-6 text-[10px]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{row.stageName}</span>
                    {row.OFID && <span className="block truncate text-xs text-zinc-400">{row.OFID}</span>}
                  </span>
                  {row.isArchived && (
                    <span className="rounded-full bg-zinc-500/15 px-1.5 py-px text-[10px] font-medium text-zinc-400">
                      Archived
                    </span>
                  )}
                </span>

                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy === row.subAccountId}
                    className="text-zinc-400"
                    onClick={() =>
                      void send(
                        `/api/admin/creators/${creatorId}/subaccounts/${row.subAccountId}`,
                        {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ isArchived: !row.isArchived }),
                        },
                        row.subAccountId,
                        row.isArchived ? 'Sub-account restored' : 'Sub-account archived',
                      )
                    }
                  >
                    {busy === row.subAccountId && <Loader2Icon className="activity-spinner size-3" aria-hidden />}
                    {row.isArchived ? (
                      <>
                        <Undo2 aria-hidden />
                        Restore
                      </>
                    ) : (
                      'Archive'
                    )}
                  </Button>

                  {/* Offered for one added by mistake. The server refuses it once
                      the account has been assigned to a shift, and says why. */}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={busy === row.subAccountId}
                    aria-label={`Delete ${row.stageName}`}
                    className="text-zinc-400 transition-colors duration-[120ms] hover:text-red-400"
                    onClick={() =>
                      void send(
                        `/api/admin/creators/${creatorId}/subaccounts/${row.subAccountId}`,
                        { method: 'DELETE' },
                        row.subAccountId,
                        'Sub-account deleted',
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
