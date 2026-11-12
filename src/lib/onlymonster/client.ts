/**
 * The OnlyMonster API client — **the only file that calls `omapi.onlymonster.ai`.**
 *
 * It knows the base URL, the `x-om-auth-token` header, the error body, the
 * three pagination schemes and the rate-limit buckets. Everything above it asks
 * for a path and gets typed rows back.
 *
 * ## Rules this file holds (CLAUDE.md rule 9l)
 *
 * - **GET only.** There is no non-GET request in this module, and none may be
 *   added. Write endpoints (mass messages, payouts, links, unsend) are real,
 *   non-idempotent actions on creators' accounts; they belong to a separate
 *   module with a separate key, behind explicit admin actions (plan §12).
 * - **Path allowlist.** `ALLOWED_PATHS` lists the read endpoints the sync uses.
 *   **No chat endpoint is reachable**: reading a chat through the API marks it
 *   read on OnlyFans, exactly as if the creator had opened it. No `/proxy/`
 *   endpoint either: those share a 1 req/s per-account limit and need a key
 *   with the statements permission, which can also create payouts.
 * - **Server only, sync only.** `import 'server-only'` makes a client import a
 *   build error rather than a leaked key. Page reads never reach this file;
 *   they read Firestore.
 * - **Sequential.** One request at a time through the token buckets.
 *
 * Every request is counted (`requestCount`), so each run records what it cost.
 */
import 'server-only';
import { OnlyMonsterError } from './errors';
import { drain, take } from './rateLimit';

const BASE_URL = 'https://omapi.onlymonster.ai';

/**
 * The read endpoints the sync may call. Anything else throws before the network
 * is touched. A later phase adds its endpoint here deliberately.
 */
const ALLOWED_PATHS: RegExp[] = [
  /^\/api\/v0\/accounts$/,
  /^\/api\/v0\/members$/,
  /^\/api\/v0\/users\/metrics$/,
  /^\/api\/v0\/platforms\/onlyfans\/accounts\/\d+\/(transactions|chargebacks|subscriptions|tracking-links|tracking-link-users|trial-links|trial-link-users|overview-metrics)$/,
  /^\/api\/v0\/accounts\/\d+\/mass-messages$/,
];

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_TRANSIENT_RETRIES = 2;
/** A runaway cursor must end. */
const MAX_PAGES = 500;

let requestCounter = 0;

export function requestCount(): number {
  return requestCounter;
}

export function resetRequestCount(): void {
  requestCounter = 0;
}

export function isOnlyMonsterConfigured(): boolean {
  return Boolean(process.env.ONLYMONSTER_API_KEY);
}

type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type OmQuery = Record<string, QueryValue>;

function buildUrl(path: string, query: OmQuery): string {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    // Array params are sent as repeated keys (OpenAPI `form`/`explode`), which
    // `/users/metrics` accepted for `creator_ids` in the probe.
    if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, String(v));
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * One GET. Returns the parsed JSON body. Throws `OnlyMonsterError` for any
 * error body, and for a non-JSON failure (an HTML 502 from a proxy) with the
 * status preserved rather than masked by a parse error.
 */
export async function omGet<T>(path: string, query: OmQuery = {}): Promise<T> {
  if (!ALLOWED_PATHS.some(re => re.test(path))) {
    throw new OnlyMonsterError('PATH_NOT_ALLOWED', `${path} is not on the client's read allowlist`, 0);
  }
  const key = process.env.ONLYMONSTER_API_KEY;
  if (!key) throw new OnlyMonsterError('AUTH_MISSING', 'ONLYMONSTER_API_KEY is not set on the server.', 0);

  const url = buildUrl(path, query);
  let rateLimitRetries = 0;
  let transientRetries = 0;

  for (;;) {
    await take(path);
    requestCounter += 1;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'x-om-auth-token': key, Accept: 'application/json' },
        cache: 'no-store',
      });
    } catch (err) {
      if (transientRetries++ < MAX_TRANSIENT_RETRIES) {
        await sleep(1000 * transientRetries);
        continue;
      }
      throw new OnlyMonsterError('NETWORK_ERROR', err instanceof Error ? err.message : String(err), 0);
    }

    if (res.status === 429) {
      drain(path);
      if (rateLimitRetries++ >= MAX_RATE_LIMIT_RETRIES) {
        throw new OnlyMonsterError('RATE_LIMIT_EXCEEDED', `Still rate-limited after ${MAX_RATE_LIMIT_RETRIES} retries`, 429);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) : 2) * 1000);
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

    const err = body as { code?: string; message?: string; details?: { required_permission?: string } } | null;
    throw new OnlyMonsterError(
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `Request failed: ${res.status}`,
      res.status,
      err?.details?.required_permission ?? null,
    );
  }
}

/**
 * Walk a cursor-paged list to completion. The cursor's field name differs per
 * endpoint (`/accounts` → `nextCursor`; `/transactions`, `/chargebacks` →
 * `cursor`) and so does the items key, so both are parameters.
 *
 * Completion matters to the caller: vanished-row detection only runs when every
 * page was read, so an exception must propagate rather than become a short list.
 */
export async function omPaginateCursor<T>(
  path: string,
  query: OmQuery,
  keys: { items: string; cursor: string } = { items: 'items', cursor: 'cursor' },
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let pages = 0; ; pages++) {
    if (pages >= MAX_PAGES) throw new OnlyMonsterError('PAGINATION_LIMIT', `${path} exceeded ${MAX_PAGES} pages`, 0);
    const body = await omGet<Record<string, unknown>>(path, { ...query, cursor });
    const items = (body[keys.items] as T[] | undefined) ?? [];
    out.push(...items);
    const next = body[keys.cursor];
    if (typeof next !== 'string' || !next) return out;
    cursor = next;
  }
}

/**
 * Walk an offset-paged list (`/members` ≤ 50, `/users/metrics` ≤ 100) until a short page.
 *
 * `itemsKey` may list several names: `/members` is documented as `users` but was seen
 * answering with `items` (2026-11-12), so the first one present wins. A body with none
 * of them is an error, never an empty list: a silent empty list would unmap people.
 */
export async function omPaginateOffset<T>(path: string, query: OmQuery, itemsKey: string | string[], limit: number): Promise<T[]> {
  const out: T[] = [];
  const keys = Array.isArray(itemsKey) ? itemsKey : [itemsKey];
  for (let pages = 0, offset = 0; ; pages++, offset += limit) {
    if (pages >= MAX_PAGES) throw new OnlyMonsterError('PAGINATION_LIMIT', `${path} exceeded ${MAX_PAGES} pages`, 0);
    const body = await omGet<Record<string, unknown>>(path, { ...query, offset, limit });
    const key = keys.find(k => Array.isArray(body[k]));
    if (!key) throw new OnlyMonsterError('UNEXPECTED_BODY', `${path} returned none of ${keys.join(' / ')} (keys: ${Object.keys(body).join(', ')})`, 0);
    const items = body[key] as T[];
    out.push(...items);
    if (items.length < limit) return out;
  }
}
