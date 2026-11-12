/**
 * OnlyMonster statements — **read-only payout balances** (migration plan §12, Phase 7).
 *
 * A separate module with a separate key, on purpose: the `onlyfans.statements`
 * permission grants reading balances **and creating payouts**, and creating a
 * payout is irreversible with no idempotency on OnlyFans' side. So:
 *
 * - The key (`ONLYMONSTER_STATEMENTS_KEY`) is read only here, never by `client.ts`.
 * - **GET only**, and only the two listing paths below. The payout-creation endpoint
 *   (a POST on the same path) is unreachable from this codebase, permanently.
 * - `/proxy/` endpoints share **1 request per second per platform account**, so calls
 *   are sequential and spaced, at most once per scheduled run.
 */
import 'server-only';
import { OnlyMonsterError } from './errors';

const BASE_URL = 'https://omapi.onlymonster.ai';
const ALLOWED = /^\/proxy\/v0\/platforms\/onlyfans\/accounts\/\d+\/statements\/(balances|payout-requests)$/;
const SPACING_MS = 1100;
let lastCallAt = 0;

export function isStatementsConfigured(): boolean {
  return Boolean(process.env.ONLYMONSTER_STATEMENTS_KEY);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function statementsGet<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
  if (!ALLOWED.test(path)) throw new OnlyMonsterError('PATH_NOT_ALLOWED', `${path} is not a statements read path`, 0);
  const key = process.env.ONLYMONSTER_STATEMENTS_KEY;
  if (!key) throw new OnlyMonsterError('AUTH_MISSING', 'ONLYMONSTER_STATEMENTS_KEY is not set on the server.', 0);
  const wait = SPACING_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { method: 'GET', headers: { 'x-om-auth-token': key, Accept: 'application/json' }, cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (res.ok && body) return body as T;
  throw new OnlyMonsterError(body?.code ?? `HTTP_${res.status}`, body?.message ?? `Request failed: ${res.status}`, res.status, body?.details?.required_permission ?? null);
}
