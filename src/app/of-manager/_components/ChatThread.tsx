'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, SendHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import type { OFChatRow } from '@/hooks/useOnlyFansChats';
import { useOnlyFansMessages, type OFMessageRow } from '@/hooks/useOnlyFansMessages';
import { dayKey, formatClock, formatDayLabel, formatMoney } from '../_lib/format';

interface ChatThreadProps {
  accountId: string | null;
  chat: OFChatRow;
  timeZone?: string;
}

/** How close to the top counts as "scrolled up" and triggers the older page. */
const LOAD_OLDER_THRESHOLD_PX = 120;
/** Distance from the bottom within which we keep the view pinned to new messages. */
const STICK_TO_BOTTOM_PX = 120;

export default function ChatThread({ accountId, chat, timeZone }: ChatThreadProps) {
  const { messages, loading, loadingOlder, hasMore, sending, error, loadOlder, send } =
    useOnlyFansMessages(accountId, chat.id);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');

  // Preserved across an older-page load so the viewport stays on the message the
  // user was reading instead of jumping as content is prepended above it.
  const restoreRef = useRef<number | null>(null);
  const atBottomRef = useRef(true);
  const lastChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX && hasMore && !loadingOlder) {
      restoreRef.current = el.scrollHeight;
      loadOlder();
    }
  }, [hasMore, loadingOlder, loadOlder]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Older page landed — hold the reading position.
    if (restoreRef.current !== null) {
      el.scrollTop = el.scrollHeight - restoreRef.current;
      restoreRef.current = null;
      return;
    }

    // New thread, or a new message while the user was already at the bottom.
    if (lastChatIdRef.current !== chat.id || atBottomRef.current) {
      lastChatIdRef.current = chat.id;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, chat.id]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    atBottomRef.current = true;
    const ok = await send(text);
    if (ok) toast.success('Message sent');
    else setDraft(text);
  };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.07] px-4 py-3">
        <Avatar>
          {chat.fan.avatar && <AvatarImage src={chat.fan.avatar} alt="" />}
          <AvatarFallback
            style={{ backgroundColor: getAvatarColor(chat.fan.name) }}
            className="text-[10px] text-white"
          >
            {getInitials(chat.fan.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight">{chat.fan.name}</p>
          <p className="truncate font-mono text-xs text-zinc-500">@{chat.fan.username}</p>
        </div>
        {chat.spentTotal > 0 && (
          <span className="ml-auto rounded-full bg-white/[0.04] px-2 py-0.5 text-xs tabular-nums text-zinc-400">
            {formatMoney(chat.spentTotal)} lifetime
          </span>
        )}
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {loading && messages.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton
                key={i}
                className={cn('h-12 rounded-xl', i % 2 ? 'ml-auto w-1/2' : 'w-2/3')}
              />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <>
            {loadingOlder && (
              <div className="flex justify-center py-2 text-zinc-500">
                <Loader2 className="size-4 animate-spin" />
              </div>
            )}
            {!hasMore && !loadingOlder && (
              <p className="pb-4 text-center text-xs text-muted-foreground">
                Start of conversation
              </p>
            )}
            <MessageGroups messages={messages} timeZone={timeZone} />
          </>
        )}
      </div>

      <footer className="shrink-0 border-t border-white/[0.07] p-3">
        {chat.canSendMessage ? (
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Type a message…"
              rows={1}
              className="max-h-40 min-h-[2.5rem] resize-none bg-zinc-800 border-zinc-700 text-sm placeholder-zinc-500 focus:border-zinc-500"
            />
            <Button onClick={submit} disabled={!draft.trim() || sending} className="h-10 shrink-0">
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <SendHorizontal className="size-4" />
              )}
              Send
            </Button>
          </div>
        ) : (
          <p className="py-2 text-center text-sm text-muted-foreground">
            You cannot send messages to this fan.
          </p>
        )}
      </footer>
    </section>
  );
}

function MessageGroups({ messages, timeZone }: { messages: OFMessageRow[]; timeZone?: string }) {
  const rows: React.ReactNode[] = [];
  let lastDay = '';

  for (const message of messages) {
    const key = dayKey(message.createdAt, timeZone);
    if (key !== lastDay) {
      lastDay = key;
      rows.push(
        <div key={`day-${key}`} className="my-4 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.07]" />
          <span className="text-xs text-zinc-500">
            {formatDayLabel(message.createdAt, timeZone)}
          </span>
          <span className="h-px flex-1 bg-white/[0.07]" />
        </div>,
      );
    }
    rows.push(<MessageBubble key={message.id} message={message} timeZone={timeZone} />);
  }

  return <div className="space-y-2">{rows}</div>;
}

function MessageBubble({ message, timeZone }: { message: OFMessageRow; timeZone?: string }) {
  return (
    <div className={cn('flex', message.fromMe ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[75%]">
        <div
          className={cn(
            'rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words',
            message.fromMe
              ? 'bg-[#3b82f6]/15 border border-[#3b82f6]/30 text-foreground'
              : 'bg-white/[0.04] border border-white/[0.07] text-foreground',
            message.failed && 'border-red-400/30 bg-red-400/10',
          )}
        >
          {message.text || (message.mediaCount > 0 ? null : <span className="text-zinc-500">—</span>)}

          {message.mediaCount > 0 && (
            <span
              className={cn(
                'mt-1 flex items-center gap-1.5 text-xs text-zinc-400',
                message.text && 'border-t border-white/[0.07] pt-1.5',
              )}
            >
              <Paperclip className="size-3" />
              {message.mediaCount} attachment{message.mediaCount === 1 ? '' : 's'}
              {message.price > 0 && (
                <span className="tabular-nums text-orange-400">
                  {formatMoney(message.price)} {message.isOpened ? 'unlocked' : 'locked'}
                </span>
              )}
            </span>
          )}
        </div>

        <div
          className={cn(
            'mt-1 flex items-center gap-2 px-1 text-[11px] text-zinc-500',
            message.fromMe ? 'justify-end' : 'justify-start',
          )}
        >
          {message.isTip && <span className="tabular-nums text-green-400">Tip</span>}
          <span className="tabular-nums">{formatClock(message.createdAt, timeZone)}</span>
          {message.pending && <span>Sending…</span>}
          {message.failed && <span className="text-red-400">Failed</span>}
        </div>
      </div>
    </div>
  );
}
