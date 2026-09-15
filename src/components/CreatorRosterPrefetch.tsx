'use client';

import { useCreators } from '@/hooks/useCreators';

/**
 * Warms the shared creator roster at app-shell mount.
 *
 * ## The waterfall this removes
 *
 * `useCreators` fetches lazily, from an effect that runs when the first
 * consumer mounts — and the first consumer is a `CreatorChip` inside a page
 * body. So the roster request could not even *start* until the RSC payload had
 * landed and the page had rendered, and the avatars could not start until the
 * roster came back. Three serial stages before a single face appeared, on a
 * calendar where thirty of them are the point of the screen.
 *
 * Mounting here moves stage one to the very beginning of the app session, where
 * it overlaps the route payload and the page's own data instead of queueing
 * behind them. By the time a chip mounts the roster is usually already in the
 * store, and the avatars — which are inlined in that same response — paint with
 * the first render of the page.
 *
 * ## The cost, and why it is acceptable
 *
 * This is one `/api/creators` query for every employee who opens the app,
 * including those who never see a creator (rule 9). It is bounded tightly:
 * the layout persists for the life of the renderer, so the effect fires **once
 * per app session**, not once per navigation — and in Electron a session runs
 * for days. Against that, it removes an entire round trip from every surface
 * that does show creators. The roster is also `sessionStorage`-cached, so a
 * reload usually costs nothing at all.
 *
 * Renders nothing. It exists only for the fetch its hook performs.
 */
export default function CreatorRosterPrefetch() {
  useCreators();
  return null;
}
