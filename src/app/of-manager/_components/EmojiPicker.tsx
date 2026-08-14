'use client';

import { useState } from 'react';
import { Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EMOJI_GROUPS } from '../_lib/emoji';

/**
 * The composer's emoji picker.
 *
 * A `Popover` over a curated list rather than a picker library — see
 * `_lib/emoji.ts` for why the set is short. It stays **open** after a pick,
 * because emoji arrive in threes ("🔥🔥🔥") and closing after each one makes the
 * common case three round trips through the trigger.
 */
export default function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label="Insert emoji"
          className="size-8 text-zinc-400 hover:text-white"
        >
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-72 w-72 overflow-y-auto overscroll-contain border-white/[0.07] bg-[#171717] p-2"
      >
        {EMOJI_GROUPS.map((group) => (
          <section key={group.name} className="mb-2 last:mb-0">
            <h3 className="mb-1 px-1 text-xs text-zinc-400">{group.name}</h3>
            <div className="grid grid-cols-8 gap-0.5">
              {group.emoji.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onPick(emoji)}
                  aria-label={emoji}
                  className="flex size-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
      </PopoverContent>
    </Popover>
  );
}
