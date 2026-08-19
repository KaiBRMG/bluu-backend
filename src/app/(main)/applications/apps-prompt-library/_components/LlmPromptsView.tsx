'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { usePromptLibrary } from '@/contexts/PromptLibraryContext';
import type { LlmType } from '@/types/promptLibrary';
import { LlmMark } from './LlmMark';
import { PromptSearch } from './PromptSearch';
import { NewPromptDialog } from './NewPromptDialog';
import { PromptDetailDialog } from './PromptDetailDialog';
import { PromptKanban } from './PromptKanban';
import { pluralise } from '../_lib/format';

/**
 * One model's prompts.
 *
 * Shared by `/[llm]` and the legacy `/[llm]/[id]` deep link — the latter passes
 * `initialPromptId` so an old bookmark still lands on the prompt, now as a card
 * over this page rather than a page of its own.
 */
export function LlmPromptsView({
  slug,
  initialPromptId,
}: {
  slug: LlmType;
  initialPromptId?: string;
}) {
  const { prompts, models, modelsById, loading, error } = usePromptLibrary();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [openPromptId, setOpenPromptId] = useState<string | null>(initialPromptId ?? null);

  const llm = modelsById[slug];

  // The library arrives after the first paint, so a model coined by a teammate
  // is unknown on mount and known a moment later.
  const known = loading || models.length === 0 || Boolean(llm);

  const mine = useMemo(() => prompts.filter(p => p.llmTypes.includes(slug)), [prompts, slug]);
  const visible = useMemo(
    () => mine.filter(p => showArchived || !p.isArchived),
    [mine, showArchived]
  );
  const archivedCount = useMemo(() => mine.filter(p => p.isArchived).length, [mine]);
  const categoryCount = useMemo(
    () => new Set(visible.map(p => p.category || 'Uncategorised')).size,
    [visible]
  );

  // A deep link naming a prompt that has since been deleted is not closed
  // silently — the dialog says so and offers a reload, which is the answer a
  // stale bookmark actually needs.

  return (
    <AppLayout>
      <div className="flex max-w-5xl flex-col gap-6">
        <Link
          href="/applications/apps-prompt-library"
          className="-ml-1 inline-flex w-fit items-center gap-1 rounded-md py-1 pl-1 pr-2 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          Prompt Library
        </Link>

        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LlmMark llm={slug} size={36} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{llm?.name ?? slug}</h1>
              <p className="text-sm text-zinc-400">
                {loading ? (
                  'Loading…'
                ) : (
                  <span className="tabular-nums">
                    {pluralise(visible.length, 'prompt')} in{' '}
                    {pluralise(categoryCount, 'category', 'categories')}
                  </span>
                )}
              </p>
            </div>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            New prompt
          </Button>
        </header>

        {!known && (
          <p className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-sm text-zinc-400">
            No model type called “{slug}” is registered. Any prompts already on it are still listed
            below.
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <PromptSearch scope={slug} onOpen={setOpenPromptId} />

        {loading ? (
          <div className="columns-1 [column-gap:0.75rem] sm:columns-2 lg:columns-3">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="mb-3 h-40 rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No {llm?.name ?? slug} prompts yet. Create the first one.
          </p>
        ) : (
          <section aria-labelledby="categories-heading">
            <h2 id="categories-heading" className="sr-only">
              {llm?.name ?? slug} prompts by category
            </h2>
            <PromptKanban prompts={visible} onOpen={setOpenPromptId} />
          </section>
        )}

        {archivedCount > 0 && (
          // The Switch renders a <button role="switch">, and a wrapping <label>
          // is not part of a button's accessible-name chain — the name has to be
          // on the control itself, or it announces as an unnamed switch.
          <div className="flex w-fit items-center gap-2 text-xs text-zinc-400">
            <Switch
              id="show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
              aria-label={`Show archived prompts (${archivedCount})`}
            />
            <label htmlFor="show-archived" className="cursor-pointer">
              Show archived (<span className="tabular-nums">{archivedCount}</span>)
            </label>
          </div>
        )}
      </div>

      <NewPromptDialog
        open={creating}
        onOpenChange={setCreating}
        defaultLlm={slug}
        onCreated={setOpenPromptId}
      />
      <PromptDetailDialog
        promptId={openPromptId}
        onOpenChange={open => !open && setOpenPromptId(null)}
      />
    </AppLayout>
  );
}
