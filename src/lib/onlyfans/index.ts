/**
 * OnlyFans adapter entry point.
 *
 * `getOnlyFansClient()` is the ONLY way the app obtains an OnlyFans client, and
 * `IOnlyFansClient` is the only type it hands back — so replacing the provider
 * is a one-line change here plus a new file under `providers/`.
 *
 * Server-only (reads `ONLYFANSAPI_API_KEY`). Importing this from a client
 * component would leak the key into the browser bundle.
 */
import { OnlyFansApiClient } from './providers/onlyfansApi';
import { OnlyFansApiError, type IOnlyFansClient } from './types';

export * from './types';

let client: IOnlyFansClient | null = null;

export function getOnlyFansClient(): IOnlyFansClient {
  if (client) return client;
  const apiKey = process.env.ONLYFANSAPI_API_KEY;
  if (!apiKey) {
    throw new OnlyFansApiError('ONLYFANSAPI_API_KEY is not configured', 500);
  }
  client = new OnlyFansApiClient(apiKey);
  return client;
}

// ─── Account resolution ─────────────────────────────────────────────
//
// This iteration operates exactly ONE account (the linked test account). The id
// is resolved once per server instance and cached for an hour: `/api/accounts`
// costs provider credits and the answer changes about never.
//
// `ONLYFANS_ACCOUNT_ID` pins it explicitly. Without it we take the first
// authenticated account, which is correct while exactly one is linked — set the
// env var before linking a second, or the choice becomes arbitrary.

const ACCOUNT_TTL_MS = 60 * 60 * 1000;
let cachedAccountId: string | null = null;
let cachedAccountAt = 0;

export async function resolveAccountId(): Promise<string> {
  const pinned = process.env.ONLYFANS_ACCOUNT_ID;
  if (pinned) return pinned;

  if (cachedAccountId && Date.now() - cachedAccountAt < ACCOUNT_TTL_MS) {
    return cachedAccountId;
  }

  const accounts = await getOnlyFansClient().listAccounts();
  const account = accounts.find((a) => a.isAuthenticated) ?? accounts[0];
  if (!account) {
    throw new OnlyFansApiError('No OnlyFans account is linked to this API key', 502);
  }

  cachedAccountId = account.id;
  cachedAccountAt = Date.now();
  return account.id;
}

/** Test seam / webhook path: drop the memoised account id. */
export function invalidateAccountCache(): void {
  cachedAccountId = null;
  cachedAccountAt = 0;
}
