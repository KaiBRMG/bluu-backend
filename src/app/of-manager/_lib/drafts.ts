/**
 * Draft persistence for the composer.
 *
 * **This is the same rule as a failed send, extended in time: unsent work lives
 * in exactly one place.** The composer is that place, and this is its store — so
 * a draft is written as the operator types, restored when the thread re-opens,
 * and cleared only by a *confirmed* send. Nothing else may hold a copy.
 *
 * `localStorage`, not `sessionStorage`, because the failure this guards against
 * is the window being closed (or crashing) mid-sentence — a satellite window is
 * closed far more casually than the main one. It is scoped per account and chat.
 *
 * **Staged media is part of the draft.** A staged upload is a billed, single-use
 * provider id: dropping it on window close would mean paying to upload the same
 * file again. Persisting it costs nothing and is the same "keep the upload
 * across a failure" rule the send path already follows. Vault items carry no
 * cost either way and ride along for consistency.
 */

export interface DraftMedia {
  /** `ofapi_media_…` for a staged upload, a numeric id for vault media. */
  id: string;
  kind: 'upload' | 'vault';
  /** File name for an upload, media type for a vault item — what the chip shows. */
  label: string;
  type: string;
  /** Expiring CDN preview link for vault media; uploads have none. */
  previewUrl: string | null;
  /**
   * Which rendition `previewUrl` was taken from, so the chip asks the media
   * cache for the same one. Absent on drafts saved before this was recorded, and
   * on uploads — both fall back to `preview`, which is what the vault serves for
   * all but a handful of items.
   *
   * This is what lets a *restored* draft show its thumbnails again: the saved
   * link is blanked (it dies in minutes) but the media id survives, and the cache
   * can answer from the id alone once the file has been seen once.
   */
  previewVariant?: 'preview' | 'thumb';
  width: number | null;
  height: number | null;
}

/**
 * The message this draft replies to.
 *
 * `text` is kept alongside the id purely so the quote strip can render without
 * the replied-to message still being in the loaded page — an operator can reply
 * to something, scroll, and have history collapse back to page one under them.
 */
export interface DraftReply {
  id: string;
  text: string;
  fromMe: boolean;
}

export interface Draft {
  text: string;
  media: DraftMedia[];
  /** 0 when the message is free. */
  price: number;
  /** Ids within `media` that stay visible outside the paywall. */
  previewIds: string[];
  lockedText: boolean;
  /** Null for an ordinary message. Unsent, so it belongs here and nowhere else. */
  replyTo: DraftReply | null;
}

export const EMPTY_DRAFT: Draft = {
  text: '',
  media: [],
  price: 0,
  previewIds: [],
  lockedText: false,
  replyTo: null,
};

const key = (accountId: string | null, chatId: string) =>
  `bluu_of_draft_v1:${accountId ?? 'unknown'}:${chatId}`;

/**
 * A reply target alone is not worth persisting — nothing has been written yet,
 * and restoring a bare "replying to…" strip on a thread the operator moved on
 * from is noise. It rides along once there is actual content.
 */
export function isEmptyDraft(draft: Draft): boolean {
  return draft.text.trim() === '' && draft.media.length === 0;
}

export function loadDraft(accountId: string | null, chatId: string): Draft {
  try {
    const raw = localStorage.getItem(key(accountId, chatId));
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      media: Array.isArray(parsed.media) ? parsed.media : [],
      price: typeof parsed.price === 'number' ? parsed.price : 0,
      previewIds: Array.isArray(parsed.previewIds) ? parsed.previewIds : [],
      lockedText: parsed.lockedText === true,
      replyTo: parsed.replyTo?.id ? parsed.replyTo : null,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(accountId: string | null, chatId: string, draft: Draft): void {
  try {
    if (isEmptyDraft(draft)) {
      localStorage.removeItem(key(accountId, chatId));
      return;
    }
    localStorage.setItem(
      key(accountId, chatId),
      JSON.stringify({
        ...draft,
        // Never persist a CDN link. A vault item's preview URL is signed,
        // IP-locked and dead inside a minute — the same rule `stripMediaUrls`
        // applies to the Firestore mirror. A restored chip therefore shows its
        // type and label rather than a thumbnail, which is the honest state; the
        // *id*, which is what actually gets sent, is durable.
        media: draft.media.map((m) => ({ ...m, previewUrl: null })),
      }),
    );
  } catch {
    // Quota or private mode. A lost draft is a worse day, not a broken window —
    // the composer's in-memory state is unaffected.
  }
}

export function clearDraft(accountId: string | null, chatId: string): void {
  try {
    localStorage.removeItem(key(accountId, chatId));
  } catch {
    // ignore
  }
}
