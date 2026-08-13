'use client';

import { Fragment, useMemo } from 'react';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Marks the searched terms inside a string. Uses a white-overlay wash rather
 * than a colour: a search hit is not a status, so under the Semantic-Only Rule
 * it does not get a hue.
 */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => {
    const usable = terms.filter(t => t.length > 1);
    if (usable.length === 0 || !text) return [{ text, hit: false }];

    // Longest first, so "image generation" wins over "image" at the same offset.
    const ordered = [...usable].sort((a, b) => b.length - a.length);
    const lookup = new Set(ordered.map(t => t.toLowerCase()));
    const re = new RegExp(`(${ordered.map(escapeRegExp).join('|')})`, 'gi');

    return text
      .split(re)
      .filter(chunk => chunk !== '')
      .map(chunk => ({ text: chunk, hit: lookup.has(chunk.toLowerCase()) }));
  }, [text, terms]);

  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.hit ? (
            <mark className="rounded-[3px] bg-white/[0.14] px-0.5 text-white">{part.text}</mark>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
    </>
  );
}
