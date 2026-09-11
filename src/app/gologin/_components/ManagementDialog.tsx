'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { isManagedGoLoginFolder } from '@/lib/gologin/types';
import MembersPanel from './MembersPanel';

interface ManagedUser {
  uid: string;
  displayName: string;
  workEmail: string;
  isArchived: boolean;
  glEmail: string;
  folderId: string;
  folderName: string;
  folderMissing: boolean;
  profileIds: string[];
}

interface ManagedProfile {
  id: string;
  name: string;
  os: string;
  notes: string;
  folders: string[];
}

/** A workspace source folder — the grouping an admin actually thinks in. */
interface ManagedFolder {
  id: string;
  name: string;
  profileIds: string[];
}

interface Overview {
  users: ManagedUser[];
  folders: ManagedFolder[];
  profiles: ManagedProfile[];
  truncated: boolean;
  budget: { used: number; max: number | null; planName: string };
  fetchedAtMs: number;
}

/**
 * Management — who can see which profiles.
 *
 * ## Two tabs, one workflow
 *
 * **Members** grants the paid GoLogin seat, which is what makes someone able to
 * use the feature at all — a free GoLogin account cannot generate an API token.
 * **Profile access** then decides what they see. That is the order they happen
 * in, so it is the order the tabs are in, and Members is the default because an
 * empty workspace has nothing to assign.
 *
 * ## The model the access tab edits
 *
 * Granting a seat also creates the person's folder and scopes them to it. From
 * then on assignment is folder membership and nothing else: granting a profile
 * adds it to their folder, revoking removes it. The seat's folder scoping is
 * never touched again, which is what makes revoking possible at all — GoLogin's
 * unshare endpoint takes no recipient, so per-person unsharing is not something
 * the API can express. Folder membership can.
 *
 * ## Why it is a dialog and not a page
 *
 * It edits the *contents* of the list behind it, on a surface whose whole job is
 * that list. A separate route would make an admin navigate away from the thing
 * they are reasoning about, and the window has no sidebar to navigate back with.
 *
 * Left pane picks the operator, right pane toggles profiles. The counts are the
 * point of the left pane — "who has how much" is the question an admin actually
 * arrives with.
 */
