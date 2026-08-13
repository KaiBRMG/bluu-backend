'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePromptLibrary } from '@/contexts/PromptLibraryContext';
import { LLM_LIST, type LlmType, type PromptDocument } from '@/types/promptLibrary';
import { LlmMark } from './_components/LlmMark';
import { PromptSearch } from './_components/PromptSearch';
import { NewPromptDialog } from './_components/NewPromptDialog';
import { pluralise, relativeTime } from './_lib/format';

const RECENT_COUNT = 6;

function LlmTile({ llm, count, share }: {
  llm: (typeof LLM_LIST)[number];
  count: number;
  share: number;
}) {
  const empty = count === 0;
  return (
    <Link
      href={`/applications/apps-prompt-library/${llm.id}`}
      className="group flex flex-col gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 transition-all hover:border-white/[0.12] hover:bg-white/[0.055] hover:brightness-110 active:scale-[0.98]"
    >
      <LlmMark llm={llm.id} size={40} className={empty ? 'opacity-45' : undefined} />

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-white">{llm.name}</p>
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

function RecentRow({ prompt }: { prompt: PromptDocument }) {
  return (
    <li>
      <Link
        href={`/applications/apps-prompt-library/${prompt.llmType}/${prompt.id}`}
        className="flex items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2 transition-all hover:bg-white/[0.055] hover:brightness-110 active:scale-[0.98]"
      >
        <LlmMark llm={prompt.llmType} size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
          {prompt.title}
        </span>
        <span className="hidden shrink-0 text-xs text-zinc-400 sm:inline">{prompt.category}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
          v{prompt.version} · {relativeTime(prompt.lastUpdatedTime)}
        </span>
      </Link>
    </li>
  );
}

export default function PromptLibraryPage() {
  const { prompts, loading, error } = usePromptLibrary();
  const [creating, setCreating] = useState(false);

  const live = useMemo(() => prompts.filter(p => !p.isArchived), [prompts]);

  const counts = useMemo(() => {
    const map = {} as Record<LlmType, number>;
    for (const llm of LLM_LIST) map[llm.id] = 0;
    for (const p of live) map[p.llmType] = (map[p.llmType] ?? 0) + 1;
    return map;
  }, [live]);

  const busiest = Math.max(1, ...LLM_LIST.map(l => counts[l.id]));
  const recent = live.slice(0, RECENT_COUNT);

  return (
    <AppLayout>
      <div className="flex max-w-5xl flex-col gap-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Prompt Library</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {loading ? (
                'Loading…'
              ) : (
                <>
                  <span className="tabular-nums">{live.length}</span>
                  {live.length === 1 ? ' prompt' : ' prompts'} across{' '}
                  <span className="tabular-nums">{LLM_LIST.length}</span> models, each with its own
                  version history.
                </>
              )}
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            New prompt
          </Button>
        </header>

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <section aria-labelledby="models-heading" className="flex flex-col gap-3">
          <h2 id="models-heading" className="sr-only">
            Models
          </h2>
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {LLM_LIST.map(llm => (
                <Skeleton key={llm.id} className="h-[9.5rem] rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {LLM_LIST.map(llm => (
                <LlmTile
                  key={llm.id}
                  llm={llm}
                  count={counts[llm.id]}
                  share={counts[llm.id] / busiest}
                />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="search-heading" className="flex flex-col gap-3">
          <h2 id="search-heading" className="sr-only">
            Search
          </h2>
          <PromptSearch />
        </section>

        {!loading && recent.length > 0 && (
          <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
            <h2 id="recent-heading" className="text-sm font-semibold text-zinc-300">
              Recently updated
            </h2>
            <ul className="flex flex-col gap-1.5">
              {recent.map(p => (
                <RecentRow key={p.id} prompt={p} />
              ))}
            </ul>
          </section>
        )}

        {!loading && live.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            No prompts yet. Create the first one to start the library.
          </p>
        )}
      </div>

      <NewPromptDialog open={creating} onOpenChange={setCreating} />
    </AppLayout>
  );
}
