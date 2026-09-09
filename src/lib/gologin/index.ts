/**
 * GoLogin client factory — the one place a provider implementation is chosen.
 *
 * Server-only. Nothing under `src/lib/gologin/**` may be imported from a client
 * component: it reads `GL_API_TOKEN`.
 */
import 'server-only';
import { createGoLoginApiClient, PROFILES_PER_PAGE } from './providers/gologinApi';
import { GoLoginApiError, type IGoLoginClient } from './types';

export { GoLoginApiError, PROFILES_PER_PAGE };
export type { GoLoginProfile, GoLoginProfilePage, IGoLoginClient } from './types';

let client: IGoLoginClient | null = null;

export function getGoLoginClient(): IGoLoginClient {
  if (client) return client;
  const token = process.env.GL_API_TOKEN;
  if (!token) {
    // Fail closed and say which variable is missing — an empty profile list
    // would read as "you have no profiles", which is a different fact.
    throw new GoLoginApiError('GL_API_TOKEN is not configured.', 503);
  }
  client = createGoLoginApiClient(token);
  return client;
}