export default function ManagementDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful write so the profile list behind can catch up. */
  onChanged: () => void;
}) {
  const authFetch = useAuthFetch();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [folderBusy, setFolderBusy] = useState<string | null>(null);
  const [tab, setTab] = useState('members');
  /** A pending bulk folder write, held until the admin confirms its size. */
  const [confirmBulk, setConfirmBulk] = useState<{
    folder: ManagedFolder;
    action: 'add' | 'remove';
    count: number;
  } | null>(null);

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
          `/api/gologin/admin/assignments${force ? '?refresh=1' : ''}`,
        );
        if (!aliveRef.current) return;
        setData(next);
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not load assignments.');
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    },
    [authFetch],
  );

  // Fetched when the **access tab** is opened, not when the dialog is — and not
  // on mount. The assignment payload costs a `GET /user` plus a full profile
  // walk, and an admin who only came here to add a member must not spend that.
  useEffect(() => {
    if (!open || tab !== 'access') return;
    void load(false);
  }, [open, tab, load]);

  const users = data?.users ?? [];
  // Derived, never corrected in an effect: the selected operator can vanish on a
  // refresh, and writing state back during render is a cascading render that
  // `react-hooks/set-state-in-effect` fails the build over.
  const selected = users.find((u) => u.uid === selectedUid) ?? users[0] ?? null;

  const assigned = useMemo(() => new Set(selected?.profileIds ?? []), [selected]);

  const profiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = data?.profiles ?? [];
    const matches = needle
      ? all.filter((p) =>
          [p.name, p.notes, p.os, ...p.folders.filter((f) => !isManagedGoLoginFolder(f))]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : all;
    // Assigned first: the list an admin is auditing is what they already granted,
    // and hunting for it in alphabetical order among a thousand rows is the
    // failure mode this ordering removes.
    return [...matches].sort((a, b) => {
      const diff = Number(assigned.has(b.id)) - Number(assigned.has(a.id));
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [data?.profiles, query, assigned]);

  const toggle = async (profile: ManagedProfile) => {
    if (!selected || pending.has(profile.id)) return;
    const action = assigned.has(profile.id) ? 'remove' : 'add';

    setPending((prev) => new Set(prev).add(profile.id));
    // Optimistic: a write is one provider call and the row must not sit inert
    // while it lands. Rolled back below if it fails.
    setData((prev) =>
      prev
        ? {
            ...prev,
            users: prev.users.map((u) =>
              u.uid !== selected.uid
                ? u
                : {
                    ...u,
                    profileIds:
                      action === 'add'
                        ? [...u.profileIds, profile.id]
                        : u.profileIds.filter((id) => id !== profile.id),
                  },
            ),
          }
        : prev,
    );

    try {
      await authFetch('/api/gologin/admin/assignments', {
        method: 'POST',
        body: JSON.stringify({ uid: selected.uid, profileIds: [profile.id], action }),
      });
      onChanged();
    } catch (err) {
      // Reload rather than invert the optimistic edit: after a failed write the
      // real membership is whatever GoLogin says, not whatever we guessed.
      toast.error(err instanceof Error ? err.message : 'That change did not save.');
      void load(true);
    } finally {
      if (aliveRef.current) {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(profile.id);
          return next;
        });
      }
    }
  };

  /**
   * Assign or unassign a whole source folder.
   *
   * Not optimistic, unlike the single-profile toggle: this moves tens of ids at
   * once and guessing the resulting membership would be a large, confident lie
   * if the write failed. It reloads instead — one extra read on a rare action.
   *
   * **Confirmed, unlike the single-profile toggle**, and the difference is blast
   * radius rather than direction. One toggle is one click to undo; `Assign 47`
   * hands a colleague forty-seven live, logged-in accounts in one press, and
   * `Remove` takes them all back. Removing a single *seat* has been confirmed
   * since this panel shipped — the two were simply inconsistent about which act
   * was the big one.
   */
  const toggleFolder = async (folder: ManagedFolder, action: 'add' | 'remove') => {
    if (!selected || folderBusy) return;
    setFolderBusy(folder.id);
    try {
      const result: { moved?: number } = await authFetch('/api/gologin/admin/assignments', {
        method: 'POST',
        body: JSON.stringify({ uid: selected.uid, sourceFolderId: folder.id, action }),
      });
      const moved = result?.moved ?? folder.profileIds.length;
      toast.success(
        action === 'add'
          ? `Assigned ${moved} profile${moved === 1 ? '' : 's'} to ${selected.displayName}.`
          : `Removed ${moved} profile${moved === 1 ? '' : 's'} from ${selected.displayName}.`,
      );
      await load(true);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That change did not save.');
      void load(true);
    } finally {
      if (aliveRef.current) setFolderBusy(null);
    }
  };

  const budget = data?.budget;

  /**
   * Source folders with how much of each this operator already has.
   *
   * Hidden while searching: a search is about finding one profile, and bulk
   * folder buttons sitting above a filtered list invite assigning far more than
   * what is on screen.
   */
  const folderRows = useMemo(() => {
    if (query.trim()) return [];
    return (data?.folders ?? [])
      .filter((f) => f.profileIds.length > 0)
      .map((f) => ({
        folder: f,
        assigned: f.profileIds.filter((id) => assigned.has(id)).length,
      }));
  }, [data?.folders, assigned, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(78vh,720px)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <DialogHeader className="shrink-0 border-b border-white/[0.07] px-6 pb-0 pt-5 text-left">
          <DialogTitle className="text-lg font-bold tracking-tight text-white">
            GoLogin management
          </DialogTitle>
          <DialogDescription className="text-[11px] text-zinc-400">
            {/* Two halves of one workflow, in the order they happen: a seat is
                what lets someone use GoLogin at all, and assignment decides
                what they see once they can. */}
            Add people to the workspace, then choose which profiles each can open.
          </DialogDescription>
          <TabsList className="mt-3 bg-transparent p-0">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="access">Profile access</TabsTrigger>
          </TabsList>
        </DialogHeader>

        <TabsContent value="members" className="m-0 min-h-0 flex-1 overflow-hidden">
          <MembersPanel onChanged={onChanged} />
        </TabsContent>

        <TabsContent value="access" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <p className="shrink-0 px-6 pb-1 pt-3 text-[11px] text-zinc-400">
            Changes take effect the next time that person refreshes.
            {budget?.max ? (
              <>
                {' · '}
                <span className="tabular-nums">{budget.used}</span>
                {' of '}
                <span className="tabular-nums">{budget.max}</span>
                {' shares used'}
              </>
            ) : null}
          </p>

        {loading ? (
          // Shaped like the two panes it replaces — a 256px person rail beside
          // the profile list — rather than a stack of identical full-width bars,
          // which matched no layout in this dialog and jumped when the data
          // landed. Widths vary so it reads as content arriving, not as a
          // rendering artefact.
          <div className="flex min-h-0 flex-1" role="status" aria-label="Loading assignments">
            <div className="w-64 shrink-0 space-y-3 border-r border-white/[0.07] px-4 py-3">
              {['w-28', 'w-36', 'w-24', 'w-32', 'w-28', 'w-40'].map((w, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className={`h-4 ${w} rounded`} />
                  <Skeleton className="h-3 w-40 rounded" />
                </div>
              ))}
            </div>
            <div className="min-w-0 flex-1 px-5 py-3">
              <Skeleton className="h-9 w-full rounded-md" />
              <div className="mt-4 space-y-3">
                {['w-44', 'w-32', 'w-52', 'w-36', 'w-48', 'w-40'].map((w, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className={`h-4 ${w} rounded`} />
                      <Skeleton className="h-3 w-28 rounded" />
                    </div>
                    <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-start gap-2 p-6">
            <p className="text-sm text-zinc-400">{error}</p>
            <Button variant="outline" size="sm" onClick={() => load(true)}>
              Retry
            </Button>
          </div>
        ) : users.length === 0 ? (
          <div className="flex-1 p-6">
            <p className="max-w-[60ch] text-sm text-zinc-400">
              Nobody has linked a GoLogin account yet. Someone appears here once they open this
              window and complete the three setup steps — until then there is no folder to share
              anything into.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* People */}
            <div className="w-64 shrink-0 overflow-y-auto border-r border-white/[0.07] py-2">
              {users.map((user) => {
                const active = selected?.uid === user.uid;
                return (
                  <button
                    key={user.uid}
                    type="button"
                    onClick={() => setSelectedUid(user.uid)}
                    aria-current={active}
                    // Selection is Action Blue **tint** plus weight, not a
                    // slightly brighter overlay. Selected and hover were
                    // `bg-white/[0.06]` against `bg-white/[0.03]` — about 1.1:1
                    // apart, which is the failure DESIGN.md §5 documents by name
                    // on the sibling satellite's chat rows. It matters more here
                    // than there: every toggle in the right-hand pane writes
                    // access to live logged-in accounts to whoever this is.
                    className={`flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] ${
                      active ? 'bg-[#3b82f6]/15' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span
                        className={`truncate text-sm ${
                          active ? 'font-semibold text-white' : 'font-medium text-zinc-400'
                        }`}
                      >
                        {user.displayName}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                        {user.profileIds.length}
                      </span>
                    </span>
                    <span className="w-full truncate text-[11px] text-zinc-400">{user.glEmail}</span>
                    {user.folderMissing && (
                      <span className="text-[11px] text-red-400">Folder missing in GoLogin</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Profiles */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-white/[0.07] px-5 py-3">
                {/* Who this pane writes to, said outright. It was only ever
                    implied — by a highlight too faint to read and by a search
                    placeholder that disappears the moment anyone types. Every
                    control below grants or revokes access to a live logged-in
                    account, so the name belongs where it cannot vanish. */}
                <p className="mb-2 truncate text-sm text-zinc-400">
                  Editing access for{' '}
                  <span className="font-semibold text-white">
                    {selected?.displayName ?? 'nobody'}
                  </span>
                </p>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
                    aria-hidden
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search profiles"
                    aria-label="Search profiles"
                    className="border-zinc-700 bg-zinc-800 pl-9"
                  />
                </div>
                {data?.truncated && (
                  <p className="mt-2 text-[11px] text-zinc-400">
                    Showing the first {data.profiles.length} profiles in the workspace.
                  </p>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
                {/* Folders first, because "give Kai the JORGE accounts" is the
                    request an admin actually arrives with — the per-profile list
                    below is for the exceptions to it. */}
                {folderRows.length > 0 && (
                  <section className="mb-2 border-b border-white/[0.07] px-1 pb-2">
                    <div className="flex items-baseline justify-between gap-3 px-2 py-1.5">
                      {/* A plain section label, not the sidebar eyebrow —
                          DESIGN.md keeps that a single-use brand device, and
                          this dialog is not the window naming itself. */}
                      <h4 className="text-xs font-medium text-zinc-400">Folders</h4>
                      {/* Said once, here, rather than on every row: this copies
                          what the folder holds *now*. GoLogin has no webhook, so
                          a later addition cannot propagate — and a reader who
                          assumes it does will under-assign for weeks. That makes
                          it the most consequential sentence on this pane, and it
                          was set in the one grey that fails AA on every ground
                          in the app. */}
                      <span className="text-[11px] text-zinc-400">
                        Copies what the folder holds now
                      </span>
                    </div>

                    <ul>
                      {folderRows.map(({ folder, assigned: n }) => {
                        const total = folder.profileIds.length;
                        const all = n === total;
                        const busy = folderBusy === folder.id;
                        return (
                          <li
                            key={folder.id}
                            className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-white">{folder.name}</span>
                              <span className="block text-[11px] tabular-nums text-zinc-400">
                                {n} of {total} assigned
                              </span>
                            </span>

                            <span className="flex shrink-0 items-center gap-1.5">
                              {busy ? (
                                <Loader2 className="size-4 animate-spin text-blue-400" aria-hidden />
                              ) : (
                                <>
                                  {/* Both actions stay visible and are disabled
                                      at their no-op, rather than swapping one
                                      button for the other — a control that
                                      changes identity under the cursor is how
                                      "remove all" gets clicked by accident. */}
                                  <Button
                                    variant="outline"
                                    size="xs"
                                    className="h-7"
                                    disabled={all}
                                    title={
                                      all
                                        ? `${selected?.displayName ?? 'This person'} already has every profile in ${folder.name}`
                                        : undefined
                                    }
                                    onClick={() =>
                                      setConfirmBulk({ folder, action: 'add', count: total - n })
                                    }
                                  >
                                    {all ? 'All assigned' : `Assign ${total - n}`}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    className="h-7 text-zinc-400 hover:text-red-400"
                                    disabled={n === 0}
                                    // The label cannot say why it is disabled —
                                    // "Remove" reads the same at zero as at
                                    // forty — so the title carries the reason.
                                    title={
                                      n === 0
                                        ? `${selected?.displayName ?? 'This person'} has nothing from ${folder.name}`
                                        : undefined
                                    }
                                    onClick={() =>
                                      setConfirmBulk({ folder, action: 'remove', count: n })
                                    }
                                  >
                                    Remove
                                  </Button>
                                </>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {profiles.length === 0 ? (
                  // Empty *because of a filter* is a dead end, so it carries its
                  // own way out and names what is behind it — the same rule the
                  // profile list already follows. This pane was the half of the
                  // feature that offered neither.
                  query.trim() ? (
                    <p className="p-4 text-sm text-zinc-400">
                      Nothing matches that search.{' '}
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="rounded underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
                      >
                        Clear it
                      </button>{' '}
                      to see all{' '}
                      <span className="tabular-nums">{data?.profiles.length ?? 0}</span>.
                    </p>
                  ) : (
                    <p className="p-4 text-sm text-zinc-400">
                      There are no profiles in this workspace yet.
                    </p>
                  )
                ) : (
                  <ul>
                    {profiles.map((profile) => {
                      const on = assigned.has(profile.id);
                      const busy = pending.has(profile.id);
                      return (
                        <li key={profile.id}>
                          <button
                            type="button"
                            onClick={() => toggle(profile)}
                            disabled={busy}
                            aria-pressed={on}
                            className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] disabled:opacity-60"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-white">
                                {profile.name || 'Untitled profile'}
                              </span>
                              <span className="block truncate text-[11px] text-zinc-400">
                                {/* Bluu's own per-operator folders stripped: a
                                    profile assigned to five people would
                                    otherwise list five `Bluu · …` folders here,
                                    burying the workspace folder that actually
                                    says what the profile is for. Who has it is
                                    already answered by the Assigned state. */}
                                {[
                                  profile.os,
                                  ...profile.folders.filter((f) => !isManagedGoLoginFolder(f)),
                                ]
                                  .filter(Boolean)
                                  .join(' · ') ||
                                  'No folder'}
                              </span>
                            </span>
                            <span className="shrink-0">
                              {busy ? (
                                <Loader2 className="size-4 animate-spin text-blue-400" aria-hidden />
                              ) : on ? (
                                // Granted is the state worth a hue; "not granted"
                                // is the default and takes none.
                                // No dismissal glyph. The whole row is the
                                // target, and an X inside the pill promised a
                                // smaller, more precise hit area than exists —
                                // a control that is not one. The pill states
                                // the state; `aria-pressed` on the row carries
                                // the fact that clicking it toggles.
                                <span className="rounded-full bg-[#2563eb] px-2 py-0.5 text-[11px] font-medium text-white">
                                  Assigned
                                </span>
                              ) : (
                                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                                  Assign
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
        </TabsContent>
        </Tabs>
      </DialogContent>

      <AlertDialog
        open={!!confirmBulk}
        onOpenChange={(next) => !next && setConfirmBulk(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmBulk?.action === 'add'
                ? `Give ${selected?.displayName} ${confirmBulk?.count} profile${confirmBulk?.count === 1 ? '' : 's'}?`
                : `Take ${confirmBulk?.count} profile${confirmBulk?.count === 1 ? '' : 's'} back from ${selected?.displayName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmBulk?.action === 'add' ? (
                <>
                  Everything in <strong className="font-semibold text-white">{confirmBulk?.folder.name}</strong>{' '}
                  is copied into their folder, and each one is a live, logged-in account they will
                  be able to open. This copies what the folder holds right now — profiles added to
                  it later do not follow.
                </>
              ) : (
                <>
                  They lose access to everything they currently hold from{' '}
                  <strong className="font-semibold text-white">{confirmBulk?.folder.name}</strong>.
                  Anything they have open stays open until they close it.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirmBulk?.action === 'remove'
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]'
              }
              onClick={() => {
                if (!confirmBulk) return;
                const { folder, action } = confirmBulk;
                setConfirmBulk(null);
                void toggleFolder(folder, action);
              }}
            >
              {confirmBulk?.action === 'add' ? 'Assign' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
