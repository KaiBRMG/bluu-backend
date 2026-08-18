'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HandCoins, Heart, Loader2, Lock, LockOpen, PanelRight, Pin, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';
import type { OFChatRow } from '@/hooks/useOnlyFansChats';
import {
  useOnlyFansMessages,
  type OFMessageRow,
  type SendInput,
} from '@/hooks/useOnlyFansMessages';
import MessageActions from './MessageActions';
import MessageAttachments from './MessageAttachments';
import MessageComposer from './MessageComposer';
import { dayKey, formatClock, formatDayLabel, formatMoney, splitMoney } from '../_lib/format';

interface ChatThreadProps {
  accountId: string | null;
  chat: OFChatRow;
  timeZone?: string;
  /** Bumped by the chat list's refresh button — re-pulls this thread's history. */
  reloadToken?: number;
  /** Null hides the toggle entirely — the window is too narrow for a third pane. */
  fanPanelOpen?: boolean;
  onToggleFanPanel?: () => void;
}

/** What the composer is handed when a bubble's Reply is chosen. */
export interface ReplyTarget {
  id: string;
  text: string;
  fromMe: boolean;
}

/** How close to the top counts as "scrolled up" and triggers the older page. */
const LOAD_OLDER_THRESHOLD_PX = 120;
/** Distance from the bottom within which we keep the view pinned to new messages. */
const STICK_TO_BOTTOM_PX = 120;

export default function ChatThread({
  accountId,
  chat,
  timeZone,
  reloadToken,
  fanPanelOpen,
  onToggleFanPanel,
}: ChatThreadProps) {
  const {
    messages,
    loading,
    loadingOlder,
    hasMore,
    sending,
    error,
    loadOlder,
    send,
    setFlag,
    reload,
  } = useOnlyFansMessages(accountId, chat.id, reloadToken);

  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * A one-shot handoff to the composer, not a second home for unsent state.
   *
   * Reply-to *is* unsent work, so by this window's standing rule it must live in
   * the composer alongside the text, the attachments and the price — it is
   * persisted with the draft and restored with it. But the action that creates
   * it happens up here, on a bubble. So this is an **event**: the thread raises
   * a target, the composer takes it into its draft and calls back to clear it.
   * There is never a moment where both hold the answer.
   */
  const [replyRequest, setReplyRequest] = useState<ReplyTarget | null>(null);

  const requestReply = useCallback((message: OFMessageRow) => {
    setReplyRequest({ id: message.id, text: message.text, fromMe: message.fromMe });
  }, []);

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

  /**
   * Send, with the view stuck to the bottom for the message about to land.
   *
   * A failed send drops its optimistic bubble and returns `false`; the composer
   * restores the whole draft — text and staged uploads together — so it stays
   * the single place unsent work lives. The error toast is the only feedback
   * needed: a success toast per message would fire every few seconds in a live
   * conversation, which is how operators learn to ignore toasts entirely. The
   * bubble landing in the thread is the confirmation.
   */
  const sendMessage = useCallback(
    (input: SendInput) => {
      atBottomRef.current = true;
      return send(input);
    },
    [send],
  );

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
          <h1 className="truncate text-lg font-semibold leading-tight">{chat.fan.name}</h1>
          <p className="truncate font-mono text-xs text-zinc-400">@{chat.fan.username}</p>
        </div>
        {chat.spentTotal > 0 && (
          <span className="ml-auto rounded-full bg-white/[0.04] px-2 py-0.5 text-xs tabular-nums text-zinc-400">
            {formatMoney(chat.spentTotal)} lifetime
          </span>
        )}
        {onToggleFanPanel && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleFanPanel}
            aria-pressed={fanPanelOpen}
            aria-label={fanPanelOpen ? 'Hide fan details' : 'Show fan details'}
            className={cn(
              'size-7 shrink-0 text-zinc-400 hover:text-zinc-200',
              chat.spentTotal > 0 ? 'ml-1' : 'ml-auto',
              fanPanelOpen && 'text-white',
            )}
          >
            <PanelRight className="size-4" />
          </Button>
        )}
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        // Polite while the thread is live so an incoming reply is announced;
        // silenced during an older-page load, where "additions" would otherwise
        // read out thirty messages of history the operator scrolled back to.
        aria-live={loadingOlder ? 'off' : 'polite'}
        aria-relevant="additions"
        aria-busy={loading}
        aria-label={`Conversation with ${chat.fan.name}`}
        // `overscroll-contain` stops a wheel event that has run out of thread
        // from chaining to the document behind it.
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
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
        ) : error && messages.length === 0 ? (
          // A failed load with nothing to fall back on must not read as "this
          // conversation is empty" — that is a different fact, and acting on it
          // (messaging a fan you believe you have never spoken to) is a real
          // mistake. The toast is transient; this state is the recoverable one.
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-zinc-400">Couldn&apos;t load this conversation.</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={reload}
              className="gap-1.5 text-zinc-400 hover:text-white"
            >
              <RotateCw className="size-3.5" />
              Try again
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400">No messages yet.</p>
        ) : (
          <>
            {loadingOlder && (
              <div className="flex justify-center py-2 text-zinc-400">
                <Loader2 className="size-4 animate-spin" />
              </div>
            )}
            {!hasMore && !loadingOlder && (
              <p className="pb-4 text-center text-xs text-zinc-400">Start of conversation</p>
            )}
            <MessageGroups
              messages={messages}
              timeZone={timeZone}
              onReply={requestReply}
              setFlag={setFlag}
            />
          </>
        )}
      </div>

      {/* The composer owns everything unsent: text, staged attachments, price,
          reply target, and the per-thread draft. It is keyed with the thread, so
          switching chats loads that chat's draft rather than carrying one
          across. */}
      <MessageComposer
        accountId={accountId}
        chatId={chat.id}
        fanName={chat.fan.name}
        canSend={chat.canSendMessage}
        sending={sending}
        send={sendMessage}
        replyRequest={replyRequest}
        onReplyConsumed={() => setReplyRequest(null)}
      />
    </section>
  );
}

