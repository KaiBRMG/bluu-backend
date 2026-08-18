'use client';

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Paperclip, RefreshCw, Search, TriangleAlert, WifiOff } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import type { OFChatRow } from '@/hooks/useOnlyFansChats';
import { formatListTime, formatMoney } from '../_lib/format';
import {
  DEFAULT_LIST_PREFS,
  loadListPrefs,
  saveListPrefs,
  type ChatFilter,
  type ChatSort,
  type ListPrefs,
} from '../_lib/listPrefs';

const FILTERS: { id: ChatFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'unread', label: 'Unread' },
];

const SORTS: { id: ChatSort; label: string }[] = [
  { id: 'recent', label: 'Most recent' },
  { id: 'unread', label: 'Unread first' },
  { id: 'spend', label: 'Highest spend' },
];

/**
 * Every sort keeps recency as its tie-breaker.
 *
 * Without one, two fans who have spent the same (or are both unread) swap places
 * on every snapshot, because the underlying order is the Firestore query's and
 * `Array.prototype.sort` is only stable with respect to *its input*. A list that
 * reshuffles under the cursor while the operator is reading it is worse than any
 * ordering.
 */
const COMPARATORS: Record<ChatSort, (a: OFChatRow, b: OFChatRow) => number> = {
  recent: (a, b) => b.lastMessageAtMs - a.lastMessageAtMs,
  unread: (a, b) =>
    Number(b.unreadCount > 0) - Number(a.unreadCount > 0) || b.lastMessageAtMs - a.lastMessageAtMs,
  spend: (a, b) => b.spentTotal - a.spentTotal || b.lastMessageAtMs - a.lastMessageAtMs,
};

interface ChatListProps {
  chats: OFChatRow[];
  selectedId: string | null;
  onSelect: (chat: OFChatRow) => void;
  loading: boolean;
  refreshing: boolean;
  hasMore: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  timeZone?: string;
  /** Surfaced inline as well as toasted — a toast is gone before it can be acted on. */
  error?: string | null;
  offline?: boolean;
}

