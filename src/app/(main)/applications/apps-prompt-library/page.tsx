'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Globe, Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePromptLibrary } from '@/contexts/PromptLibraryContext';
import { type PromptModel } from '@/types/promptLibrary';
import { LlmMark } from './_components/LlmMark';
import { PromptSearch } from './_components/PromptSearch';
import { NewPromptDialog } from './_components/NewPromptDialog';
import { AddModelDialog } from './_components/AddModelDialog';
import { PromptDetailDialog } from './_components/PromptDetailDialog';
import { PromptKanban } from './_components/PromptKanban';
import { PublicPrompts } from './_components/PublicPrompts';
import { pluralise } from './_lib/format';

function LlmTile({ llm, count, share }: {
  llm: PromptModel;
  count: number;
  share: number;
}) {
  const empty = count === 0;
  return (
    <Link
      href={`/applications/apps-prompt-library/${llm.id}`}
      className="group flex w-40 shrink-0 flex-col gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 transition-all hover:border-white/[0.12] hover:bg-white/[0.055] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] active:scale-[0.98]"
    >
      <LlmMark llm={llm.id} size={40} className={empty ? 'opacity-45' : undefined} />

      <div className="flex flex-col gap-2">
        <p className="truncate text-sm font-bold text-white">{llm.name}</p>
        <p className="text-xs text-zinc-400">
          {empty ? 'No prompts yet' : <span className="tabular-nums">{pluralise(count, 'prompt')}</span>}
        </p>

        {/* Relative volume against the busiest model. A proportion, not
            decoration — so it stays greyscale, and it is hidden from assistive
            tech because the exact count is already stated in the line above. */}
        <div
          className="h-0.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
          aria-hidden
        >
          {/* Scaled, not width-animated: transform stays off the layout path. */}
          <div
            className="h-full w-full origin-left rounded-full bg-white/35 transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{ transform: `scaleX(${Math.max(share, count > 0 ? 0.04 : 0)})` }}
          />
        </div>
      </div>
    </Link>
  );
}

/**
 * Opens the detail dialog for `?prompt=<id>`.
 *
 * That parameter is how a deep link lands: the public share page's "Open in
 * Bluu Backend" fires `bluu://prompt?id=…`, `DeepLinkRouter` turns it into this
 * URL, and the dialog opens over the board — the same result as clicking the
 * card, which is the point.
 *
 * It runs once per id rather than on every render of the param, so closing the
 * dialog does not immediately reopen it. The URL is deliberately left alone: a
 * user who reloads gets the prompt back, which is what a link should do.
 */
