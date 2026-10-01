'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Search, Trash2, Users } from 'lucide-react';
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
import { namesSentence } from '@/lib/gologin/types';
import OsIcon from './OsIcon';
import { DANGER_BUTTON, FIELD, PRIMARY_BUTTON, plural, type ManagedFolder } from '../_lib/manage';
import { useManagedFolders, type FolderProfile } from '../_lib/useManagedFolders';


/**
 * Edit Folders — create and delete the workspace's folders, and decide what is
 * in each.
 *
 * Same two-pane shape the old Profile access tab had, pointed at folders
 * instead of people: pick a folder on the left, toggle profiles on the right.
 * One folder at a time is deliberate — every toggle writes to the folder named
 * in the pane header, and a multi-folder selection would make "what did that
 * click just change?" a question.
 *
 * **There is no rename.** GoLogin has no endpoint for it, and an emulated one
 * is four non-atomic writes that can leave two folders behind (decided
 * 2026-09-30). The dialog says so rather than leaving the reader to hunt for a
 * control that is not there.
 *
 * Folders here are the workspace's own. Bluu's per-person folders are never
 * listed: they decide who can see what, which is the Sharing dialog's job.
 */
export default function EditFoldersDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Folder membership changed — the list behind should re-read its chips. */
  onChanged: () => void;
}) {
  const authFetch = useAuthFetch();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<ManagedFolder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const dirtyRef = useRef(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const { folders, setFolders, profiles: allProfiles, truncated, loading, error, reload, retry } =
    useManagedFolders(open, { withProfiles: true });

  // Derived, never corrected in an effect — the selected folder can be deleted.
  const selected = folders.find((f) => f.id === selectedId) ?? folders[0] ?? null;
  const members = useMemo(() => new Set(selected?.profileIds ?? []), [selected]);

  /**
   * Members first — but the order is **fixed when the folder or the search
   * changes, never by a toggle**. Re-sorting on every click moved the row just
   * clicked out from under the cursor, so a quick second click toggled a
   * different profile. The snapshot is adjusted during render against a key,
   * not in an effect (`react-hooks/set-state-in-effect`).
   */
  const orderKey = `${selected?.id ?? ''}\u0000${query}\u0000${allProfiles.length}`;
  const [order, setOrder] = useState<{ key: string; firstIds: ReadonlySet<string> } | null>(null);
  if (order?.key !== orderKey) setOrder({ key: orderKey, firstIds: members });
  const firstIds = order?.key === orderKey ? order.firstIds : members;

  const profiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle ? allProfiles.filter((p) => p.name.toLowerCase().includes(needle)) : allProfiles;
    return [...matches].sort((a, b) => {
      const diff = Number(firstIds.has(b.id)) - Number(firstIds.has(a.id));
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [allProfiles, query, firstIds]);

  const close = (next: boolean) => {
    if (!next && dirtyRef.current) {
      dirtyRef.current = false;
      onChanged();
    }
    onOpenChange(next);
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const result: { folder: ManagedFolder } = await authFetch('/api/gologin/manage/folders', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setFolders((prev) => [...prev, result.folder].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId(result.folder.id);
      setNewName('');
      dirtyRef.current = true;
      toast.success(`Created ${result.folder.name}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the folder.');
    } finally {
      if (aliveRef.current) setCreating(false);
    }
  };

  const remove = async (folder: ManagedFolder) => {
    setDeleting(true);
    try {
      const result: { unsharedFrom: number } = await authFetch(
        `/api/gologin/manage/folders?id=${encodeURIComponent(folder.id)}`,
        { method: 'DELETE' },
      );
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      dirtyRef.current = true;
      toast.success(
        result.unsharedFrom
          ? `Deleted ${folder.name}. It is no longer shared with ${plural(result.unsharedFrom, 'person', 'people')}.`
          : `Deleted ${folder.name}.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the folder.');
    } finally {
      if (aliveRef.current) {
        setDeleting(false);
        setConfirmDelete(null);
      }
    }
  };

  /**
   * One profile in or out of a folder — optimistic, rolled back by re-reading.
   *
   * When the folder is shared, this is a grant or a revoke for everyone it is
   * shared with, so it is announced like one: a toast naming who gained (or
   * lost) the profile, with an **Undo** — the same safety the Sharing dialog
   * gives the same act. An unshared folder is only a label; its toggles stay
   * silent, because a toast per click there would only train people to ignore
   * the ones that matter.
   */
  const setMembership = async (
    profile: FolderProfile,
    folder: ManagedFolder,
    action: 'add' | 'remove',
    { undoable = true } = {},
  ) => {
    if (pending.has(profile.id)) return;
    const folderId = folder.id;
    setPending((prev) => new Set(prev).add(profile.id));
    setFolders((prev) =>
      prev.map((f) =>
        f.id !== folderId
          ? f
          : {
              ...f,
              profileIds:
                action === 'add' ? [...f.profileIds, profile.id] : f.profileIds.filter((id) => id !== profile.id),
            },
      ),
    );
    try {
      await authFetch('/api/gologin/manage/folders', {
        method: 'PATCH',
        body: JSON.stringify({ folderId, profileIds: [profile.id], action }),
      });
      dirtyRef.current = true;
      const people = folder.sharedWith ?? [];
      if (people.length) {
        const name = profile.name || 'the profile';
        toast.success(
          action === 'add'
            ? `${namesSentence(people)} can now open ${name}.`
            : `${namesSentence(people)} can no longer open ${name} through ${folder.name}.`,
          {
            duration: 8_000,
            action: undoable
              ? {
                  label: 'Undo',
                  onClick: () =>
                    void setMembership(profile, folder, action === 'add' ? 'remove' : 'add', { undoable: false }),
                }
              : undefined,
          },
        );
      }
    } catch (err) {
      // Re-read rather than invert: after a failed write the truth is GoLogin's.
      toast.error(err instanceof Error ? err.message : 'That change did not save.');
      // Folders only — the profile list does not change when membership does.
      void reload(true);
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

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex h-[min(80vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-white/[0.07] px-6 pb-4 pt-5 text-left">
          <DialogTitle className="text-lg font-semibold text-white">Folders</DialogTitle>
          <DialogDescription className="text-[11px] text-zinc-400">
            Create and delete folders, and choose which profiles each holds. To rename a folder, use
            GoLogin&rsquo;s own app — GoLogin offers no way to do it from here.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex flex-1 flex-col items-start gap-2 p-6">
            <p className="text-sm text-zinc-400">{error}</p>
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : loading ? (
          <div className="flex min-h-0 flex-1" role="status" aria-label="Loading folders">
            <div className="w-64 shrink-0 space-y-3 border-r border-white/[0.07] p-4">
              <Skeleton className="h-9 w-full rounded-md" />
              {['w-28', 'w-36', 'w-24', 'w-32'].map((w, i) => (
                <Skeleton key={i} className={`h-4 ${w} rounded`} />
              ))}
            </div>
            <div className="min-w-0 flex-1 space-y-3 p-5">
              <Skeleton className="h-9 w-full rounded-md" />
              {['w-44', 'w-32', 'w-52', 'w-36'].map((w, i) => (
                <Skeleton key={i} className={`h-4 ${w} rounded`} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* Folders */}
            <div className="flex w-64 shrink-0 flex-col border-r border-white/[0.07]">
              <form
                className="flex shrink-0 gap-1.5 border-b border-white/[0.07] p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New folder name"
                  aria-label="New folder name"
                  maxLength={60}
                  className={`h-8 text-xs ${FIELD}`}
                />
                <Button
                  type="submit"
                  size="icon-sm"
                  className={`${PRIMARY_BUTTON} size-8 shrink-0`}
                  disabled={!newName.trim() || creating}
                  aria-label="Create folder"
                >
                  {creating ? (
                    <Loader2 className="activity-spinner size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="size-3.5" aria-hidden />
                  )}
                </Button>
              </form>
              <ul className="min-h-0 flex-1 overflow-y-auto py-1">
                {folders.length === 0 && (
                  <li className="px-4 py-3 text-sm text-zinc-400">No folders yet. Name one above.</li>
                )}
                {folders.map((folder) => {
                  const active = selected?.id === folder.id;
                  return (
                    <li key={folder.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => setSelectedId(folder.id)}
                        aria-current={active}
                        className={`flex w-full items-center justify-between gap-2 py-2 pl-4 pr-10 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 ${
                          active ? 'bg-[#3b82f6]/15' : 'hover:bg-white/[0.055]'
                        }`}
                      >
                        <span className={`truncate text-sm ${active ? 'font-semibold text-white' : 'font-medium text-zinc-300'}`}>
                          {folder.name}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                          {folder.profileIds.length}
                        </span>
                      </button>
                      {/* Revealed on hover and on focus-within (DESIGN.md §5),
                          and always on the selected row. */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={`absolute right-1.5 top-1/2 size-7 -translate-y-1/2 text-zinc-400 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 ${
                          active ? 'opacity-100' : 'opacity-0'
                        }`}
                        aria-label={`Delete ${folder.name}`}
                        onClick={() => setConfirmDelete(folder)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Profiles in the selected folder */}
            <div className="flex min-w-0 flex-1 flex-col">
              {selected ? (
                <>
                  <div className="shrink-0 border-b border-white/[0.07] px-5 py-3">
                    <p className="truncate text-sm text-zinc-400">
                      Profiles in <span className="font-semibold text-white">{selected.name}</span>
                      {' · '}
                      <span className="tabular-nums">{selected.profileIds.length}</span>
                    </p>
                    {/* Said before the first click, because every "Add" below is
                        also a grant: the folder is shared live, so its people
                        get whatever lands in it. */}
                    <p
                      className={`mb-2 mt-0.5 flex items-center gap-1.5 text-[11px] ${
                        selected.sharedWith?.length ? 'text-orange-400' : 'text-zinc-400'
                      }`}
                    >
                      <Users className="size-3.5 shrink-0" aria-hidden />
                      {selected.sharedWith?.length
                        ? `Shared with ${namesSentence(selected.sharedWith)} — anything you add, they can open.`
                        : 'Not shared with anyone — adding a profile here gives nobody new access.'}
                    </p>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search profiles"
                        aria-label="Search profiles"
                        className={`pl-9 ${FIELD}`}
                      />
                    </div>
                    {truncated && (
                      <p className="mt-2 text-[11px] text-zinc-400">
                        Showing the first {allProfiles.length} profiles in the workspace.
                      </p>
                    )}
                  </div>
                  <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
                    {profiles.length === 0 ? (
                      <li className="p-4 text-sm text-zinc-400">
                        {query.trim() ? (
                          <>
                            Nothing matches that search.{' '}
                            <button type="button" onClick={() => setQuery('')} className="underline underline-offset-2 hover:text-white">
                              Clear it
                            </button>
                          </>
                        ) : (
                          'There are no profiles in this workspace yet.'
                        )}
                      </li>
                    ) : (
                      profiles.map((profile) => {
                        const on = members.has(profile.id);
                        const busy = pending.has(profile.id);
                        return (
                          <li key={profile.id}>
                            <button
                              type="button"
                              onClick={() => void setMembership(profile, selected, on ? 'remove' : 'add')}
                              disabled={busy}
                              aria-pressed={on}
                              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 disabled:opacity-60"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-white">{profile.name || 'Untitled profile'}</span>
                                <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                                  <OsIcon os={profile.os} osSpec={profile.osSpec} />
                                  <span className="font-mono">{profile.id.slice(-6)}</span>
                                </span>
                              </span>
                              {busy ? (
                                <Loader2 className="activity-spinner size-4 shrink-0 animate-spin text-blue-400" aria-hidden />
                              ) : on ? (
                                <span className="shrink-0 rounded-full bg-[#2563eb] px-2 py-0.5 text-[11px] font-medium text-white">
                                  In folder
                                </span>
                              ) : (
                                <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                                  Add
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </>
              ) : (
                <p className="p-6 text-sm text-zinc-400">Create a folder to start filling it.</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>

      <AlertDialog open={!!confirmDelete} onOpenChange={(next) => !next && !deleting && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The folder is removed from GoLogin.{' '}
              {confirmDelete?.profileIds.length === 1
                ? 'Its one profile is kept — it just leaves the folder.'
                : `Its ${plural(confirmDelete?.profileIds.length ?? 0, 'profile')} are kept — they just leave the folder.`}{' '}
              {confirmDelete?.sharedWith?.length
                ? `${namesSentence(confirmDelete.sharedWith)} ${confirmDelete.sharedWith.length === 1 ? 'loses' : 'lose'} the access it gave them; profiles shared with them individually are unaffected.`
                : 'It is not shared with anyone, so nobody loses access.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={DANGER_BUTTON}
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) void remove(confirmDelete);
              }}
            >
              {deleting && <Loader2 className="activity-spinner size-3.5 animate-spin" aria-hidden />}
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