interface MessageListProps {
  messages: OFMessageRow[];
  timeZone?: string;
  onReply: (message: OFMessageRow) => void;
  setFlag: (messageId: string, flag: 'pinned' | 'liked', value: boolean) => Promise<boolean>;
}

function MessageGroups({ messages, timeZone, onReply, setFlag }: MessageListProps) {
  const rows: React.ReactNode[] = [];
  let lastDay = '';

  for (const message of messages) {
    const key = dayKey(message.createdAt, timeZone);
    if (key !== lastDay) {
      lastDay = key;
      rows.push(
        <div key={`day-${key}`} className="my-4 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.07]" />
          <span className="text-xs text-zinc-400">
            {formatDayLabel(message.createdAt, timeZone)}
          </span>
          <span className="h-px flex-1 bg-white/[0.07]" />
        </div>,
      );
    }
    rows.push(
      <MessageBubble
        key={message.id}
        message={message}
        timeZone={timeZone}
        onReply={onReply}
        setFlag={setFlag}
      />,
    );
  }

  return <div className="space-y-2">{rows}</div>;
}

function MessageBubble({
  message,
  timeZone,
  onReply,
  setFlag,
}: {
  message: OFMessageRow;
  timeZone?: string;
  onReply: (message: OFMessageRow) => void;
  setFlag: (messageId: string, flag: 'pinned' | 'liked', value: boolean) => Promise<boolean>;
}) {
  return (
    <div
      // `group/message` is named so the action trigger's reveal cannot be fired
      // by any other group wrapper that ends up around a bubble later.
      className={cn('group/message flex', message.fromMe ? 'justify-end' : 'justify-start')}
    >
      {/* An optimistic bubble has no provider id yet, so none of its actions
          would resolve — the menu appears with the real message a moment later. */}
      {!message.pending && (
        <MessageActions
          message={message}
          fromMe={message.fromMe}
          onReply={onReply}
          setFlag={setFlag}
        />
      )}

      {/* 75% of a wide window runs past 120ch; the rem cap holds the line length
          in the readable band without shrinking bubbles on a narrow one. */}
      <div className="min-w-0 max-w-[min(75%,34rem)]">
        {message.isTip ? (
          <TipBubble message={message} />
        ) : (
          <div
            className={cn(
              'rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words',
              message.fromMe
                ? 'bg-[#3b82f6]/15 border border-[#3b82f6]/30 text-foreground'
                : 'bg-white/[0.04] border border-white/[0.07] text-foreground',
            )}
          >
            {message.text ||
              (message.mediaCount > 0 ? null : <span className="text-zinc-400">—</span>)}

            <MessageAttachments message={message} />

            {/* PPV price sits on the bubble, not the tile: it is a property of
                the message, and a four-photo set would otherwise repeat it four
                times. Orange is the semantic "awaiting" hue, green "paid" (§2).
                Tips never reach here — `price` means something else on those. */}
            {message.price > 0 && (
              <span
                className={cn(
                  'mt-1.5 flex items-center gap-1.5 border-t border-white/[0.07] pt-1.5 text-xs tabular-nums',
                  message.isOpened ? 'text-green-400' : 'text-orange-400',
                )}
              >
                {message.isOpened ? <LockOpen className="size-3" /> : <Lock className="size-3" />}
                {formatMoney(message.price)} {message.isOpened ? 'unlocked' : 'locked'}
              </span>
            )}
          </div>
        )}

        <div
          className={cn(
            'mt-1 flex items-center gap-2 px-1 text-[11px] text-zinc-400',
            message.fromMe ? 'justify-end' : 'justify-start',
          )}
        >
          <span className="tabular-nums">{formatClock(message.createdAt, timeZone)}</span>
          {message.pending && <span>Sending…</span>}
          {/* State marks, not decoration: each says the message carries a flag
              on OnlyFans itself. Both stay in Ink Secondary — neither is a
              status hue, and a red heart here would be colour as decoration. */}
          {message.isLiked && (
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3 fill-current" aria-hidden />
              <span className="sr-only">Liked</span>
            </span>
          )}
          {message.isPinned && (
            <span className="inline-flex items-center gap-1">
              <Pin className="size-3" aria-hidden />
              Pinned
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A tip — the one moment in this window that is unambiguously good news.
 *
 * **What was wrong.** `price` carries the *tip amount* on a tip message (the
 * provider has no separate field), so the shared PPV row rendered a $50 tip as
 * "$50 locked" — not merely ugly, false. And the amount never appeared at all:
 * the footer said "Tip" and nothing else, so the single number an operator most
 * wants to see was the one thing the thread would not show them.
 *
 * **Why it looks like this.** A tip is not speech, so it does not get a speech
 * bubble; it is an event, and it reads as one. The amount is the content, so it
 * is set at display size with the digits carrying the line and the `$` stepped
 * down beside them — the way money is typeset when someone means it. The fan's
 * note hangs below a hairline as what it is: words attached to the money, not a
 * message that happens to be green.
 *
 * **Why it does not celebrate.** Tips arrive all day, and this is a surface an
 * operator lives in for a whole shift — anything that animates would be charming
 * twice and irritating for the rest of the year. [DESIGN.md](../../../../DESIGN.md)
 * also reserves celebration for exactly one screen (`/onboarding/done`) and says
 * in as many words not to extend that vocabulary, because its scarcity is the
 * point. So the delight here is entirely in the typesetting and the hierarchy,
 * which cost nothing to see for the thousandth time. Green is the existing
 * semantic "paid" hue (§2's tinted triad), not a new colour invented for this.
 */
function TipBubble({ message }: { message: OFMessageRow }) {
  const amount = message.tipAmount ?? 0;
  const { symbol, digits } = splitMoney(amount);

  return (
    <div className="rounded-xl border border-green-500/30 bg-green-500/[0.09] px-3.5 py-3">
      {/* One baseline, read as a sentence rather than a stat card: the digits
          are the loud part, "tip" trails them at label size. `items-baseline`
          is what keeps the three sizes sitting on one line instead of
          centring into a stack. */}
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-green-400">
        <HandCoins className="size-4 shrink-0 self-center" aria-hidden />
        {amount > 0 ? (
          <>
            <span className="text-[0.9375rem] font-medium opacity-70">{symbol}</span>
            <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums">
              {digits}
            </span>
            <span className="text-sm font-medium">tip</span>
          </>
        ) : (
          // The amount could not be read from the payload. Say "Tip" and stop —
          // rendering "$0" states a falsehood about money, which is the worse
          // failure by a distance.
          <span className="text-sm font-medium">Tip</span>
        )}
      </p>

      {message.text && (
        <p className="mt-2.5 border-t border-green-500/20 pt-2.5 text-sm whitespace-pre-wrap break-words text-foreground">
          {message.text}
        </p>
      )}

      <MessageAttachments message={message} />
    </div>
  );
}
