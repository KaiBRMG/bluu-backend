'use client';

import { useMemo } from 'react';
import type { PromptDocument } from '@/types/promptLibrary';
import { LlmMarks } from './LlmMark';
import { relativeTime } from '../_lib/format';

interface Column {
  category: string;
  items: PromptDocument[];
  /** Most recent update in the column — what orders the board. */
  latest: number;
}

/**
 * The library as a board: one column per category, cards newest-edited first.
 *
 * The columns themselves are ordered by recency too, so the category someone
 * last worked in is the one already on screen — the board is a "recently
 * updated" view that happens to be grouped, not an inbox that needs scanning.
 */
export function PromptKanban({
  prompts,
  onOpen,
}: {
  prompts: PromptDocument[];
  onOpen: (id: string) => void;
}) {
  const columns = useMemo<Column[]>(() => {
    const groups = new Map<string, PromptDocument[]>();
    for (const p of prompts) {
      const key = p.category || 'Uncategorised';
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    }
    return Array.from(groups.entries())
      .map(([category, items]) => {
        const sorted = [...items].sort(
          (a, b) =>
            new Date(b.lastUpdatedTime).getTime() - new Date(a.lastUpdatedTime).getTime()
        );
        return {
          category,
          items: sorted,
          latest: new Date(sorted[0].lastUpdatedTime).getTime(),
        };
      })
      .sort((a, b) => b.latest - a.latest || a.category.localeCompare(b.category));
  }, [prompts]);

  if (columns.length === 0) return null;

  return (
    // CSS columns, not a grid — the board is masonry.
    //
    // A grid lays out in ROWS, so every category in a row starts at the same y
    // and the short ones leave a dead gap beneath them before the next row
    // begins. Multi-column flows each category into the shortest column
    // instead, so a two-prompt category is followed immediately by whatever
    // comes next in that column and there is no whitespace to reclaim.
    //
    // The trade is reading order: content flows down column one, then down
    // column two. That suits this board, where the ordering is by recency —
    // the most recently touched categories are the ones at the top left.
    <ul className="columns-1 [column-gap:0.75rem] sm:columns-2 lg:columns-3">
      {columns.map(column => (
        <li
          key={column.category}
          // `break-inside-avoid` keeps a category whole; a column break through
          // the middle of one would orphan its cards under the next heading.
          className="mb-3 flex break-inside-avoid flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5"
        >
          <div className="flex items-center justify-between gap-2 px-0.5">
            <h3 className="min-w-0 truncate text-sm font-semibold text-zinc-300">
              {column.category}
            </h3>
            <span className="shrink-0 text-xs tabular-nums text-zinc-400">
              {column.items.length}
            </span>
          </div>

          <ul className="flex flex-col gap-1.5">
            {column.items.map(prompt => (
              <li key={prompt.id}>
                <PromptCard prompt={prompt} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function PromptCard({
  prompt,
  onOpen,
}: {
  prompt: PromptDocument;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(prompt.id)}
      className="flex w-full flex-col gap-2 rounded-lg border border-white/[0.06] bg-white/[0.04] px-2.5 py-2 text-left transition-all hover:border-white/[0.12] hover:bg-white/[0.065] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] active:scale-[0.98]"
    >
      <span className="line-clamp-2 text-xs font-medium leading-snug text-zinc-100">
        {prompt.title}
      </span>

      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
          <span className="tabular-nums">v{prompt.version}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{relativeTime(prompt.lastUpdatedTime)}</span>
        </span>
        {/* Trailing, because the strip's width varies with how many models a
            prompt targets — leading it would ragged-edge every title. */}
        <LlmMarks llms={prompt.llmTypes} size={18} max={3} />
      </span>
    </button>
  );
}
