'use client';

import { useMemo } from 'react';
import { canRenderDiff, wordDiff } from '@/lib/promptDiff';

/**
 * Inline word-level diff of two prompt versions.
 *
 * Green additions and red deletions are a legitimate use of the semantic
 * palette — the hue encodes what happened to the words, not decoration — and
 * they carry a second, non-colour cue (underline vs strike-through) so the
 * distinction survives for colour-blind readers.
 */
export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(
    () => (canRenderDiff(before, after) ? wordDiff(before, after) : null),
    [before, after]
  );

  if (!parts) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        This prompt is too long to diff inline. The summary above still describes the change.
      </p>
    );
  }

  return (
    <p className="whitespace-pre-wrap p-4 font-mono text-sm leading-relaxed text-zinc-300">
      {parts.map((part, i) => {
        if (part.op === 'same') return <span key={i}>{part.text}</span>;
        if (part.op === 'added') {
          return (
            <ins
              key={i}
              className="rounded-[3px] bg-green-500/10 text-green-400 underline decoration-green-400/40 underline-offset-2"
            >
              {part.text}
            </ins>
          );
        }
        return (
          <del key={i} className="rounded-[3px] bg-red-500/10 text-red-400 line-through decoration-red-400/50">
            {part.text}
          </del>
        );
      })}
    </p>
  );
}

/** Legend for the diff colours — the colours alone are not a label. */
export function DiffLegend() {
  return (
    <p className="flex items-center gap-3 text-[11px] text-zinc-400">
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-full bg-green-400" aria-hidden />
        Added
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-2 rounded-full bg-red-400" aria-hidden />
        Removed
      </span>
    </p>
  );
}
