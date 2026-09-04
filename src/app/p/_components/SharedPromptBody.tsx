'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * The prompt text, plus the one thing a recipient actually came to do.
 *
 * `dangerouslySetInnerHTML` is safe here for the same reason it is safe in the
 * detail card: `sanitizePromptHtml` runs on the server at write AND again on
 * read, and the dialect strips every attribute except one — a `<mark>`'s
 * highlight class, which is not copied from the input but re-emitted from the
 * five literals in `promptHtml.ts`. There is no `href`, `style`, `src` or `on*`
 * left for anything to hide in. Do not widen that dialect to serve this page.
 *
 * Copy takes the PLAIN text, never the HTML. `text` is the canonical
 * representation (the rich layer is presentation), and a prompt pasted into a
 * model with `<b>` tags around it is a broken prompt.
 */
export function SharedPromptBody({ html, text }: { html: string; text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No toast provider on this page, and a failed copy is self-evident —
      // the text is right there and selectable.
    }
  };

  return (
    <section aria-label="Prompt text" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Prompt</h2>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.09] px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-white/[0.16] hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
        >
          {copied ? (
            <Check className="size-3.5 text-[#4ade80]" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>

      {/* The mark styling mirrors RichPromptEditor exactly, and for the same two
          reasons: `font-normal` is load-bearing because globals.css sets
          `body { font-weight: 500 }` (so unstyled text already reads as bold),
          and the text-stroke backs up `font-black` because Google Sans may ship
          no 900 face and a missing weight is silently served as the nearest one.
          A shared prompt must render identically to the one in the app. */}
      <div
        className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 font-mono text-sm font-normal leading-relaxed text-zinc-100 [&_b]:font-black [&_b]:text-white [&_b]:[-webkit-text-stroke:0.4px_currentColor] [&_li]:ml-5 [&_li]:list-disc [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-black [&_strong]:text-white [&_strong]:[-webkit-text-stroke:0.4px_currentColor] [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {/* Announced once, for the copy button's result — the button label itself
          changes, but a screen reader focused on it is not guaranteed to
          re-announce. */}
      <p aria-live="polite" className="sr-only">
        {copied ? 'Prompt copied to the clipboard.' : ''}
      </p>
    </section>
  );
}
