/**
 * Fan identity — who a fan is, and what we call them. Client-safe (no I/O).
 *
 * **A fan is one OnlyFans user across every creator**, keyed by their numeric
 * OnlyFans id (the `fanId` BuddyX sends on every sale). A fan known only from
 * a custom request whose profile link carries a handle instead of an id gets a
 * provisional key, `h_<handle>`, until someone links it to the id; numeric ids
 * never start with `h`, so the two spaces cannot collide.
 *
 * **The name has one resolution order**, applied everywhere a fan is shown:
 * a name set by hand → the name staff use on the fan's customs → the name a
 * BuddyX link list or the Infloww export carried → nothing (the id renders).
 * A manual name sticks until someone reverts it; nothing automatic overwrites it.
 *
 * Profile links pasted into customs look like `onlyfans.com/u598208266?rec=…`
 * or `onlyfans.com/somehandle?rec=…`. `rec` is a referral code — whoever shared
 * the link — and **never** the fan; it is ignored.
 */

import { CAMPAIGN_TYPES } from '../campaignTracking';
import { round2 } from '../salary/salaryEngine';

export type FanNameSource = 'manual' | 'customs' | 'buddyx' | 'infloww';

export const FAN_NAME_SOURCE_LABEL: Record<FanNameSource, string> = {
  manual: 'Set manually',
  customs: 'From customs',
  buddyx: 'From BuddyX',
  infloww: 'From Infloww',
};

/** Longest name accepted for a fan, manual or on a custom. */
export const FAN_NAME_MAX = 80;

export interface ParsedProfileLink {
  /** OnlyFans numeric user id, when the link carries one. */
  fanId: string | null;
  /** OnlyFans handle (lower-cased), when the link names one instead. */
  handle: string | null;
}

/** First path segments on onlyfans.com that are pages, not profiles. */
const RESERVED_SEGMENTS = new Set(['my', 'action', 'login', 'posts', 'search', 'notifications', 'chats', 'lists', 'bookmarks', 'subscriptions', 'settings', 'help', 'terms', 'privacy']);
const HANDLE_RE = /^[a-z0-9_.-]{2,40}$/i;
const ID_RE = /^\d{4,15}$/;

/**
 * Read a profile link (or a bare id / `u123` / `@handle`) into an OnlyFans
 * identity. `null` when the text is not an OnlyFans profile at all — a Fansly
 * link, a placeholder, an empty field.
 */
export function parseProfileLink(raw: string | null | undefined): ParsedProfileLink | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  // Bare forms first: an id, `u<id>`, `@handle`.
  if (ID_RE.test(text)) return { fanId: text, handle: null };
  const bareU = text.match(/^u(\d{4,15})$/i);
  if (bareU) return { fanId: bareU[1], handle: null };
  const at = text.match(/^@([a-z0-9_.-]{2,40})$/i);
  if (at) return { fanId: null, handle: at[1].toLowerCase() };

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'onlyfans.com') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  const uMatch = first.match(/^u(\d{4,15})$/i);
  if (uMatch) return { fanId: uMatch[1], handle: null };
  // A chat link's id is the fan's user id: /my/chats/chat/<id>
  if (first === 'my' && segments[1] === 'chats' && segments[2] === 'chat' && ID_RE.test(segments[3] ?? '')) {
    return { fanId: segments[3], handle: null };
  }
  if (!first || RESERVED_SEGMENTS.has(first.toLowerCase()) || !HANDLE_RE.test(first)) return null;
  return { fanId: null, handle: first.toLowerCase() };
}

/** The registry key for a parsed link: the id, else `h_<handle>`. */
export function fanKeyOf(parsed: ParsedProfileLink | null): string | null {
  if (!parsed) return null;
  if (parsed.fanId) return parsed.fanId;
  if (parsed.handle) return `h_${parsed.handle}`;
  return null;
}

export const isHandleKey = (key: string) => key.startsWith('h_');

/** A fan key is an id or `h_<handle>` — nothing else reaches Firestore as a doc id. */
export function isValidFanKey(key: string): boolean {
  if (ID_RE.test(key)) return true;
  return isHandleKey(key) && HANDLE_RE.test(key.slice(2));
}

/** The canonical profile link for a key — what the wizard writes onto a custom. */
export function profileLinkForKey(key: string): string {
  return isHandleKey(key) ? `https://onlyfans.com/${key.slice(2)}` : `https://onlyfans.com/u${key}`;
}

/** Trim and collapse whitespace; the stored spelling of a name. */
export function cleanFanName(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, FAN_NAME_MAX);
}

/**
 * The name staff use for a fan across their customs: the one that appears
 * most often (case-insensitive), and among equals the most recently used. The
 * returned spelling is the most recent one of the winning name.
 */
