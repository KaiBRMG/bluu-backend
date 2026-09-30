'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { GoLoginProfile } from '@/lib/gologin/types';
import { PRIMARY_BUTTON } from '../_lib/manage';
import { useManagedFolders } from '../_lib/useManagedFolders';
import FolderChecklist from './FolderChecklist';

/**
 * Add to Folder — the small card behind a row's menu item.
 *
 * Opens with the profile's current folders already ticked, so it both adds and
 * removes: a checklist that could only add would leave "take it out of REPOST"
 * with no home. Only user-facing folders are offered; Bluu's per-person folders
 * never are (they decide who can *see* a profile, which is Sharing's job).
 *
 * One `PUT` to the folders route — gated on the folder capability alone, which
 * is the one that owns folder membership.
 */
export default function AddToFolderDialog({
  profile,
  onOpenChange,
  onSaved,
}: {
  profile: GoLoginProfile | null;
  onOpenChange: (open: boolean) => void;
  /** The profile's user-facing folder names after the change. */
  onSaved: (profileId: string, folderNames: string[]) => void;
}) {
  const authFetch = useAuthFetch();
  const open = !!profile;
  const folders = useManagedFolders(open);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  /** What the profile is in now, by id — derived from the folder tree. */
  const initial = useMemo(() => {
    if (!profile) return new Set<string>();
    return new Set(folders.folders.filter((f) => f.profileIds.includes(profile.id)).map((f) => f.id));
  }, [folders.folders, profile]);

  // The selection is the reader's edits over `initial`; until they touch a box
  // it simply *is* `initial`, so a late-arriving folder list needs no effect.
  const selected = picked ?? initial;
  const changed = selected.size !== initial.size || [...selected].some((id) => !initial.has(id));

  const close = () => {
    setPicked(null);
    onOpenChange(false);
  };

  /**
   * One request: the server diffs against a fresh read and applies each change
   * (`setProfileFolders`), and answers with the folders the profile ended up in.
   */
  const save = async () => {
    if (!profile || !changed || saving) return;
    setSaving(true);
    try {
      const result: { folders: string[] } = await authFetch('/api/gologin/manage/folders', {
        method: 'PUT',
        body: JSON.stringify({ profileId: profile.id, folderIds: [...selected] }),
      });
      onSaved(profile.id, result.folders);
      toast.success(`Updated folders for ${profile.name || 'the profile'}.`);
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the folders.');
      // Some changes may have landed before the failure; re-read the truth.
      void folders.reload(true);
      setPicked(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && (next ? onOpenChange(true) : close())}>
      <DialogContent className="gap-0 p-0 sm:max-w-sm">
        <DialogHeader className="border-b border-white/[0.07] px-5 pb-3 pt-4 text-left">
          <DialogTitle className="truncate pr-6 text-base font-semibold text-white">
            Folders for {profile?.name || 'this profile'}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-zinc-400">
            A profile can sit in several folders at once.
          </DialogDescription>
        </DialogHeader>
        <div className="px-3 py-2">
          <FolderChecklist
            folders={folders.folders}
            loading={folders.loading}
            error={folders.error}
            selected={selected}
            initial={initial}
            onChange={setPicked}
          />
        </div>
        <DialogFooter className="border-t border-white/[0.07] px-5 py-3">
          <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" className={PRIMARY_BUTTON} disabled={!changed || saving} onClick={save}>
            {saving && <Loader2 className="activity-spinner size-3.5 animate-spin" aria-hidden />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
