import type { SnipRetention } from '@/lib/snips';

/**
 * A snip as the **owner's** page sees it.
 *
 * `id` is the share token (see `src/lib/snips.ts`), so this shape must never be
 * returned by a route that has not established the caller owns the row.
 */
export interface SnipRow {
  id: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, or null under a `never` retention. */
  expiresAt: string | null;
  width: number;
  height: number;
  bytes: number;
  /** The full public URL, built server-side from `PUBLIC_APP_ORIGIN`. */
  shareUrl: string;
  /** Stable, revocable image URL — `/api/public/snip/{id}/image`. */
  imageUrl: string;
}

/**
 * One page of the owner's library — the shape of `GET /api/snips`.
 *
 * `total` is the count of ready snips the user holds and is sent on the **first
 * page only** (null thereafter): the grid needs it once to say "24 of 118", and
 * recounting on every scroll would bill an aggregation read for a number that
 * has not moved.
 */
export interface SnipPage {
  snips: SnipRow[];
  /** Opaque; pass back as `?cursor=`. Null when the list is exhausted. */
  nextCursor: string | null;
  total: number | null;
}

/** What the public page may show a stranger holding the link. Nothing else. */
export interface PublicSnip {
  id: string;
  createdAt: string;
  width: number;
  height: number;
  /** The owner's `displayName`, or null if the account no longer resolves. */
  sharedBy: string | null;
  imageUrl: string;
}

/** The stored document. `snips/{shareId}`. */
export interface SnipDocument {
  ownerUid: string;
  storagePath: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  retention: SnipRetention;
}
