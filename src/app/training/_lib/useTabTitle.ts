'use client';

import { useEffect, useId } from 'react';

/**
 * Who is asking for the tab title right now, in the order they last changed it.
 * Several components may want it at once — the module page ("T2 is open") and the
 * room's clock — and a component that mounts or unmounts must not leave behind
 * whatever another one had set. The page's own title is read once, when the first
 * owner arrives, and put back when the last one leaves.
 */
const owners = new Map<string, string>();
let base: string | null = null;

function apply() {
  if (owners.size === 0) {
    if (base !== null) document.title = base;
    base = null;
    return;
  }
  if (base === null) base = document.title;
  document.title = [...owners.values()].pop()!;
}

/**
 * Puts a line in the browser tab's title while it is set, and puts the page's
 * own title back when nobody is setting one. A candidate works in other windows;
 * the tab strip is the one place this page can still reach them.
 */
export function useTabTitle(title: string | null) {
  const id = useId();

  useEffect(() => {
    owners.delete(id); // re-adding moves it to the end: the most recent change wins
    if (title !== null) owners.set(id, title);
    apply();
  }, [id, title]);

  useEffect(
    () => () => {
      owners.delete(id);
      apply();
    },
    [id],
  );
}
