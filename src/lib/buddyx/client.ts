/**
 * The BuddyX Public API client — **the only file that knows** the base URL, the
 * bearer header, the error envelope, pagination and the rate-limit buckets.
 *
 * Everything above this file (the sync service) asks for a path and gets typed
 * rows back. Swapping a host, a header or a pagination scheme is a change here
 * and nowhere else.
 *
 * ## Three rules this file holds
 *
 * - **Server only.** `BUDDYX_API_KEY` is read here and never leaves the server
 *   (rule 10). `import 'server-only'` makes a client import a build error
 *   rather than a leaked key.
 * - **Sequential.** One request at a time. At ~70 requests a run, parallelism
 *   buys nothing and makes the shared buckets harder to reason about.
 * - **Only the sync calls it.** A page read never reaches this file — the
 *   analytics routes read Firestore. That is what keeps the API's cost bounded
 *   by the cron cadence plus a cooled-down refresh button, not by traffic.
 *
 * Every request is counted (`requestCount`) so each sync run can record what it
 * cost in `buddyx-sync-runs`.
 */
import 'server-only';
import { BuddyxError } from './errors';
import { bucketsFor, drain, resync, take } from './rateLimit';
import type { BuddyxPage } from './types';

const BASE_URL = 'https://api.buddyx.app';

/** `limit` maximum the API allows on a list endpoint. */
export const PAGE_LIMIT = 200;

/** 429s retried before the run gives up on that request. */
const MAX_RATE_LIMIT_RETRIES = 3;

/** Network / 5xx retries — a transient blip should not fail a 70-request run. */
const MAX_TRANSIENT_RETRIES = 2;

/** Hard ceiling on pages for one paginated walk — a runaway cursor must end. */
const MAX_PAGES = 200;

let requestCounter = 0;

/** Requests made by this process since the counter was last reset. */
export function requestCount(): number {
  return requestCounter;
}

export function resetRequestCount(): void {
  requestCounter = 0;
}

export function isBuddyxConfigured(): boolean {
  return Boolean(process.env.BUDDYX_API_KEY);
}

type QueryValue = string | number | boolean | null | undefined;
export type BuddyxQuery = Record<string, QueryValue>;

function buildUrl(path: string, query: BuddyxQuery): string {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * One GET. Returns the parsed JSON body; throws `BuddyxError` for any error
 * envelope, and for a non-JSON failure (an HTML 502 from a proxy) with the
 * status preserved rather than masked by a parse error.
 */
export async function buddyxGet<T>(path: string, query: BuddyxQuery = {}): Promise<T> {
  const key = process.env.BUDDYX_API_KEY;
  if (!key) throw new BuddyxError('AUTH_MISSING', 'BUDDYX_API_KEY is not set on the server.', 0);

  const names = bucketsFor(path);
  const url = buildUrl(path, query);
  let rateLimitRetries = 0;
  let transientRetries = 0;

  for (;;) {
    await take(names);
    requestCounter += 1;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        cache: 'no-store',
      });
    } catch (err) {
      if (transientRetries++ < MAX_TRANSIENT_RETRIES) {
        await sleep(1000 * transientRetries);
        continue;
      }
      throw new BuddyxError('NETWORK_ERROR', err instanceof Error ? err.message : String(err), 0);
    }

    resync(names, res.headers);

    if (res.status === 429) {
      drain(names);
      if (rateLimitRetries++ >= MAX_RATE_LIMIT_RETRIES) {
        throw new BuddyxError('RATE_LIMIT_EXCEEDED', `Still rate-limited after ${MAX_RATE_LIMIT_RETRIES} retries`, 429);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 10) * 1000);
      continue;
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (res.ok && body !== null) return body as T;

    if (res.status >= 500 && transientRetries++ < MAX_TRANSIENT_RETRIES) {
      await sleep(1000 * transientRetries);
      continue;
    }

    const envelope = (body as { error?: { code?: string; message?: string; requestId?: string | null } } | null)?.error;
    throw new BuddyxError(
      envelope?.code ?? `HTTP_${res.status}`,
      envelope?.message ?? `Request failed: ${res.status}`,
      res.status,
      envelope?.requestId ?? null,
    );
  }
}

/**
 * Walk a cursor-paginated list endpoint to completion, `limit=200` per page.
 *
 * `INVALID_CURSOR` restarts the walk **once** from the first page, as the API
 * asks; the rows already yielded are yielded again, so callers must treat rows
 * by id (every caller here upserts on id, so a repeat is harmless). A second
 * `INVALID_CURSOR` throws.
 *
 * Completion matters to the caller: vanished-row detection only runs when every
 * page was read, so an exception from here must propagate rather than be
 * swallowed into a short list.
 */
export async function* buddyxPaginate<T>(path: string, query: BuddyxQuery = {}): AsyncGenerator<T> {
  let restarted = false;
  let cursor: string | null = null;
  let pages = 0;

  for (;;) {
    let page: BuddyxPage<T>;
    try {
      page = await buddyxGet<BuddyxPage<T>>(path, { ...query, limit: PAGE_LIMIT, cursor });
    } catch (err) {
      if (err instanceof BuddyxError && err.code === 'INVALID_CURSOR' && !restarted) {
        restarted = true;
        cursor = null;
        pages = 0;
        continue;
      }
      throw err;
    }

    for (const row of page.data ?? []) yield row;

    const next = page.pagination?.nextCursor ?? null;
    if (!next || page.pagination?.hasMore === false) return;
    if (++pages >= MAX_PAGES) {
      throw new BuddyxError('PAGINATION_LIMIT', `${path} exceeded ${MAX_PAGES} pages`, 0);
    }
    cursor = next;
  }
}

/** Collect a paginated walk into an array. */
export async function buddyxAll<T>(path: string, query: BuddyxQuery = {}): Promise<T[]> {
  const out: T[] = [];
  for await (const row of buddyxPaginate<T>(path, query)) out.push(row);
  return out;
}

/** Unwrap a `{ data: … }` response for the non-paginated endpoints. */
export async function buddyxData<T>(path: string, query: BuddyxQuery = {}): Promise<T> {
  const body = await buddyxGet<{ data: T }>(path, query);
  return body.data;
}
