/**
 * `IGoLoginClient` implementation for **GoLogin** (api.gologin.com).
 *
 * This is the ONLY file in the repo that knows GoLogin's URLs, payload shapes or
 * auth scheme. Everything above it speaks the domain model in `../types.ts`.
 *
 * Server-only: it reads `GL_API_TOKEN`.
 *
 * ⚠ **The rate limit is not a soft limit.** GoLogin documents 300 req/min on
 * free/trial plans and 1200 on paid — and states that a 429 **permanently
 * revokes the API token**. That is why every caller above this file goes through
 * the memo + page cap in `gologinService.ts`, why paging here is strictly
 * sequential (never `Promise.all` over pages), and why nothing polls.
 */
import {
  GoLoginApiError,
  type GoLoginProfile,
  type GoLoginProfilePage,
  type IGoLoginClient,
} from '../types';

const BASE_URL = 'https://api.gologin.com';

/** The provider's own ceiling — `page` returns at most 30 profiles. */
export const PROFILES_PER_PAGE = 30;

/** Per-request budget. The list endpoint is a single small JSON document. */
const REQUEST_TIMEOUT_MS = 20_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

// ─── Normalisation ──────────────────────────────────────────────────

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** ISO 8601 → epoch ms, or null. The provider omits these on some profiles. */
function ms(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `os` is documented as an untyped object but ships as a plain string
 * (`"win"`, `"mac"`, `"lin"`, `"android"`) on every payload seen. Probe both
 * rather than assume — the same defensive posture `parseWebhookEvent` takes on
 * the OnlyFans adapter, and for the same reason: the spec is a starting guess.
 */
function readOs(raw: Raw): string {
  if (typeof raw.os === 'string') return raw.os;
  if (raw.os && typeof raw.os === 'object') {
    return str(raw.os.os) || str(raw.os.name) || str(raw.os.value);
  }
  return '';
}

/**
 * The proxy sub-object carries `username`/`password` in cleartext. Only the
 * three display facts cross this boundary; the credentials are dropped here and
 * therefore cannot leak to a renderer by omission somewhere upstream.
 */
function readProxy(raw: Raw): Pick<GoLoginProfile, 'proxyType' | 'proxyRegion' | 'proxyHost'> {
  const proxy: Raw = raw.proxy && typeof raw.proxy === 'object' ? raw.proxy : {};
  const type = str(raw.proxyType) || str(proxy.mode) || 'none';
  return {
    proxyType: type,
    proxyRegion: str(raw.proxyRegion) || str(proxy.autoProxyRegion),
    proxyHost: str(raw.host) || str(proxy.host),
  };
}

function normaliseProfile(raw: Raw): GoLoginProfile | null {
  const id = str(raw.id) || str(raw._id);
  if (!id) return null;
  return {
    id,
    name: str(raw.name),
    notes: str(raw.notes),
    os: readOs(raw),
    browserType: str(raw.browserType),
    ...readProxy(raw),
    isRunning: raw.isRunning === true,
    runningUserEmail: str(raw.runningUserEmail),
    folders: Array.isArray(raw.folders) ? raw.folders.filter((f: unknown) => typeof f === 'string') : [],
    createdAtMs: ms(raw.createdAt),
    updatedAtMs: ms(raw.updatedAt),
    lastActivityMs: ms(raw.lastActivity),
  };
}

// ─── Client ─────────────────────────────────────────────────────────

class GoLoginApiClient implements IGoLoginClient {
  constructor(private readonly token: string) {}

  private async request(path: string): Promise<Raw> {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch (err) {
      throw new GoLoginApiError(
        err instanceof Error && err.name === 'TimeoutError'
          ? 'GoLogin did not respond in time.'
          : 'Could not reach GoLogin.',
        504,
      );
    }

    if (response.status === 429) {
      // Loud on purpose: GoLogin invalidates the token on a 429, so this is not
      // a "back off and retry" condition — it means the key needs reissuing.
      console.error('[gologin] 429 — the API token may have been revoked by the provider');
      throw new GoLoginApiError('GoLogin rate limit hit — the API token may now be invalid.', 429);
    }
    if (response.status === 401 || response.status === 403) {
      throw new GoLoginApiError('GoLogin rejected the API token.', 502);
    }
    if (!response.ok) {
      throw new GoLoginApiError(`GoLogin returned ${response.status}.`, 502);
    }

    // A Cloudflare block answers HTML with a 200, so the content type is
    // checked rather than trusted — otherwise the parse error surfaces as a
    // meaningless "Unexpected token <".
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      throw new GoLoginApiError('GoLogin returned an unexpected response.', 502);
    }
    try {
      return (await response.json()) as Raw;
    } catch {
      throw new GoLoginApiError('GoLogin returned malformed JSON.', 502);
    }
  }

  async listProfiles(page: number): Promise<GoLoginProfilePage> {
    const body = await this.request(`/browser/v2?page=${Math.max(1, Math.floor(page))}`);
    const rows: unknown[] = Array.isArray(body.profiles) ? body.profiles : [];
    const profiles = rows
      .map((row) => (row && typeof row === 'object' ? normaliseProfile(row as Raw) : null))
      .filter((p): p is GoLoginProfile => p !== null);
    const total = typeof body.allProfilesCount === 'number' ? body.allProfilesCount : profiles.length;
    return { profiles, total };
  }
}

export function createGoLoginApiClient(token: string): IGoLoginClient {
  return new GoLoginApiClient(token);
}
