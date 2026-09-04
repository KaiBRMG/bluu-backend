'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitCompare,
  Link2,
  Link2Off,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { usePromptLibrary } from '@/contexts/PromptLibraryContext';
import { useUserData } from '@/hooks/useUserData';
import { useUserName } from '@/hooks/useUserName';
import { resolveUserName } from '@/components/DeletedUser';
import { hasRichFormatting, htmlToPlainText, promptBodyHtml } from '@/lib/promptHtml';
import { MAX_EDIT_NOTE_LENGTH, type PromptVersion } from '@/types/promptLibrary';
import { LlmMarks } from './LlmMark';
import { DiffLegend, DiffView } from './DiffView';
import { EditMetaDialog } from './EditMetaDialog';
import { RichPromptEditor, type RichPromptEditorHandle } from './RichPromptEditor';
import { absoluteDateTime, relativeTime, wordCount } from '../_lib/format';

/**
 * The prompt detail card, as a modal over whatever surface opened it.
 *
 * It used to be its own route. Making it a dialog keeps the library — the board,
 * the model strip, the search box — visible behind it, so opening a prompt reads
 * as inspecting a card rather than as leaving the page.
 */
export function PromptDetailDialog({
  promptId,
  onOpenChange,
}: {
  promptId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  /**
   * The draft lives in the body, but Escape and the overlay are handled by the
   * Dialog. The body registers a guard here so all three exits — Escape, a click
   * outside, and the Close button — route through the same confirmation, rather
   * than two of them silently discarding an unsaved version.
   */
  const guard = useRef<(() => boolean) | null>(null);
  const allowClose = () => (guard.current ? guard.current() : true);
  const registerGuard = useCallback((fn: (() => boolean) | null) => {
    guard.current = fn;
  }, []);

  return (
    <Dialog
      open={promptId !== null}
      onOpenChange={next => {
        if (!next && !allowClose()) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={e => {
          if (!allowClose()) e.preventDefault();
        }}
        onInteractOutside={e => {
          if (!allowClose()) e.preventDefault();
        }}
        className="flex max-h-[92vh] w-[min(72rem,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        {/* Remounted per prompt, so every open starts from a clean draft and no
            effect has to re-sync the editor between two different prompts. */}
        {promptId && (
          <PromptDetailBody
            key={promptId}
            promptId={promptId}
            onClose={() => onOpenChange(false)}
            registerGuard={registerGuard}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PromptDetailBody({
  promptId,
  onClose,
  registerGuard,
}: {
  promptId: string;
  onClose: () => void;
  registerGuard: (fn: (() => boolean) | null) => void;
}) {
  const {
    prompts,
    loading,
    refresh,
    getVersions,
    saveVersion,
    overwriteVersion,
    updateMeta,
    removePrompt,
    shareLink,
    revokeShare,
  } = usePromptLibrary();
  const { names } = useUserName();
  const { userData } = useUserData();

  const prompt = useMemo(() => prompts.find(p => p.id === promptId) ?? null, [prompts, promptId]);

  const [versions, setVersions] = useState<PromptVersion[] | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [draftHtml, setDraftHtml] = useState('');
  /** What the editor settled on for `baseline.version`; the dirty comparison. */
  const [baseline, setBaseline] = useState<{ version: number | null; html: string }>({
    version: null,
    html: '',
  });
  const [editNote, setEditNote] = useState('');
  /**
   * Which save is in flight, not merely whether one is. Both buttons sit side
   * by side, so a shared boolean put "Saving…" on both of them and left the
   * author unable to tell which act they had actually asked for.
   */
  const [savingKind, setSavingKind] = useState<'new' | 'current' | null>(null);
  const saving = savingKind !== null;
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  const [pendingClose, setPendingClose] = useState(false);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);

  const editorRef = useRef<RichPromptEditorHandle>(null);
  // The note field is pre-filled with the version's stored note exactly once per
  // card. Latched, because the history effect can re-run and must not overwrite
  // what the author has typed since — including a note they deliberately
  // cleared, which `editNote || stored` alone would silently refill.
  const noteSeeded = useRef(false);
  // Read inside the editor's change handler, which is created before `viewing`
  // has settled on its first value.
  const viewingRef = useRef<number | null>(null);
  viewingRef.current = viewing;

  // Client-side admin guess: it only decides whether the destructive item is
  // rendered. The route itself requires the admin claim.
  const isAdmin = userData?.groups?.includes('admin') === true;

  const headVersion = prompt?.version ?? null;

  // History is fetched only when a detail card opens, then memoised for the session.
  useEffect(() => {
    let cancelled = false;
    getVersions(promptId)
      .then(list => {
        if (cancelled) return;
        setVersions(list);
        const initial = list[0]?.version ?? headVersion;
        setViewing(current => current ?? initial);
        // The note box opens on the note this version already carries, so an
        // edit revises the record rather than starting from a blank field and
        // quietly replacing it with nothing.
        if (!noteSeeded.current) {
          noteSeeded.current = true;
          setEditNote(list.find(v => v.version === initial)?.editNote ?? '');
        }
      })
      .catch(err => toast.error(err instanceof Error ? err.message : 'Failed to load history'));
    return () => {
      cancelled = true;
    };
  }, [promptId, headVersion, getVersions]);

  const current = useMemo(
    () => versions?.find(v => v.version === viewing) ?? null,
    [versions, viewing]
  );

  const handleEditorChange = useCallback((html: string) => {
    setDraftHtml(html);
    // The FIRST value the editor publishes for a version is that version's
    // unchanged form — see the seed note in RichPromptEditor.
    setBaseline(b => (b.version === viewingRef.current ? b : { version: viewingRef.current, html }));
  }, []);

  const draftText = useMemo(() => htmlToPlainText(draftHtml), [draftHtml]);
  const dirty =
    current !== null && baseline.version === current.version && draftHtml !== baseline.html;
  /** The note alone can be edited — that is a change worth saving, but only to
   *  the version it belongs to; a new version of unchanged text is not one. */
  const noteDirty = current !== null && editNote.trim() !== current.editNote;
  const unsaved = dirty || noteDirty;

  const isLatest = versions !== null && viewing === versions[0]?.version;
  const index = versions?.findIndex(v => v.version === viewing) ?? -1;
  const older = index >= 0 && versions ? versions[index + 1] : undefined;
  const newer = index > 0 && versions ? versions[index - 1] : undefined;

  const basis = useMemo(
    () =>
      current?.basedOn != null ? (versions?.find(v => v.version === current.basedOn) ?? null) : null,
    [current, versions]
  );

  /**
   * Puts a version on screen, unconditionally.
   *
   * The editor owns its own DOM while you type, so this pushes the body in
   * imperatively. `viewingRef` is advanced FIRST because the editor echoes the
   * new body back synchronously, and that echo is what becomes the version's
   * "unchanged" baseline — attribute it to the old version and every subsequent
   * keystroke would read as clean.
   */
  const switchTo = useCallback(
    (version: number) => {
      const target = versions?.find(v => v.version === version);
      setShowDiff(false);
      setViewing(version);
      viewingRef.current = version;
      setBaseline({ version: null, html: '' });
      // The note follows the version, both on a switch and on a revert: it is
      // that version's note, not a scratch field that survives the move.
      setEditNote(target?.editNote ?? '');
      if (target) editorRef.current?.setHtml(promptBodyHtml(target.text, target.textHtml));
    },
    [versions]
  );

  const goToVersion = useCallback(
    (version: number) => {
      if (unsaved) {
        setPendingVersion(version);
        return;
      }
      switchTo(version);
    },
    [unsaved, switchTo]
  );

  const handleSave = useCallback(async () => {
    if (!prompt || !current || !dirty || saving) return;
    setSavingKind('new');
    try {
      const { version } = await saveVersion(prompt.id, {
        text: draftText,
        // Plain prompts stay plain in Firestore — `textHtml` is only written
        // once someone actually applies a mark.
        textHtml: hasRichFormatting(draftHtml) ? draftHtml : null,
        editNote: editNote.trim(),
        basedOn: current.version,
      });
      setVersions(prev => (prev ? [version, ...prev] : [version]));
      setShowDiff(false);
      setViewing(version.version);
      viewingRef.current = version.version;
      setBaseline({ version: null, html: '' });
      setEditNote(version.editNote);
      editorRef.current?.setHtml(promptBodyHtml(version.text, version.textHtml));
      toast.success(`Saved as v${version.version}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingKind(null);
    }
  }, [prompt, current, dirty, draftText, draftHtml, editNote, saving, saveVersion]);

  /**
   * Writes the edit back into the version on screen instead of cutting a new
   * one — the correction path, for a typo or a better-worded note.
   *
   * It replaces that version's note rather than adding to it, which is why the
   * field is pre-filled: an author edits the note that is there, and a save is
   * never a silent deletion of one.
   */
  const handleSaveCurrent = useCallback(async () => {
    if (!prompt || !current || !(dirty || noteDirty) || saving) return;
    setSavingKind('current');
    try {
      const { version } = await overwriteVersion(prompt.id, {
        text: draftText,
        textHtml: hasRichFormatting(draftHtml) ? draftHtml : null,
        editNote: editNote.trim(),
        version: current.version,
      });
      setVersions(prev =>
        prev ? prev.map(v => (v.version === version.version ? version : v)) : [version]
      );
      setShowDiff(false);
      // The version did not move, so only the baseline has to be re-taken —
      // the editor is already showing exactly what was just stored.
      setBaseline({ version: null, html: '' });
      setEditNote(version.editNote);
      editorRef.current?.setHtml(promptBodyHtml(version.text, version.textHtml));
      toast.success(`v${version.version} updated`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingKind(null);
    }
  }, [
    prompt,
    current,
    dirty,
    noteDirty,
    draftText,
    draftHtml,
    editNote,
    saving,
    overwriteVersion,
  ]);

  // Any modal that is currently covering the editor. The shortcut below is bound
  // to the window, so without this it would cut a version behind an open dialog.
  const blocked = editingMeta || confirmDelete || pendingVersion !== null || pendingClose;

  // Ctrl/Cmd+S is the reflex for a text editor; honouring it stops the browser
  // save dialog from stealing the keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (blocked) return;
        // Ctrl+S keeps its meaning — a new version — while there is new text to
        // put in one. With only the note touched there is no new version to
        // cut, so it saves the note where it belongs: on this version.
        void (dirty ? handleSave() : handleSaveCurrent());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, handleSaveCurrent, dirty, blocked]);

  // Unsaved text is only in this component; warn before the tab takes it away.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const requestClose = useCallback(() => {
    if (unsaved) {
      setPendingClose(true);
      return;
    }
    onClose();
  }, [unsaved, onClose]);

  // Escape and the overlay are the Dialog's to handle, so it needs to know
  // whether closing is currently safe.
  useEffect(() => {
    registerGuard(() => {
      if (!unsaved) return true;
      setPendingClose(true);
      return false;
    });
    return () => registerGuard(null);
  }, [unsaved, registerGuard]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draftText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  /**
   * Copies the prompt's public link, minting one on first use.
   *
   * The clipboard write happens in the same user gesture wherever possible, but
   * minting needs a round trip — Chromium (this renderer, by construction)
   * still honours `writeText` after an await in a click handler, so the link is
   * written directly rather than through a pre-opened placeholder.
   */
  const copyLink = async () => {
    if (!prompt || sharing) return;
    setSharing(true);
    try {
      const url = await shareLink(prompt.id);
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
      toast.success('Share link copied', {
        description: prompt.shareId
          ? 'Anyone with this link can read the prompt.'
          : 'This prompt is now readable by anyone with the link.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not copy the share link');
    } finally {
      setSharing(false);
    }
  };

  const stopSharing = async () => {
    if (!prompt) return;
    try {
      await revokeShare(prompt.id);
      toast.success('Sharing stopped', {
        description: 'The old link no longer works. Sharing again creates a new one.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to withdraw the link');
    }
  };

  const toggleArchive = async () => {
    if (!prompt) return;
    try {
      await updateMeta(prompt.id, { isArchived: !prompt.isArchived });
      toast.success(prompt.isArchived ? 'Prompt restored' : 'Prompt archived');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update the prompt');
    }
  };

  /** Closes past the unsaved-changes guard, for the two paths that have already
   *  asked: an explicit discard, and a delete that took the draft with it. */
  const forceClose = useCallback(() => {
    registerGuard(null);
    onClose();
  }, [registerGuard, onClose]);

  const destroy = async () => {
    if (!prompt) return;
    try {
      await removePrompt(prompt.id);
      toast.success('Prompt deleted');
      forceClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete the prompt');
    }
  };

  if (!prompt) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <DialogHeader>
          <DialogTitle>{loading ? 'Loading…' : 'Prompt not found'}</DialogTitle>
          <DialogDescription>
            {loading
              ? 'Fetching the prompt library.'
              : 'It may have been deleted, or created since this library was last loaded.'}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" className="w-fit" onClick={refresh}>
              Reload the library
            </Button>
            <Button variant="ghost" className="w-fit" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    );
  }

  const noteOnScreen = current?.editNote?.trim() ?? '';

  return (
    <>
      {/* ── Identity ─────────────────────────────────────────────────── */}
      <DialogHeader className="gap-3 border-b border-white/[0.07] p-5 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-2xl font-bold tracking-tight text-white">
              {prompt.title}
            </DialogTitle>
            <DialogDescription asChild>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                <span className="text-zinc-300">{prompt.category}</span>
                <span aria-hidden>·</span>
                {/* Every model this prompt is for, not just the first. */}
                <LlmMarks llms={prompt.llmTypes} size={14} max={8} />
                {prompt.isArchived && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                      Archived
                    </span>
                  </>
                )}
                {/* A prompt readable by anyone holding a URL should say so on
                    its face, not only inside a menu. */}
                {prompt.shareId && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="rounded-full bg-[#3b82f6]/15 px-2 py-0.5 text-[11px] font-medium text-[#93c5fd]">
                      Shared link active
                    </span>
                  </>
                )}
              </p>
            </DialogDescription>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={copy}>
              {copied ? (
                <Check className="size-3.5 text-green-400" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>

            {/* Distinct from "Copy", which takes the TEXT. This takes a URL that
                opens a public read-only page — a different act with a different
                audience, so it gets its own control rather than a menu item. */}
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={copyLink}
              disabled={sharing}
            >
              {linkCopied ? (
                <Check className="size-3.5 text-green-400" aria-hidden />
              ) : (
                <Link2 className="size-3.5" aria-hidden />
              )}
              {linkCopied ? 'Link copied' : 'Copy link'}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Prompt actions">
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditingMeta(true)}>
                  <Pencil className="size-4" aria-hidden />
                  Edit details
                </DropdownMenuItem>
                {prompt.shareId && (
                  <DropdownMenuItem onSelect={stopSharing}>
                    <Link2Off className="size-4" aria-hidden />
                    Stop sharing
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={toggleArchive}>
                  {prompt.isArchived ? (
                    <ArchiveRestore className="size-4" aria-hidden />
                  ) : (
                    <Archive className="size-4" aria-hidden />
                  )}
                  {prompt.isArchived ? 'Restore' : 'Archive'}
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 className="size-4" aria-hidden />
                      Delete permanently
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="ghost" size="sm" className="h-8" onClick={requestClose}>
              Close
            </Button>
          </div>
        </div>

        {prompt.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {prompt.tags.map(tag => (
              <li key={tag} className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs text-zinc-300">
                {tag}
              </li>
            ))}
          </ul>
        )}

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-zinc-400">
          <div className="flex gap-1.5">
            <dt>Created</dt>
            <dd className="text-zinc-300">
              {absoluteDateTime(prompt.createdTime)} by {resolveUserName(prompt.createdBy, names)}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Updated</dt>
            <dd className="text-zinc-300">
              {relativeTime(prompt.lastUpdatedTime)} by {resolveUserName(prompt.lastUpdatedBy, names)}
            </dd>
          </div>
        </dl>
      </DialogHeader>

      {/* ── Version rail ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-white/[0.07] px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!older}
              onClick={() => older && goToVersion(older.version)}
              aria-label="Older version"
            >
              <ChevronLeft className="size-3.5" aria-hidden />
            </Button>
            <span className="min-w-16 text-center text-xs font-semibold tabular-nums text-zinc-200">
              {viewing ? `v${viewing}` : '—'}
              <span className="font-normal text-zinc-400">
                {versions ? ` of ${versions.length}` : ''}
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!newer}
              onClick={() => newer && goToVersion(newer.version)}
              aria-label="Newer version"
            >
              <ChevronRight className="size-3.5" aria-hidden />
            </Button>
          </div>

          {isLatest ? (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-zinc-300">
              Latest
            </span>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              className="text-zinc-400"
              onClick={() => versions && goToVersion(versions[0].version)}
            >
              Jump to latest
            </Button>
          )}

          <span className="text-xs text-zinc-400">
            {current?.basedOn != null ? `Edited from v${current.basedOn}` : 'First version'}
          </span>

          {/* The editor portals its formatting toolbar in here, so the marks sit
              with the other controls rather than hovering over the text. A state
              ref, not a plain one: the editor needs a re-render once the node
              exists, and a ref alone would not cause one. */}
          <div ref={setToolbarHost} className="flex items-center" />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-zinc-400">{wordCount(draftText)} words</span>
          {basis && (
            <>
              {/* `aria-disabled` rather than `disabled`: the reason it is
                  unavailable is attached to the control, and a `disabled`
                  button is neither focusable nor reliably hoverable, so the
                  explanation would be unreachable by keyboard and touch. */}
              <Button
                variant={showDiff ? 'secondary' : 'ghost'}
                size="xs"
                aria-pressed={showDiff}
                aria-disabled={dirty}
                aria-describedby={dirty ? 'diff-unavailable' : undefined}
                title={dirty ? 'Save or revert your edits to compare versions' : undefined}
                // De-emphasised with the one legal step, not with `opacity`:
                // stacking transparency on already-muted ink is what pushes
                // text under the contrast floor.
                className={dirty ? 'text-zinc-400' : undefined}
                onClick={() => {
                  if (dirty) return;
                  setShowDiff(v => !v);
                }}
              >
                <GitCompare className="size-3" aria-hidden />
                {showDiff ? 'Hide changes' : 'Show changes'}
              </Button>
              {dirty && (
                <span id="diff-unavailable" className="sr-only">
                  Unavailable while you have unsaved edits. Save or revert them to compare versions.
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {/* The version's own note, above the text it explains. Full width and
            free to wrap, because these are sentences rather than a stat line. */}
        {noteOnScreen && !showDiff && (
          <section
            aria-label={`Edit note for version ${current?.version}`}
            className="flex gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3.5 py-3"
          >
            <NotebookPen className="mt-0.5 size-3.5 shrink-0 text-zinc-400" aria-hidden />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                Edit note · v{current?.version}
              </p>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
                {noteOnScreen}
              </p>
            </div>
          </section>
        )}

        {versions === null ? (
          <Skeleton className="h-[26rem] rounded-lg" />
        ) : showDiff && basis && current ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-400">
                Comparing <span className="tabular-nums text-zinc-300">v{basis.version}</span> →{' '}
                <span className="tabular-nums text-zinc-300">v{current.version}</span>
              </p>
              <DiffLegend />
            </div>
            <div className="max-h-[34rem] overflow-y-auto rounded-lg border border-white/[0.07] bg-white/[0.025]">
              <DiffView before={basis.text} after={current.text} />
            </div>
          </div>
        ) : (
          current && (
            <RichPromptEditor
              id="prompt-body"
              ref={editorRef}
              ariaLabel={`Prompt text, version ${current.version}`}
              initialHtml={promptBodyHtml(current.text, current.textHtml)}
              onChange={handleEditorChange}
              toolbarHost={toolbarHost}
            />
          )
        )}
      </div>

      {/* The save bar mounts silently, changes the card's height and shifts the
          editor under the caret — so the fact that the document went dirty is
          announced here instead. Mounted for the card's whole life, not with
          its first message: a live region that arrives together with its own
          text is commonly not announced at all. */}
      <p aria-live="polite" className="sr-only">
        {unsaved ? 'Unsaved changes. A save bar is available below the prompt text.' : ''}
      </p>

      {/* ── Save bar. Present only when there is something to save — which is
          also the only time the note field exists: an always-present note box
          would read as required on a card that is mostly opened to read. ── */}
      {unsaved && (
        <footer className="flex flex-col gap-2 border-t border-white/[0.07] px-5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="inline-block size-2 rounded-full bg-orange-400" aria-hidden />
              Unsaved changes
              {/* What changed, in three words. The buttons below name the
                  versions, so repeating them here only doubles the reading. */}
              <span className="text-zinc-400">
                {dirty ? '— the prompt text' : '— the edit note'}
              </span>
            </p>
            <span className="text-[11px] tabular-nums text-zinc-400">
              {editNote.length}/{MAX_EDIT_NOTE_LENGTH}
            </span>
          </div>

          {/* The note sits beside the button that consumes it, taking every
              pixel the buttons do not — it is prose, and prose needs the width. */}
          <div className="flex items-end gap-3">
            {/* A visible label, not an sr-only one: the placeholder used to be
                this field's only name for a sighted reader, which put the whole
                burden of naming it on text that vanishes the moment you type. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="prompt-edit-note" className="text-xs text-zinc-400">
                Edit note (optional)
                {/* Says which version's note is in the box, because it opens
                    pre-filled with one — without this, an author who does not
                    recognise the text cannot tell whether it is theirs to
                    change or something they are about to overwrite. */}
                {noteOnScreen && (
                  <span className="text-zinc-400"> — revising v{current?.version}’s note</span>
                )}
              </label>
              <Textarea
                id="prompt-edit-note"
                value={editNote}
                onChange={e => setEditNote(e.target.value.slice(0, MAX_EDIT_NOTE_LENGTH))}
                rows={2}
                placeholder="What changed, and why?"
                className="min-h-16 w-full resize-y rounded-lg border-white/[0.07] bg-white/[0.025] text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-400 focus-visible:border-zinc-500 focus-visible:ring-0"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => current && switchTo(current.version)}
                disabled={saving}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Revert
              </Button>
              {/* Two ways to keep the edit, and they are genuinely different
                  acts: one adds to the history, the other corrects it. The
                  destructive-of-history one is the secondary button. */}
              <Button
                variant={dirty ? 'outline' : 'default'}
                size="sm"
                onClick={handleSaveCurrent}
                disabled={saving}
              >
                <Save className="size-3.5" aria-hidden />
                {savingKind === 'current' ? 'Saving…' : `Save to v${current?.version}`}
              </Button>
              {/* Absent, not disabled, when only the note changed: a new
                  version of identical text is not a thing the server will cut
                  (it answers 409), so offering it would be offering a dead end.
                  With nothing to choose between, the remaining save takes the
                  primary role. */}
              {dirty && (
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {savingKind === 'new'
                    ? 'Saving…'
                    : `Save as v${(versions?.[0]?.version ?? prompt.version) + 1}`}
                </Button>
              )}
            </div>
          </div>
        </footer>
      )}

      <EditMetaDialog prompt={prompt} open={editingMeta} onOpenChange={setEditingMeta} />

      <AlertDialog
        open={pendingVersion !== null}
        onOpenChange={open => !open && setPendingVersion(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You’ve edited v{current?.version} without saving. Moving to another version will lose
              those edits — save first to keep them as a new version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingVersion !== null) switchTo(pendingVersion);
                setPendingVersion(null);
              }}
            >
              Discard and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingClose} onOpenChange={setPendingClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              You’ve edited v{current?.version} without saving. Closing this prompt will lose those
              edits — save first to keep them as a new version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPendingClose(false);
                forceClose();
              }}
            >
              Discard and close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{prompt.title}” permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the prompt and all {versions?.length ?? prompt.versionCount} of its
              versions. Archiving hides it from the library and can be undone; this cannot.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={destroy}>Delete permanently</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
