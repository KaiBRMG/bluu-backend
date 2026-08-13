'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitCompare,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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
import { describeChange } from '@/lib/promptDiff';
import { LLM_META, isLlmType, type PromptVersion } from '@/types/promptLibrary';
import { LlmMark } from '../../_components/LlmMark';
import { DiffLegend, DiffView } from '../../_components/DiffView';
import { EditMetaDialog } from '../../_components/EditMetaDialog';
import { absoluteDateTime, relativeTime, wordCount } from '../../_lib/format';

export default function PromptDetailPage() {
  const params = useParams<{ llm: string; id: string }>();
  const router = useRouter();
  const { prompts, loading, refresh, getVersions, saveVersion, updateMeta, removePrompt } =
    usePromptLibrary();
  const { names } = useUserName();
  const { userData } = useUserData();

  const id = params?.id ?? '';
  const prompt = useMemo(() => prompts.find(p => p.id === id) ?? null, [prompts, id]);

  const [versions, setVersions] = useState<PromptVersion[] | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Client-side admin guess: it only decides whether the destructive item is
  // rendered. The route itself requires the admin claim.
  const isAdmin = userData?.groups?.includes('admin') === true;

  // Keyed on the id, not the prompt object: the library array is re-created by
  // every unrelated mutation, and re-running this on each of those would ask the
  // cache a question it has already answered.
  const promptId = prompt?.id ?? null;
  const headVersion = prompt?.version ?? null;

  // History is fetched only when a detail card opens, then memoised for the session.
  useEffect(() => {
    if (!promptId) return;
    let cancelled = false;
    getVersions(promptId)
      .then(list => {
        if (cancelled) return;
        setVersions(list);
        setViewing(current => current ?? list[0]?.version ?? headVersion);
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

  // The draft follows whichever version is on screen, until the user types.
  useEffect(() => {
    if (current) setDraft(current.text);
  }, [current]);

  const dirty = current !== null && draft !== current.text;
  const isLatest = versions !== null && viewing === versions[0]?.version;
  const index = versions?.findIndex(v => v.version === viewing) ?? -1;
  const older = index >= 0 && versions ? versions[index + 1] : undefined;
  const newer = index > 0 && versions ? versions[index - 1] : undefined;

  const basis = useMemo(
    () =>
      current?.basedOn != null
        ? (versions?.find(v => v.version === current.basedOn) ?? null)
        : null,
    [current, versions]
  );

  const goToVersion = useCallback(
    (version: number) => {
      if (dirty) {
        setPendingVersion(version);
        return;
      }
      setShowDiff(false);
      setViewing(version);
    },
    [dirty]
  );

  const handleSave = useCallback(async () => {
    if (!prompt || !current || !dirty || saving) return;
    setSaving(true);
    try {
      const { version } = await saveVersion(prompt.id, draft, current.version);
      setVersions(prev => (prev ? [version, ...prev] : [version]));
      setViewing(version.version);
      setShowDiff(false);
      toast.success(`Saved as v${version.version}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [prompt, current, dirty, draft, saving, saveVersion]);

  // Any modal that is currently covering the editor. The shortcut below is bound
  // to the window, so without this it would cut a version behind an open dialog.
  const dialogOpen =
    editingMeta || confirmDelete || pendingVersion !== null || pendingHref !== null;

  // Ctrl/Cmd+S is the reflex for a text editor; honouring it stops the browser
  // save dialog from stealing the keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dialogOpen) return;
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, dialogOpen]);

  // Unsaved text is only in this component; warn before the tab takes it away.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not copy to the clipboard');
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

  const destroy = async () => {
    if (!prompt) return;
    try {
      await removePrompt(prompt.id);
      toast.success('Prompt deleted');
      router.replace(`/applications/apps-prompt-library/${prompt.llmType}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete the prompt');
    }
  };

  const backHref = isLlmType(params?.llm)
    ? `/applications/apps-prompt-library/${params.llm}`
    : '/applications/apps-prompt-library';

  if (loading && !prompt) {
    return (
      <AppLayout>
        <div className="flex max-w-5xl flex-col gap-4">
          <Skeleton className="h-8 w-64 rounded-lg" />
          <Skeleton className="h-[32rem] rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!prompt) {
    return (
      <AppLayout>
        <div className="flex max-w-5xl flex-col gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Prompt not found</h1>
          <p className="text-sm text-muted-foreground">
            It may have been deleted, or created since this library was last loaded.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="w-fit" onClick={refresh}>
              Reload the library
            </Button>
            <Button variant="ghost" className="w-fit" asChild>
              <Link href={backHref}>Back to the library</Link>
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const llm = LLM_META[prompt.llmType];
  const lineage =
    current?.basedOn != null
      ? `Edited from v${current.basedOn} · ${describeChange(current.change)}`
      : 'First version';

  return (
    <AppLayout>
      <div className="flex max-w-5xl flex-col gap-4">
        {/* Leaving the page is guarded exactly as switching versions is — the
            draft lives only in this component, so every exit asks first. */}
        <Link
          href={backHref}
          onClick={e => {
            if (!dirty) return;
            e.preventDefault();
            setPendingHref(backHref);
          }}
          className="-ml-1 inline-flex w-fit items-center gap-1 rounded-md py-1 pl-1 pr-2 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          {llm.name}
        </Link>

        <article className="flex flex-col rounded-xl border border-white/[0.07] bg-content-bg">
          {/* ── Identity ─────────────────────────────────────────────── */}
          <header className="flex flex-col gap-3 border-b border-white/[0.07] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-white">{prompt.title}</h1>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                  <span className="inline-flex items-center gap-1.5">
                    <LlmMark llm={prompt.llmType} size={13} />
                    {llm.name}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="text-zinc-300">{prompt.category}</span>
                  {prompt.isArchived && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                        Archived
                      </span>
                    </>
                  )}
                </p>
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
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setConfirmDelete(true)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                          Delete permanently
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {prompt.tags.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {prompt.tags.map(tag => (
                  <li
                    key={tag}
                    className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs text-zinc-300"
                  >
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
                  {relativeTime(prompt.lastUpdatedTime)} by{' '}
                  {resolveUserName(prompt.lastUpdatedBy, names)}
                </dd>
              </div>
            </dl>
          </header>

          {/* ── Version rail ─────────────────────────────────────────── */}
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
            </div>

            <p className="min-w-0 flex-1 truncate text-xs text-zinc-400" title={lineage}>
              {lineage}
            </p>

            <div className="flex items-center gap-2">
              <span className="text-[11px] tabular-nums text-zinc-400">
                {wordCount(draft)} words
              </span>
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
                    className={dirty ? 'opacity-50' : undefined}
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
                      Unavailable while you have unsaved edits. Save or revert them to compare
                      versions.
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── The prompt itself ───────────────────────────────────── */}
          <div className="p-5">
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
              <div className="flex flex-col gap-2">
                <label htmlFor="prompt-body" className="sr-only">
                  Prompt text, version {viewing}
                </label>
                <Textarea
                  id="prompt-body"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  spellCheck={false}
                  className="min-h-[26rem] resize-y whitespace-pre-wrap rounded-lg border-white/[0.07] bg-white/[0.025] p-4 font-mono text-sm leading-relaxed text-zinc-100 focus-visible:border-zinc-500 focus-visible:ring-0"
                />
              </div>
            )}
          </div>

          {/* ── Save bar. Present only when there is something to save. ── */}
          {dirty && (
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-3">
              <p className="flex items-center gap-2 text-xs text-zinc-300">
                <span className="inline-block size-2 rounded-full bg-orange-400" aria-hidden />
                Unsaved changes
                <span className="text-zinc-400">
                  — saving creates v{(versions?.[0]?.version ?? prompt.version) + 1} from v
                  {current?.version}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => current && setDraft(current.text)}
                  disabled={saving}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Revert
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save as new version'}
                </Button>
              </div>
            </footer>
          )}
        </article>
      </div>

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
                if (pendingVersion !== null) {
                  setShowDiff(false);
                  setViewing(pendingVersion);
                  setPendingVersion(null);
                }
              }}
            >
              Discard and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingHref !== null} onOpenChange={open => !open && setPendingHref(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              You’ve edited v{current?.version} without saving. Leaving this prompt will lose those
              edits — save first to keep them as a new version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingHref) router.push(pendingHref);
                setPendingHref(null);
              }}
            >
              Discard and leave
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
    </AppLayout>
  );
}
