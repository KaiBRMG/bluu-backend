'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { ChevronLeft, Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { usePromptLibrary } from '@/contexts/PromptLibraryContext';
import { LLM_META, isLlmType, type PromptDocument } from '@/types/promptLibrary';
import { LlmMark } from '../_components/LlmMark';
import { PromptSearch } from '../_components/PromptSearch';
import { NewPromptDialog } from '../_components/NewPromptDialog';
import { pluralise, relativeTime } from '../_lib/format';

/**
 * A category column. Mirrors the kanban column from the custom-requests
 * overview — same overlay surface, same header shape, same right-aligned count —
 * with the category name standing where the creator's name does there.
 */
function CategoryColumn({ category, count, children }: {
  category: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mb-3 flex break-inside-avoid flex-col gap-1.5 rounded-xl p-2.5"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold text-zinc-300">{category}</h3>
        <span className="shrink-0 text-xs tabular-nums text-zinc-400">{count}</span>
      </div>
      {children}
    </div>
  );
}

function PromptRow({ prompt }: { prompt: PromptDocument }) {
  const href = `/applications/apps-prompt-library/${prompt.llmType}/${prompt.id}`;
  return (
    <div
      className="flex items-center gap-2 rounded-md border-l-2 py-1.5 pl-2 pr-1.5"
      style={{ background: 'rgba(255,255,255,0.04)', borderLeftColor: 'rgba(255,255,255,0.14)' }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={href}
          className="truncate text-left text-xs font-medium text-zinc-200 underline-offset-2 transition-colors hover:text-white hover:underline"
        >
          {prompt.title}
        </Link>
        <span className="text-[11px] tabular-nums text-zinc-400">
          v{prompt.version} · {relativeTime(prompt.lastUpdatedTime)}
        </span>
      </div>
      <Button size="xs" variant="outline" className="shrink-0" asChild>
        <Link href={href}>Open</Link>
      </Button>
    </div>
  );
}

export default function LlmPromptsPage() {
  const params = useParams<{ llm: string }>();
  const { prompts, loading, error } = usePromptLibrary();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Validated after every hook has run — `notFound()` throws, and bailing out
  // above the hooks would make the hook order conditional.
  const slug = params?.llm;
  const llm = isLlmType(slug) ? LLM_META[slug] : null;

  const mine = useMemo(() => prompts.filter(p => p.llmType === slug), [prompts, slug]);
  const visible = useMemo(
    () => mine.filter(p => showArchived || !p.isArchived),
    [mine, showArchived]
  );
  const archivedCount = useMemo(() => mine.filter(p => p.isArchived).length, [mine]);

  // Grouped by category, busiest column first, titles A-Z inside each.
  const columns = useMemo(() => {
    const groups = new Map<string, PromptDocument[]>();
    for (const p of visible) {
      const key = p.category || 'Uncategorised';
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    }
    return Array.from(groups.entries())
      .map(([category, items]) => ({
        category,
        items: [...items].sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => b.items.length - a.items.length || a.category.localeCompare(b.category));
  }, [visible]);

  if (!llm) notFound();

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
            <LlmMark llm={llm.id} size={36} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{llm.name}</h1>
              <p className="text-sm text-zinc-400">
                {loading ? (
                  'Loading…'
                ) : (
                  <span className="tabular-nums">
                    {pluralise(visible.length, 'prompt')} in{' '}
                    {pluralise(columns.length, 'category', 'categories')}
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

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <PromptSearch scope={llm.id} />

        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No {llm.name} prompts yet. Create the first one.
          </p>
        ) : (
          <section aria-labelledby="categories-heading">
            <h2 id="categories-heading" className="sr-only">
              {llm.name} prompts by category
            </h2>
            {/* CSS columns rather than a grid: category columns are uneven, and
                columns let short ones pack tightly instead of leaving dead rows. */}
            <div className="columns-1 [column-gap:0.75rem] sm:columns-2 lg:columns-4">
              {columns.map(column => (
                <CategoryColumn
                  key={column.category}
                  category={column.category}
                  count={column.items.length}
                >
                  {column.items.map(p => (
                    <PromptRow key={p.id} prompt={p} />
                  ))}
                </CategoryColumn>
              ))}
            </div>
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

      <NewPromptDialog open={creating} onOpenChange={setCreating} defaultLlm={llm.id} />
    </AppLayout>
  );
}