function usePromptDeepLinkParam(open: (id: string) => void) {
  const searchParams = useSearchParams();
  const requested = searchParams.get('prompt');

  useEffect(() => {
    if (requested) open(requested);
    // `open` is a setState function and stable; keying on the id alone is what
    // makes this fire once per link rather than once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);
}

export default function PromptLibraryPage() {
  return (
    // `useSearchParams` opts the subtree into client-side rendering, so it needs
    // a boundary of its own or the whole route fails to prerender.
    <Suspense fallback={null}>
      <PromptLibraryBoard />
    </Suspense>
  );
}

function PromptLibraryBoard() {
  const { prompts, models, loading, error } = usePromptLibrary();
  const [creating, setCreating] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [openPromptId, setOpenPromptId] = useState<string | null>(null);

  usePromptDeepLinkParam(setOpenPromptId);

  const live = useMemo(() => prompts.filter(p => !p.isArchived), [prompts]);

  // A prompt targeting three models counts once under each of them.
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of models) map[m.id] = 0;
    for (const p of live) {
      for (const id of p.llmTypes) map[id] = (map[id] ?? 0) + 1;
    }
    return map;
  }, [live, models]);

  const busiest = Math.max(1, ...models.map(l => counts[l.id] ?? 0));

  return (
    <AppLayout>
      {/*
        A container query, not a breakpoint. The split below depends on how wide
        this COLUMN is, and the column's width depends on whether the sidebar is
        collapsed — a `min-[…]` media query measures the viewport and would put
        the rail alongside content that has no room for it (or withhold it when
        there is plenty). 83rem is the exact sum it needs: 64rem of content, the
        2rem gap, and a 17rem rail.
      */}
      <div className="@container/library flex w-full max-w-[83rem] flex-col gap-8">
        <header className="flex max-w-5xl flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Prompt Library</h1>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            New prompt
          </Button>
        </header>

        {error && (
          <p className="max-w-5xl rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        {/* The board keeps its 64rem measure at every width; the rail takes the
            space to its right that was previously empty, and drops back below
            the board when there is not enough of it. */}
        <div className="grid grid-cols-1 gap-8 @min-[83rem]/library:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="flex min-w-0 max-w-5xl flex-col gap-8">
          <section aria-labelledby="models-heading" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <h2 id="models-heading" className="text-lg font-semibold">
                Model Types
              </h2>
              <p className="text-sm text-zinc-400">
                Prompts are organized by Model types. Add one{' '}
                <button
                  type="button"
                  onClick={() => setAddingModel(true)}
                  className="rounded-sm text-zinc-200 underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
                >
                  here
                </button>
                .
              </p>
            </div>

            {loading ? (
              <div className="flex gap-3">
                {[0, 1, 2, 3, 4].map(i => (
                  <Skeleton key={i} className="h-[9.5rem] w-40 shrink-0 rounded-xl" />
                ))}
              </div>
            ) : (
              // A row rather than a grid: the list grows every time someone coins
              // a model, and it scrolls on its own so the page body never does.
              <div className="-mx-1 overflow-x-auto px-1 pb-2">
                <div className="flex w-max gap-3">
                  {models.map(llm => (
                    <LlmTile
                      key={llm.id}
                      llm={llm}
                      count={counts[llm.id] ?? 0}
                      share={(counts[llm.id] ?? 0) / busiest}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="search-heading" className="flex flex-col gap-3">
            <h2 id="search-heading" className="sr-only">
              Search
            </h2>
            <PromptSearch onOpen={setOpenPromptId} />
          </section>

          {!loading && live.length > 0 && (
            <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
              <h2 id="recent-heading" className="text-lg font-semibold">
                Recently updated
              </h2>
              <PromptKanban prompts={live} onOpen={setOpenPromptId} />
            </section>
          )}

          {!loading && live.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">
              No prompts yet. Create the first one to start the library.
            </p>
          )}
          </div>

          {/* Rendered even when empty, unlike "Recently updated" above. This
              section answers "what have we put on the open internet?", and an
              absent section is indistinguishable from one scrolled past — a
              silence is not the same as an explicit "nothing is shared".

              As a rail it is edged with a hairline rule rather than wrapped in a
              panel: its rows already sit on the overlay surface, and a panel of
              panels is the one elevation move this system does not make. */}
          {!loading && (
            <aside
              aria-labelledby="public-heading"
              className="flex flex-col gap-3 @min-[83rem]/library:border-l @min-[83rem]/library:border-white/[0.07] @min-[83rem]/library:pl-6"
            >
              <div className="flex flex-col gap-1.5">
                <h2 id="public-heading" className="flex items-center gap-2 text-lg font-semibold">
                  <Globe className="size-4 text-zinc-400" aria-hidden />
                  Public Prompts
                </h2>
                <p className="text-sm text-zinc-400">
                  Readable by anyone with the link — no sign-in required. Stop sharing from a
                  prompt’s ⋯ menu.
                </p>
              </div>
              <PublicPrompts prompts={prompts} onOpen={setOpenPromptId} />
            </aside>
          )}
        </div>
      </div>

      <NewPromptDialog open={creating} onOpenChange={setCreating} onCreated={setOpenPromptId} />
      <AddModelDialog open={addingModel} onOpenChange={setAddingModel} />
      <PromptDetailDialog
        promptId={openPromptId}
        onOpenChange={open => !open && setOpenPromptId(null)}
      />
    </AppLayout>
  );
}
