'use client';

import Image from 'next/image';
import { LLM_META, type LlmType } from '@/types/promptLibrary';

/**
 * A third-party brand mark, rendered through `next/image` — the same escape
 * hatch the sidebar uses for the OnlyFans SVG, since these have no lucide
 * equivalent and `Avatar` is for people.
 *
 * The source files are pre-normalised by scripts/build-prompt-library-logos.js:
 * every mark is white or brand-coloured on transparency, trimmed and re-padded
 * to the same optical weight, so no per-logo CSS correction is needed here.
 */
export function LlmMark({ llm, size = 24, className }: {
  llm: LlmType;
  size?: number;
  className?: string;
}) {
  const meta = LLM_META[llm];
  return (
    <Image
      src={meta.logo}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
      // Five small marks, all above the fold on the home screen.
      priority={size >= 40}
    />
  );
}
