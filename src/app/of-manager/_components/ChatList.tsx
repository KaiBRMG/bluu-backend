'use client';

import { memo, useDeferredValue, useMemo, useState } from 'react';
import { Paperclip, RefreshCw, Search } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import type { OFChatRow } from '@/hooks/useOnlyFansChats';
import { formatListTime, formatMoney } from '../_lib/format';

type Filter = 'all' | 'unread' | 'pinned';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'unread', label: 'Unread' },
];

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
}: ChatListProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  // The list can run to hundreds of rows; deferring keeps the field itself at
  // full frame rate and lets React drop stale filter passes mid-keystroke.
  const deferredSearch = useDeferredValue(search);

  // Filtering is client-side over the rows already mirrored locally: a
  // provider-side search would be a billed call per keystroke.
  const visible = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    return chats.filter((chat) => {
      if (filter === 'unread' && chat.unreadCount === 0) return false;
      if (filter === 'pinned' && !chat.isPinned) return false;
      if (!term) return true;
      return (
        chat.fan.name.toLowerCase().includes(term) ||
        chat.fan.username.toLowerCase().includes(term) ||
        chat.lastMessageText.toLowerCase().includes(term)
      );
    });
  }, [chats, filter, deferredSearch]);

  const counts = useMemo(
    () => ({
      all: chats.length,
      unread: chats.filter((c) => c.unreadCount > 0).length,
      pinned: chats.filter((c) => c.isPinned).length,
    }),
    [chats],
  );

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-r border-white/[0.07] bg-sidebar">
      <header className="shrink-0 border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-zinc-400">
            Messages
          </h2>
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

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
          <Input
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
              onClick={() => setFilter(f.id)}
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
          <ul>
            {visible.map((chat) => (
              <li key={chat.id}>
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
      className={cn(
        // Colour + transform only. A `hover:brightness-110` here put a filter on
        // every row the cursor crossed, and a filter forces Chromium to promote
        // and re-rasterise the whole row — avatar included — on each enter and
        // leave. Over a fast drag down the list that is the visible tearing.
        'flex w-full items-start gap-3 border-b border-white/[0.04] px-3 py-2.5 text-left transition-[background-color,transform] active:scale-[0.98]',
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
