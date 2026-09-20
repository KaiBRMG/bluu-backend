import type { SnipKind, SnipRetention } from '@/lib/snips';

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
  /** A still or a recording. Absent on the wire is impossible — the server
   *  resolves it — but rows written before recording existed have no stored
   *  `kind` and read as `'image'`. */
  kind: SnipKind;
  /** Recordings only; null for a still. */
  durationMs: number | null;
  width: number;
  height: number;
  bytes: number;
  /** The full public URL, built server-side from `PUBLIC_APP_ORIGIN`. */
  shareUrl: string;
  /**
   * The **still** to render in a grid — the capture itself for an image, the
   * poster frame for a recording.
   *
   * Named for what it is used for rather than for what it points at, which is
   * why a recording has one at all: 24 `<video>` elements in a grid is 24 media
   * pipelines and 24 range-request storms, for cells the user is scanning. The
   * poster is a PNG like any other and costs one `<img>`.
   *
   * Null only for a recording whose poster upload failed — the card falls back
   * to a placeholder rather than an empty box.
   */
  imageUrl: string | null;
  /**
   * The thing itself: the PNG for a still, the WebM for a recording. This is
   * what the public page shows at full size.
   */
  mediaUrl: string;
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
  kind: SnipKind;
  durationMs: number | null;
  width: number;
  height: number;
  /** The owner's `displayName`, or null if the account no longer resolves. */
  sharedBy: string | null;
  /** The poster frame for a recording, the image itself for a still, or null
   *  when a recording has no poster. Used as `<video poster>`. */
  imageUrl: string | null;
  mediaUrl: string;
}

/** The stored document. `snips/{shareId}`. */
export interface SnipDocument {
  ownerUid: string;
  storagePath: string;
  /** Recordings only — the poster frame's own object. Absent for a still, and
   *  absent for a recording whose poster never landed. */
  posterPath?: string;
  contentType: string;
  kind?: SnipKind;
  durationMs?: number;
  width: number;
  height: number;
  bytes: number;
  retention: SnipRetention;
}
