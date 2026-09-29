'use client';

import { useState } from 'react';
import { IconMailForward, IconX } from '@tabler/icons-react';
import { Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface InvitePromptCardProps {
  name: string;
  /** The applicant was already sent a link — this send rotates it. */
  resend: boolean;
  onSend: () => Promise<void>;
  onDismiss: () => void;
}

/**
 * "Email them their onboarding link?" — raised the moment an application is
 * approved.
 *
 * A card, not a modal: a reviewer approving a run of applicants should be able
 * to keep working the grid and answer the card when they choose, and a dialog
 * would steal focus on every approval. For the same reason it never takes focus
 * itself; the dialog role and its label announce it. Pinned to the viewport corner on the
 * banner layer, opaque (it floats over the photo grid, where the overlay recipe
 * would let photos bleed through its text).
 */
export function InvitePromptCard({ name, resend, onSend, onDismiss }: InvitePromptCardProps) {
  const [sending, setSending] = useState(false);
  const first = name.trim().split(/\s+/)[0] || name;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="invite-prompt-title"
      aria-describedby="invite-prompt-desc"
      className="fixed right-4 bottom-4 z-[var(--z-banner)] w-[min(24rem,calc(100vw-2rem))] animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-[#2a2a2a] bg-[#171717] p-4 duration-[120ms]"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-zinc-300" aria-hidden>
          <IconMailForward className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="invite-prompt-title" className="text-sm font-semibold text-white">
            {resend ? `Re-send ${first}’s onboarding link?` : `Email ${first} their onboarding link?`}
          </h2>
          <p id="invite-prompt-desc" className="mt-1 text-xs leading-relaxed text-zinc-400">
            Sends <span className="text-zinc-300">“Welcome to BLUU ROCK 🎉”</span> from hello@bluurock.com
            to the address on their application, with a personal link to their onboarding form.
            {resend && ' The previous link stops working.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mt-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.055] hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <IconX className="size-4" />
        </button>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDismiss} className="text-zinc-400 hover:text-white">
          Not now
        </Button>
        <Button
          size="sm"
          disabled={sending}
          onClick={async () => {
            setSending(true);
            try {
              await onSend();
            } finally {
              setSending(false);
            }
          }}
        >
          {sending && <Loader2Icon className="activity-spinner size-3.5 animate-spin" />}
          {sending ? 'Sending…' : resend ? 'Re-send email' : 'Send email'}
        </Button>
      </div>
    </div>
  );
}
