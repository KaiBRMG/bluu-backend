'use client';

import { useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { namesSentence } from '@/lib/gologin/types';
import { CHECKBOX_ON, FIELD, type ManagedFolder } from '../_lib/manage';

/** Past this many folders the list grows a filter field. */
const FILTER_THRESHOLD = 8;

/**
 * A multi-select of the workspace's folders — New Profile, Edit Profile and
 * Add to Folder all pick folders the same way, so they share this rather than
 * three lists drifting apart.
 *
 * Only **user-facing** folders ever reach it: the routes strip Bluu's own
 * per-person folders server-side, by id as well as by name, so a renamed
 * plumbing folder cannot sneak back in as something to tick.
 *
 * Rows are real `<label>`s around a `Checkbox`, so the whole row is the target
 * and a screen reader announces "REPOST, checkbox, checked".
 */
export default function FolderChecklist({
  folders,
  selected,
  onChange,
  loading,
  error,
  disabled,
  maxHeightClass = 'max-h-56',
  initial,
}: {
  folders: ManagedFolder[];
  selected: ReadonlySet<string>;
  /** The next selection — the list does the toggling, so callers need not. */
  onChange: (next: Set<string>) => void;
  loading: boolean;
  error: string | null;
  disabled?: boolean;
  maxHeightClass?: string;
  /**
   * The folders the profile is in already. When given, the list names everyone
   * who **gains** the profile through a newly ticked folder — a shared folder is
   * live, so ticking it is a grant, and this is where that must be said.
   */
  initial?: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState('');
  /**
   * Who gains the profile through a newly ticked folder, and who loses the
   * access an unticked folder gave them. "Loses" is measured against the
   * folders still ticked — someone who still reaches it through another ticked
   * folder loses nothing. (A direct share survives either way; the copy says
   * "through these folders" for that reason.)
   */
  const { gaining, losing } = useMemo(() => {
    const gain = new Set<string>();
    const lose = new Set<string>();
    const kept = new Set<string>();
    const had = new Set<string>();
    for (const f of folders) {
      if (selected.has(f.id)) for (const n of f.sharedWith ?? []) kept.add(n);
      if (initial?.has(f.id)) for (const n of f.sharedWith ?? []) had.add(n);
    }
    for (const f of folders) {
      const now = selected.has(f.id);
      const was = initial?.has(f.id) ?? false;
      if (now && !was) for (const n of f.sharedWith ?? []) if (!had.has(n)) gain.add(n);
      if (!now && was) for (const n of f.sharedWith ?? []) if (!kept.has(n)) lose.add(n);
    }
    const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return { gaining: sort(gain), losing: sort(lose) };
  }, [folders, selected, initial]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? folders.filter((f) => f.name.toLowerCase().includes(needle)) : folders;
  }, [folders, query]);

  if (loading) {
    return (
      <div className="space-y-2 py-1" role="status" aria-label="Loading folders">
        {['w-24', 'w-32', 'w-20'].map((w, i) => (
          <div key={i} className="flex items-center gap-2 px-2">
            <Skeleton className="size-4 rounded-[4px]" />
            <Skeleton className={`h-3.5 ${w} rounded`} />
          </div>
        ))}
      </div>
    );
  }
  if (error) return <p className="py-1 text-[11px] text-red-400">{error}</p>;
  if (!folders.length) {
    return <p className="py-1 text-[11px] text-zinc-400">There are no folders yet.</p>;
  }

  return (
    <div>
      {folders.length > FILTER_THRESHOLD && (
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter folders"
            aria-label="Filter folders"
            className={`h-8 pl-8 text-xs ${FIELD}`}
          />
        </div>
      )}
      <ul className={`${maxHeightClass} overflow-y-auto overscroll-contain`}>
        {visible.map((folder) => {
          const on = selected.has(folder.id);
          return (
            <li key={folder.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-white/[0.055] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                <Checkbox
                  checked={on}
                  disabled={disabled}
                  onCheckedChange={(value) => {
                    const next = new Set(selected);
                    if (value === true) next.add(folder.id);
                    else next.delete(folder.id);
                    onChange(next);
                  }}
                  className={CHECKBOX_ON}
                />
                <span className={`min-w-0 flex-1 truncate ${on ? 'text-white' : 'text-zinc-300'}`}>
                  {folder.name}
                </span>
                {/* Who else can open everything in it. A plain count, with the
                    names on hover — the sentence under the list is what speaks
                    at the moment a tick would widen access. */}
                {!!folder.sharedWith?.length && (
                  <span
                    className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-400"
                    title={`Shared with ${folder.sharedWith.join(', ')}`}
                  >
                    <Users className="size-3" aria-hidden />
                    <span className="tabular-nums">{folder.sharedWith.length}</span>
                    <span className="sr-only">people can open this folder</span>
                  </span>
                )}
                <span className="shrink-0 text-[11px] tabular-nums text-zinc-400" title="Profiles in this folder">
                  {folder.profileIds.length}
                </span>
              </label>
            </li>
          );
        })}
        {!visible.length && (
          <li className="px-2 py-1.5 text-[11px] text-zinc-400">
            No folder matches.{' '}
            <button type="button" onClick={() => setQuery('')} className="underline underline-offset-2 hover:text-white">
              Clear the filter
            </button>
          </li>
        )}
      </ul>
      {/* Attention orange, not red: nothing is wrong — but this is the one
          line on the form that says who else gains a live, signed-in account. */}
      {gaining.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-orange-400" role="status">
          <Users className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {namesSentence(gaining)} will be able to open this profile — those folders are shared
            with them.
          </span>
        </p>
      )}
      {losing.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-orange-400" role="status">
          <Users className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {namesSentence(losing)} will no longer be able to open this profile through these folders.
          </span>
        </p>
      )}
    </div>
  );
}
