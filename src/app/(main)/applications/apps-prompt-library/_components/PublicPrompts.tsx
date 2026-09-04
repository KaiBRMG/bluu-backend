'use client';

import { useMemo, useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { promptShareUrl } from '@/lib/promptShareUrl';
import type { PromptDocument } from '@/types/promptLibrary';
import { LlmMarks } from './LlmMark';
import { relativeTime } from '../_lib/format';

/**
 * Every prompt currently readable by anyone holding a link.
 *
 * A flat list, not the category board: the question this section answers is
 * "what have we put on the open internet?", and grouping it by category would
 * scatter the answer. Newest-updated first, like every other surface here.
 *
 * **Archived prompts are excluded even when they still carry a share token.**
 * `getSharedPrompt` refuses an archived prompt, so its link already 404s — it
 * is not public, and listing it here would report exposure that does not exist.
 * The token is still on the document and comes back if the prompt is restored,
 * which is why "Stop sharing" lives on the detail card and archiving is not a
 * substitute for it.
 */
export function PublicPrompts({
  prompts,
  onOpen,
}: {
  prompts: PromptDocument[];
  onOpen: (id: string) => void;
}) {
  // Narrowed to a non-null `shareId` here rather than cast at the call site —
  // `Array.filter` does not narrow the element type on its own.
  const shared = useMemo(
    () =>
      prompts
        .flatMap(p => (p.shareId && !p.isArchived ? [{ prompt: p, shareId: p.shareId }] : []))
        .sort(
          (a, b) =>
            new Date(b.prompt.lastUpdatedTime).getTime() -
            new Date(a.prompt.lastUpdatedTime).getTime()
        ),
    [prompts]
  );

  if (shared.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        No prompts are shared publicly. Use <span className="text-zinc-300">Copy link</span> on a
        prompt to create a public, read-only page for it.
      </p>
    );
  }

  return (
    // A container, because this list is rendered at two very different widths —
    // full measure when it stacks under the board, and a 17rem rail beside it.
    // What the rows can afford to show follows the LIST's width, not the
    // window's: a `sm:` breakpoint would keep the copy button's label on a
    // desktop window however narrow the column it sits in had become.
    <ul className="@container/shared flex flex-col gap-1.5">
      {shared.map(({ prompt, shareId }) => (
        <li
          key={prompt.id}
          className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] pr-1.5 transition-colors hover:border-white/[0.12] hover:bg-white/[0.05]"
        >
          {/* Two sibling controls, never nested: a copy button inside the open
              button would be invalid markup and unreachable by keyboard. */}
          <button
            type="button"
            onClick={() => onOpen(prompt.id)}
            className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-zinc-100">{prompt.title}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
                {prompt.category && (
                  <>
                    <span className="truncate">{prompt.category}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span className="tabular-nums">v{prompt.version}</span>
                <span aria-hidden>·</span>
                <span className="truncate">{relativeTime(prompt.lastUpdatedTime)}</span>
              </span>
            </span>
            <LlmMarks llms={prompt.llmTypes} size={18} max={3} />
          </button>

          <CopyLinkButton shareId={shareId} title={prompt.title} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Copies the existing link. **No request** — the token is already on the head
 * document, so the URL is built locally rather than re-POSTing the share route
 * for a share that already exists.
 */
function CopyLinkButton({ shareId, title }: { shareId: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(promptShareUrl(shareId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      // Named for the row it belongs to — a list of identical "Copy link"
      // buttons is unusable from a screen reader's control list.
      aria-label={`Copy the public link for ${title}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
    >
      {copied ? (
        <Check className="size-3.5 text-green-400" aria-hidden />
      ) : (
        <Link2 className="size-3.5" aria-hidden />
      )}
      {/* Icon-only in the rail; the accessible name above carries the meaning
          either way, so nothing is lost when the label goes. */}
      <span className="hidden @min-[26rem]/shared:inline">{copied ? 'Copied' : 'Copy link'}</span>
    </button>
  );
}