export function pickCustomsName(entries: Array<{ name: string | null | undefined; at: number }>): {
  name: string;
  votes: number;
  total: number;
} | null {
  const tally = new Map<string, { count: number; latestAt: number; spelling: string }>();
  let total = 0;
  for (const entry of entries) {
    const name = cleanFanName(entry.name);
    if (!name) continue;
    total += 1;
    const key = name.toLowerCase();
    const prev = tally.get(key);
    if (!prev) tally.set(key, { count: 1, latestAt: entry.at, spelling: name });
    else {
      prev.count += 1;
      if (entry.at >= prev.latestAt) {
        prev.latestAt = entry.at;
        prev.spelling = name;
      }
    }
  }
  let best: { count: number; latestAt: number; spelling: string } | null = null;
  for (const candidate of tally.values()) {
    if (!best || candidate.count > best.count || (candidate.count === best.count && candidate.latestAt > best.latestAt)) {
      best = candidate;
    }
  }
  return best ? { name: best.spelling, votes: best.count, total } : null;
}

/** The registry fields name resolution reads. */
export interface FanNameFields {
  manualName?: string | null;
  customsName?: string | null;
  /** The synced name (BuddyX link list or Infloww), and where it came from. */
  name?: string | null;
  source?: 'buddyx-link' | 'infloww' | string | null;
}

/** Manual → customs → synced → nothing. */
export function resolveFanName(doc: FanNameFields | null | undefined): { name: string | null; source: FanNameSource | null } {
  if (!doc) return { name: null, source: null };
  if (doc.manualName) return { name: doc.manualName, source: 'manual' };
  if (doc.customsName) return { name: doc.customsName, source: 'customs' };
  if (doc.name) return { name: doc.name, source: doc.source === 'infloww' ? 'infloww' : 'buddyx' };
  return { name: null, source: null };
}

/** The name a fan would have without the manual one — what "Revert to automatic" gives. */
export function automaticFanName(doc: FanNameFields | null | undefined) {
  return resolveFanName(doc ? { ...doc, manualName: null } : null);
}

// ─── Custom-request money ────────────────────────────────────────────

/** The custom fields the money rollup reads. */
export interface CustomMoneyFields {
  type: string;
  status: string;
  isArchived?: boolean;
  totalAmount: number;
  amountPaid: number;
  /** Stamped when a custom request is archived (archiving zeroes the balance). */
  originalTotalAmount?: number | null;
  /** Stamped when a campaign is archived (archiving marks it paid in full). */
  originalAmountPaid?: number | null;
}

/**
 * What a custom still owes, or what was given up on it.
 *
 * - **Outstanding** — a live custom (not archived, not rejected) paid below its total.
 * - **Abandoned** — archived without being paid in full. Archiving rewrites the
 *   figures (a custom's total drops to what was paid; a campaign's paid rises
 *   to the total), so the shortfall is only known where the original was kept.
 *   A custom request archived before that was recorded counts as abandoned
 *   with an unknown amount; a campaign archived then counts as paid, which is
 *   what archiving a campaign meant.
 * - **Collected** — what the fan actually paid. Not `amountPaid` on an archived
 *   campaign, which archiving raised to the total; its kept original is used.
 */
export function customMoney(entry: CustomMoneyFields): {
  outstanding: number;
  abandoned: boolean;
  abandonedAmount: number | null;
  rejected: boolean;
  collected: number;
} {
  const total = Number(entry.totalAmount) || 0;
  const paid = Number(entry.amountPaid) || 0;
  if ((CAMPAIGN_TYPES as readonly string[]).includes(entry.type)) {
    if (entry.isArchived) {
      const before = entry.originalAmountPaid;
      if (typeof before === 'number' && before < total) return { outstanding: 0, abandoned: true, abandonedAmount: round2(total - before), rejected: false, collected: before };
      return { outstanding: 0, abandoned: false, abandonedAmount: null, rejected: false, collected: paid };
    }
    return { outstanding: Math.max(0, round2(total - paid)), abandoned: false, abandonedAmount: null, rejected: false, collected: paid };
  }
  if (entry.status === 'Rejected') return { outstanding: 0, abandoned: false, abandonedAmount: null, rejected: true, collected: paid };
  if (entry.status === 'Archived') {
    const before = entry.originalTotalAmount;
    if (typeof before === 'number') {
      return before > paid
        ? { outstanding: 0, abandoned: true, abandonedAmount: round2(before - paid), rejected: false, collected: paid }
        : { outstanding: 0, abandoned: false, abandonedAmount: null, rejected: false, collected: paid };
    }
    return { outstanding: 0, abandoned: true, abandonedAmount: null, rejected: false, collected: paid };
  }
  return { outstanding: Math.max(0, round2(total - paid)), abandoned: false, abandonedAmount: null, rejected: false, collected: paid };
}
