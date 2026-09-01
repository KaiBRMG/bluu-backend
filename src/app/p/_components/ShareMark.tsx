'use client';

import { useState } from 'react';
import { llmLogoCandidates, type PromptModel } from '@/types/promptLibrary';

/**
 * The public page's model mark.
 *
 * A separate component from `LlmMark` on purpose: that one reads
 * `PromptLibraryContext` for the model list, and this page has no provider —
 * the model arrives fully resolved in the payload. The candidate walk and the
 * monogram fallback are the same idea, so a model whose asset nobody has
 * committed renders as an initial here too rather than as a broken image.
 *
 * A plain `<img>` rather than `next/image`: the optimizer would 404 on
 * user-added marks, and these are 14–16px decorations on a single page.
 */
export function ShareMark({ model, size = 16 }: { model: PromptModel; size?: number }) {
  const candidates = llmLogoCandidates(model);
  const [attempt, setAttempt] = useState(0);
  const src = candidates[attempt];

  if (!src) {
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-[25%] bg-white/[0.08] font-semibold uppercase leading-none text-zinc-300"
        style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.5)) }}
      >
        {/* Spread, not charAt — a name starting with an astral character would
            otherwise be cut mid-surrogate-pair and render as tofu. */}
        {[...model.name.trim()][0] ?? '?'}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      style={{ width: size, height: size }}
      onError={() => setAttempt(a => a + 1)}
    />
  );
}