export default function ChatList({
  chats,
  selectedId,
  onSelect,
  loading,
  refreshing,
  hasMore,
  onRefresh,
  onLoadMore,
  timeZone,
  error,
  offline,
}: ChatListProps) {
  // Read lazily, so the first paint is already the operator's saved view rather
  // than the default flashing past it. Safe on the server: the window's guard
  // renders a skeleton until auth resolves, so this component only ever mounts
  // in the browser — the same assumption the composer's draft load makes.
  const [prefs, setPrefs] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_LIST_PREFS : loadListPrefs(),
  );
  const { filter, sort } = prefs;
  const [search, setSearch] = useState('');
  // The list can run to hundreds of rows; deferring keeps the field itself at
  // full frame rate and lets React drop stale filter passes mid-keystroke.
  const deferredSearch = useDeferredValue(search);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const update = useCallback((patch: Partial<ListPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveListPrefs(next);
      return next;
    });
  }, []);

  // Filtering and sorting are client-side over the rows already mirrored
  // locally: a provider-side search would be a billed call per keystroke.
  const visible = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    const rows = chats.filter((chat) => {
      if (filter === 'unread' && chat.unreadCount === 0) return false;
      if (filter === 'pinned' && !chat.isPinned) return false;
      if (!term) return true;
      return (
        chat.fan.name.toLowerCase().includes(term) ||
        chat.fan.username.toLowerCase().includes(term) ||
        chat.lastMessageText.toLowerCase().includes(term)
      );
    });
    // `recent` is already the Firestore query's order, so it is left alone
    // rather than re-sorted into the same sequence on every keystroke.
    return sort === 'recent' ? rows : rows.sort(COMPARATORS[sort]);
  }, [chats, filter, sort, deferredSearch]);

  const counts = useMemo(
    () => ({
      all: chats.length,
      unread: chats.filter((c) => c.unreadCount > 0).length,
      pinned: chats.filter((c) => c.isPinned).length,
    }),
    [chats],
  );

  /**
   * j/k (and the arrows) walk the list; Enter opens; Escape clears the search.
   *
   * **Moving the cursor deliberately does not open a chat.** Opening one fires
   * mark-as-read, which is a *billed provider call* — a j/k sweep down twenty
   * unread threads would be twenty of them. So the keys move DOM focus and Enter
   * activates the focused row, which is also why there is no cursor state here
   * at all: the browser owns focus, scrolls it into view, and draws the ring.
   *
   * Bound to the window rather than the list, because the operator's hands are
   * usually in the thread. Guarded against text fields, or j and k would be
   * unusable letters in the composer.
   */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (event.key === 'Escape') {
        // Escape belongs to the search field first — it is the only thing here
        // with something to dismiss. In the composer it means "cancel the
        // reply", which that component handles and stops before it reaches here.
        if (target === searchRef.current || (!typing && search)) {
          event.preventDefault();
          setSearch('');
          searchRef.current?.blur();
        }
        return;
      }

      if (typing) return;

      const forward = event.key === 'j' || event.key === 'ArrowDown';
      const back = event.key === 'k' || event.key === 'ArrowUp';
      if (!forward && !back) return;

      const rows = [
        ...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-chat-row]') ?? []),
      ];
      if (rows.length === 0) return;

      event.preventDefault();
      const current = rows.indexOf(document.activeElement as HTMLButtonElement);
      // Nothing focused yet: start from the open chat if it is on screen, so the
      // first keypress continues from where the operator is rather than jumping
      // to the top of the inbox.
      const from = current >= 0 ? current : rows.findIndex((r) => r.dataset.selected === 'true');
      const next = from < 0 ? 0 : Math.min(Math.max(from + (forward ? 1 : -1), 0), rows.length - 1);
      rows[next]?.focus();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [search]);

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-r border-white/[0.07] bg-sidebar">
      <header className="shrink-0 border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-zinc-400">
            Messages
          </h2>
          <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'size-7 text-zinc-400 hover:text-zinc-200',
                    sort !== DEFAULT_LIST_PREFS.sort && 'text-white',
                  )}
                  aria-label={`Sort chats — ${SORTS.find((s) => s.id === sort)?.label}`}
                >
                  <ArrowDownUp className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 border-white/[0.07] bg-[#171717]">
                <DropdownMenuLabel className="text-xs text-zinc-400">Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(value) => update({ sort: value as ChatSort })}
                >
                  {SORTS.map((option) => (
                    <DropdownMenuRadioItem key={option.id} value={option.id}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-zinc-400 hover:text-zinc-200"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh chats"
            >
              <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            </Button>
          </div>
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-8 bg-zinc-800 border-zinc-700 pl-8 text-sm placeholder-zinc-400 focus:border-zinc-500"
          />
        </div>

        <div className="mt-3 flex items-center gap-1.5" role="group" aria-label="Filter chats">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => update({ filter: f.id })}
              aria-pressed={filter === f.id}
              aria-label={`${f.label}, ${counts[f.id]} chats`}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                filter === f.id
                  ? 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]'
                  : 'bg-white/[0.04] text-zinc-400 hover:bg-white/[0.055] hover:text-zinc-200',
              )}
            >
              {f.label}
              {counts[f.id] > 0 && (
                <span className="tabular-nums opacity-70">{counts[f.id]}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Connection state belongs above the list, not in a toast: it explains
          why nothing is arriving, and it has to stay visible for as long as it
          is true. Zinc rather than red — offline is a condition, not an error,
          and the mirrored inbox below is still perfectly readable. */}
      {offline && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-white/[0.07] bg-white/[0.04] px-4 py-2 text-xs text-zinc-400"
        >
          <WifiOff className="size-3.5 shrink-0" />
          Offline — showing the last synced inbox.
        </div>
      )}

      {error && !offline && (
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.07] bg-orange-500/10 px-4 py-2 text-xs text-orange-400">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button
            onClick={onRefresh}
            className="shrink-0 underline underline-offset-2 hover:text-orange-300"
          >
            Retry
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading && chats.length === 0 ? (
          <div className="space-y-px p-2" role="status" aria-label="Loading chats">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-400">
            {chats.length === 0 ? 'No chats yet.' : 'Nothing matches that filter.'}
          </p>
        ) : (
          <ul ref={listRef}>
            {visible.map((chat) => (
              <li
                key={chat.id}
                /*
                 * Render-skipping instead of a virtualiser.
                 *
                 * `content-visibility: auto` makes Chromium skip layout, style
                 * and paint for rows outside the viewport — the expensive part
                 * of a long list — while every row stays in the DOM. That
                 * matters here specifically: this list is searched with
                 * `Ctrl+F`-style expectations, walked with j/k (which needs the
                 * buttons to exist to focus them), and read by a screen reader
                 * as one list. A windowing library would take all three away to
                 * solve a problem the compositor already solves.
                 *
                 * `contain-intrinsic-size: auto 76px` seeds the placeholder
                 * height and the `auto` keyword makes the browser remember each
                 * row's real height once it has been rendered, so the scrollbar
                 * does not jump as rows of different heights (the spend chip
                 * adds a line) come into view.
                 *
                 * This window is Chromium-only, so there is no fallback to
                 * carry: elsewhere it degrades to rendering everything, which is
                 * exactly what happened before.
                 */
                className="[content-visibility:auto] [contain-intrinsic-size:auto_76px]"
              >
                <ChatRow
                  chat={chat}
                  selected={chat.id === selectedId}
                  onSelect={onSelect}
                  timeZone={timeZone}
                />
              </li>
            ))}
          </ul>
        )}

        {hasMore && visible.length > 0 && (
          <div className="p-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-zinc-400 hover:text-zinc-200"
              onClick={onLoadMore}
              disabled={refreshing}
            >
              {refreshing ? 'Loading…' : 'Load older chats'}
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * Memoised: typing in the search field re-runs the filter on every keystroke,
 * and without this every surviving row (avatar included) re-renders with it.
 * `onSelect` is the parent's stable callback and takes the chat, so the row
 * needs no per-row closure to break memoisation.
 */
const ChatRow = memo(function ChatRow({
  chat,
  selected,
  onSelect,
  timeZone,
}: {
  chat: OFChatRow;
  selected: boolean;
  onSelect: (chat: OFChatRow) => void;
  timeZone?: string;
}) {
  const unread = chat.unreadCount > 0;
  const preview = chat.lastMessageText || (chat.lastMessageId ? 'Media attachment' : 'No messages yet');

  return (
    <button
      onClick={() => onSelect(chat)}
      aria-current={selected ? 'true' : undefined}
      // Read by the keyboard handler above: it queries the rows out of the DOM
      // rather than mirroring the visible list into state, so there is only one
      // copy of "which rows are on screen and in what order".
      data-chat-row=""
      data-selected={selected ? 'true' : 'false'}
      className={cn(
        // Colour + transform only. A `hover:brightness-110` here put a filter on
        // every row the cursor crossed, and a filter forces Chromium to promote
        // and re-rasterise the whole row — avatar included — on each enter and
        // leave. Over a fast drag down the list that is the visible tearing.
        'flex w-full items-start gap-3 border-b border-white/[0.04] px-3 py-2.5 text-left transition-[background-color,transform] active:scale-[0.98]',
        // The keyboard cursor. j/k move focus rather than selection, so this
        // ring *is* the cursor — without it the walk is invisible.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6]',
        // Selection carries three cues, not one: the Action Blue tint, the name
        // going full-white, and the weight step. An overlay-only selected state
        // measured 1.25:1 against an unselected row — invisible in practice.
        selected ? 'bg-[#3b82f6]/15 hover:bg-[#3b82f6]/25' : 'hover:bg-white/[0.055]',
      )}
    >
      <Avatar className="mt-0.5">
        {chat.fan.avatar && <AvatarImage src={chat.fan.avatar} alt="" />}
        <AvatarFallback
          style={{ backgroundColor: getAvatarColor(chat.fan.name) }}
          className="text-[10px] text-white"
        >
          {getInitials(chat.fan.name)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'truncate text-sm',
              selected ? 'font-semibold text-white' : 'font-medium text-zinc-300',
            )}
          >
            {chat.fan.name}
          </span>
          <span className="truncate font-mono text-xs text-zinc-400">@{chat.fan.username}</span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-400">
            {formatListTime(chat.lastMessageAt, timeZone)}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-2">
          <p className={cn('truncate text-sm', unread ? 'text-zinc-200' : 'text-zinc-400')}>
            {chat.lastMessageFromMe && <span className="text-zinc-400">You: </span>}
            {preview === 'Media attachment' ? (
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <Paperclip className="size-3" />
                Media attachment
              </span>
            ) : (
              preview
            )}
          </p>
          {unread && (
            <Badge variant="secondary" className="ml-auto h-4 shrink-0 px-1.5 text-[10px] tabular-nums">
              {chat.unreadCount}
              <span className="sr-only"> unread</span>
            </Badge>
          )}
        </div>

        {chat.spentTotal > 0 && (
          <span className="mt-1 inline-block rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] tabular-nums text-zinc-400">
            {formatMoney(chat.spentTotal)}
            <span className="sr-only"> spent lifetime</span>
          </span>
        )}
      </div>
    </button>
  );
});
