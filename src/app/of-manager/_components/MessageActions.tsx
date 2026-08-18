'use client';

import { useState } from 'react';
import { Copy, Heart, HeartOff, MoreHorizontal, Pin, PinOff, Reply } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { OFMessageRow } from '@/hooks/useOnlyFansMessages';

/**
 * The per-message action menu.
 *
 * **This is the provider's entire per-message surface**, and the list is short
 * for a reason worth writing down: `/messages/{id}` is GET-only apart from
 * pin/unpin and like/unlike, so **there is no unsend and no edit**. Do not
 * design a delete affordance for a sent message here later — it cannot be built.
 *
 * A menu rather than a row of inline buttons. Four affordances × several hundred
 * messages is a lot of DOM in a container that is already the heaviest thing in
 * this window, and three of the four are rare. One trigger per bubble keeps the
 * thread cheap and leaves room for the fifth action whenever the provider grows
 * one.
 *
 * The trigger is revealed on hover **and** on keyboard focus, and it stays
 * visible while its menu is open — a control that vanished under its own popover
 * would read as the menu having lost its anchor.
 */

interface MessageActionsProps {
  message: OFMessageRow;
  /** Aligns the trigger to the outside edge of the bubble it belongs to. */
  fromMe: boolean;
  onReply: (message: OFMessageRow) => void;
  /** Resolves false when the provider refused; the flag has already been reverted. */
  setFlag: (messageId: string, flag: 'pinned' | 'liked', value: boolean) => Promise<boolean>;
}

export default function MessageActions({
  message,
  fromMe,
  onReply,
  setFlag,
}: MessageActionsProps) {
  const [open, setOpen] = useState(false);

  const pinned = message.isPinned === true;
  const liked = message.isLiked === true;
  const canPin = message.canBePinned !== false;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      toast.success('Message copied');
    } catch {
      toast.error('Could not copy the message');
    }
  };

  /**
   * These two do toast their success, unlike a send.
   *
   * The send exception exists because the bubble landing in the thread *is* the
   * confirmation and it fires every few seconds. A pin is rare and its only
   * visible result is one small icon changing state at the far end of a long
   * message — easy to miss, and easy to mistake for having missed the click.
   */
  const flag = async (kind: 'pinned' | 'liked', value: boolean) => {
    const ok = await setFlag(message.id, kind, value);
    if (!ok) {
      toast.error(kind === 'pinned' ? 'Could not change the pin' : 'Could not change the like');
      return;
    }
    toast.success(
      kind === 'pinned'
        ? value
          ? 'Message pinned'
          : 'Message unpinned'
        : value
          ? 'Message liked'
          : 'Like removed',
    );
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Message actions"
          className={cn(
            // Colour and opacity only. A `filter` here would promote and
            // re-rasterise the bubble on every hover, which is the same tearing
            // the chat rows were fixed for.
            'flex size-6 shrink-0 items-center justify-center self-center rounded-md text-zinc-400 opacity-0 transition-[opacity,color]',
            'hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]',
            'group-hover/message:opacity-100',
            open && 'opacity-100',
            // Always on the *outside* edge of the bubble, so it never covers
            // text: left of our own messages, right of the fan's. The trigger is
            // first in the DOM either way — reordering it visually rather than
            // in markup keeps it before the bubble for a screen reader, where
            // "actions for the following message" is the useful order.
            fromMe ? 'mr-1' : 'order-last ml-1',
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={fromMe ? 'end' : 'start'}
        className="w-44 border-white/[0.07] bg-[#171717]"
      >
        <DropdownMenuItem onSelect={() => onReply(message)}>
          <Reply className="size-4" />
          Reply
        </DropdownMenuItem>

        {message.text && (
          <DropdownMenuItem onSelect={copy}>
            <Copy className="size-4" />
            Copy text
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator className="bg-white/[0.07]" />

        <DropdownMenuItem onSelect={() => flag('liked', !liked)}>
          {liked ? <HeartOff className="size-4" /> : <Heart className="size-4" />}
          {liked ? 'Remove like' : 'Like'}
        </DropdownMenuItem>

        {/* Disabled rather than hidden: "this message cannot be pinned" is a
            fact about the message, and a menu whose items move between fans is
            harder to use than one with a greyed row. */}
        <DropdownMenuItem disabled={!canPin} onSelect={() => flag('pinned', !pinned)}>
          {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          {pinned ? 'Unpin' : 'Pin'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
