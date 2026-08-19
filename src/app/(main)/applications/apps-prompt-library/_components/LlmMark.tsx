'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { usePromptLibrary } from '@/contexts/PromptLibraryContext';
import { llmLogoCandidates, type LlmType } from '@/types/promptLibrary';

/**
 * A third-party brand mark, rendered through `next/image` — the same escape
 * hatch the sidebar uses for the OnlyFans SVG, since these have no lucide
 * equivalent and `Avatar` is for people.
 *
 * The five built-in marks are pre-normalised by
 * scripts/build-prompt-library-logos.js: every one is white or brand-coloured
 * on transparency, trimmed and re-padded to the same optical weight, so no
 * per-logo CSS correction is needed here.
 *
 * A model someone ADDED has no registered asset. Rather than requiring a code
 * change, this walks the candidate paths for its id — `<id>.webp` then
 * `<id>.png` — and falls through to a monogram when neither resolves. Committing
 * `public/prompt-library-llm-logos/<id>.png` is therefore the whole job: the
 * next load picks it up with nothing else to change.
 */
export function LlmMark({ llm, size = 24, className }: {
  llm: LlmType;
  size?: number;
  className?: string;
}) {
  const { modelsById } = usePromptLibrary();
  const model = modelsById[llm];
  const candidates = useMemo(() => llmLogoCandidates(model), [model]);

  // Reset by key when the candidate set changes, so a model that gains an asset
  // is not held on a stale failure from a previous render.
  const [attempt, setAttempt] = useState(0);
  const src = candidates[attempt];

  if (!src) {
    return <LlmMonogram name={model?.name ?? llm} size={size} className={className} />;
  }

  return (
    <Image
      key={candidates.join('|')}
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
      // The optimizer 404s on a mark nobody has committed yet; step to the next
      // candidate, then to the monogram.
      onError={() => setAttempt(a => a + 1)}
      unoptimized={!model?.logo}
      priority={size >= 40}
    />
  );
}

/** The stand-in for a model with no committed mark. Reads as an initial, not a
 *  broken image, and keeps every row the same height as one with a logo. */
function LlmMonogram({ name, size, className }: {
  name: string;
  size: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-[25%] bg-white/[0.08] font-semibold uppercase leading-none text-zinc-300 ${className ?? ''}`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.5)) }}
    >
      {/* Spread, not charAt: a name starting with an emoji or any astral
          character would otherwise be cut mid-surrogate-pair and render as
          tofu — and coining a model is a one-field action open to anyone. */}
      {[...name.trim()][0] ?? '?'}
    </span>
  );
}

/**
 * Every model a prompt targets, in one strip.
 *
 * A prompt can now carry many models, so the row's width is variable — which is
 * why the callers place this at the END of a row rather than the start: a
 * leading element of unpredictable width would make every title start at a
 * different x.
 */
export function LlmMarks({ llms, size = 16, max = 4, className }: {
  llms: LlmType[];
  size?: number;
  max?: number;
  className?: string;
}) {
  const { modelsById } = usePromptLibrary();
  if (llms.length === 0) return null;

  const shown = llms.slice(0, max);
  const overflow = llms.length - shown.length;
  const label = llms.map(id => modelsById[id]?.name ?? id).join(', ');

  return (
    <span className={`inline-flex shrink-0 items-center gap-1 ${className ?? ''}`} title={label}>
      <span className="sr-only">{label}</span>
      {shown.map(id => (
        <LlmMark key={id} llm={id} size={size} />
      ))}
      {overflow > 0 && (
        <span
          aria-hidden
          className="text-[10px] font-medium tabular-nums text-zinc-400"
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
