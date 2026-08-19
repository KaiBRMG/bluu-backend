'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, CornerDownLeft, Search, X } from 'lucide-react';
import { usePromptLibrary } from '@/contexts/PromptLibraryContext';
import { useUserName } from '@/hooks/useUserName';
import {
  MATCH_FIELD_LABEL,
  PromptSearchIndex,
  parseQuery,
  searchPrompts,
  type PromptSearchHit,
} from '@/lib/promptSearch';
import { type LlmType } from '@/types/promptLibrary';
import { LlmMarks } from './LlmMark';
import { Highlight } from './Highlight';
import { relativeTime } from '../_lib/format';

const MAX_RESULTS = 40;

/** Stable per-hit id, so `aria-activedescendant` can point at the active row. */
function optionId(hit: PromptSearchHit): string {
  return `prompt-search-option-${hit.prompt.id}`;
}

/**
 * The library's one search surface, shared by the home screen and every model
 * page. It always searches the WHOLE library — `scope` only changes how a hit
 * from another model is presented, so a search inside ChatGPT still surfaces
 * the Claude prompt you were actually thinking of.
 */
export function PromptSearch({ scope, onOpen }: { scope?: LlmType; onOpen: (id: string) => void }) {
  const { prompts, modelsById } = usePromptLibrary();
  const { names } = useUserName();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The tokenised index survives keystrokes; only scoring re-runs as you type.
  // Held in state rather than a ref: it is read during render, and the lazy
  // initialiser makes it stable for the component's lifetime either way.
  const [index] = useState(() => new PromptSearchIndex());
  const entries = useMemo(() => {
    const resolve = (uid: string) => names[uid] ?? '';
    const resolveModel = (id: string) => modelsById[id]?.name ?? id;
    return index.sync(
      prompts.filter(p => !p.isArchived),
      resolve,
      resolveModel
    );
  }, [index, prompts, names, modelsById]);

  const terms = useMemo(() => parseQuery(query), [query]);
  const hits = useMemo(
    () => (terms.length ? searchPrompts(entries, query, MAX_RESULTS) : []),
    [entries, query, terms.length]
  );

  // A hit under the current model comes first; the rest are still shown, flagged.
  const ordered = useMemo(() => {
    if (!scope) return hits;
    return [...hits].sort((a, b) => {
      const aIn = a.prompt.llmTypes.includes(scope) ? 0 : 1;
      const bIn = b.prompt.llmTypes.includes(scope) ? 0 : 1;
      return aIn - bIn || b.score - a.score;
    });
  }, [hits, scope]);

  // Clamped rather than reset from an effect: the result list can shrink under
  // the cursor between renders, and a stale index must never index past the end.
  const activeIndex = ordered.length ? Math.min(active, ordered.length - 1) : 0;

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const open = (hit: PromptSearchHit) => onOpen(hit.prompt.id);

  const changeQuery = (next: string) => {
    setQuery(next);
    setActive(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      changeQuery('');
      return;
    }
    if (ordered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((activeIndex + 1) % ordered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((activeIndex - 1 + ordered.length) % ordered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(ordered[activeIndex]);
    }
  };

  const searching = terms.length > 0;
  const expanded = searching && ordered.length > 0;
  const activeId = expanded ? optionId(ordered[activeIndex]) : undefined;

  return (
    <section className="flex flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
          aria-hidden
        />
        {/* The cursor these arrow keys move is a real one, so it is declared as
            one: without the combobox/option pairing a screen reader hears
            nothing while stepping through hits, then opens one unannounced. */}
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={e => changeQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={expanded}
          aria-controls="prompt-search-results"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Search every prompt"
          aria-describedby="prompt-search-hint"
          placeholder="Search prompts — model, category, tag, text, person, date"
          className="h-12 w-full rounded-xl border border-white/[0.07] bg-white/[0.025] pl-11 pr-11 text-sm text-white transition-colors placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              changeQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <p id="prompt-search-hint" className="sr-only">
        Words are combined — every word must match somewhere. Wrap a phrase in quotes for an exact
        match. Use the up and down arrows to move through results and Enter to open one.
      </p>

      {/* The live region is mounted for the component's whole life. A region
          that arrives in the DOM together with its first message is commonly
          not announced at all — which is the one announcement that matters. */}
      <p aria-live="polite" className="sr-only">
        {searching
          ? `${ordered.length} ${ordered.length === 1 ? 'prompt matches' : 'prompts match'}`
          : ''}
      </p>

      {searching && (
        <div className="flex items-baseline justify-between gap-3" aria-hidden>
          <p className="text-xs text-zinc-400">
            <span className="tabular-nums">{ordered.length}</span>
            {ordered.length === 1 ? ' prompt matches' : ' prompts match'}
            {ordered.length === MAX_RESULTS ? ' (showing the strongest matches)' : ''}
          </p>
          {ordered.length > 0 && (
            <p className="hidden items-center gap-1.5 text-[11px] text-zinc-400 sm:flex">
              <CornerDownLeft className="size-3" aria-hidden />
              Enter to open
            </p>
          )}
        </div>
      )}

      {searching && ordered.length === 0 && (
        <p className="py-6 text-sm text-muted-foreground">
          No prompt matches every word. Try fewer words.
        </p>
      )}

      {searching && ordered.length > 0 && (
        <ul
          ref={listRef}
          id="prompt-search-results"
          role="listbox"
          aria-label="Search results"
          className="flex flex-col gap-1.5"
        >
          {ordered.map((hit, i) => {
            const elsewhere = scope !== undefined && !hit.prompt.llmTypes.includes(scope);
            return (
              // The option role sits on the <li> itself: a listbox owns options
              // directly, and an intervening listitem breaks that relationship.
              // The whole row is the target — it used to look tappable while
              // only the title and the trailing button were.
              <li
                key={hit.prompt.id}
                id={optionId(hit)}
                role="option"
                aria-selected={i === activeIndex}
                data-active={i === activeIndex}
                onMouseEnter={() => setActive(i)}
                onClick={() => open(hit)}
                className="group flex cursor-pointer items-start gap-3 rounded-lg border border-transparent bg-white/[0.04] px-3 py-2.5 transition-all hover:brightness-110 active:scale-[0.98] data-[active=true]:border-white/[0.07] data-[active=true]:bg-white/[0.055]"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-zinc-100 underline-offset-2 group-hover:text-white group-hover:underline">
                      <Highlight text={hit.prompt.title} terms={terms} />
                    </span>
                    <span className="text-xs text-zinc-400">
                      <Highlight text={hit.prompt.category} terms={terms} />
                    </span>
                    {elsewhere && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-zinc-300">
                        in
                        <LlmMarks llms={hit.prompt.llmTypes} size={12} max={3} />
                      </span>
                    )}
                  </div>

                  {hit.snippet && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">
                      <Highlight text={hit.snippet} terms={terms} />
                    </p>
                  )}

                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
                    <span className="tabular-nums">v{hit.prompt.version}</span>
                    <span aria-hidden>·</span>
                    <span>{relativeTime(hit.prompt.lastUpdatedTime)}</span>
                    <span aria-hidden>·</span>
                    <span>matched in {hit.fields.map(f => MATCH_FIELD_LABEL[f]).join(', ')}</span>
                  </p>
                </div>

                {/* Trailing rather than leading, now that a prompt can carry
                    several marks and the strip's width varies with it. */}
                <LlmMarks llms={hit.prompt.llmTypes} size={16} max={4} className="mt-0.5" />

                {/* A mark, not a control: the row itself is the button, and a
                      second target inside an option would be unreachable. */}
                <ChevronRight
                  className="mt-0.5 size-4 shrink-0 text-zinc-400 transition-colors group-hover:text-white"
                  aria-hidden
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
