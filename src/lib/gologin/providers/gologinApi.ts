/**
 * `IGoLoginClient` implementation for **GoLogin** (api.gologin.com).
 *
 * This is the ONLY file in the repo that knows GoLogin's URLs, payload shapes or
 * auth scheme. Everything above it speaks the domain model in `../types.ts`.
 *
 * Server-only: it handles bearer tokens — the master `GL_API_TOKEN` and, since
 * the per-user rollout, operators' personal tokens decrypted out of Firestore.
 *
 * ⚠ **The rate limit is not a soft limit.** GoLogin documents 300 req/min on
 * free/trial plans and 1200 on paid — and states that a 429 **permanently
 * revokes the API token**. That is why every caller above this file goes through
 * the memo + page cap in `gologinService.ts`, why paging here is strictly
 * sequential (never `Promise.all` over pages), and why nothing polls.
 */
import {
  GoLoginApiError,
  isGoLoginProxyMode,
  type GoLoginAccountInfo,
  type GoLoginFolder,
  type GoLoginMember,
  type GoLoginMemberRole,
  type GoLoginProfile,
  type GoLoginProfileDetail,
  type GoLoginProfilePage,
  type GoLoginProxyInput,
  type GoLoginShareRole,
  type GoLoginWorkspace,
  type IGoLoginClient,
} from '../types';

const BASE_URL = 'https://api.gologin.com';

/** The provider's own ceiling — `page` returns at most 30 profiles. */
export const PROFILES_PER_PAGE = 30;

/** Per-request budget. Every endpoint used here is a single small JSON document. */
const REQUEST_TIMEOUT_MS = 20_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

// ─── Normalisation ──────────────────────────────────────────────────

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** ISO 8601 to epoch ms, or null. The provider omits these on some profiles. */
function ms(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
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

/**
 * ⚠ Every field NOT listed here is dropped on purpose. `/browser/v2` also
 * returns `sharedEmails` — every colleague a profile is shared with — plus
 * `permissions`, `navigator`, `fonts`, `webGLMetadata` and `facebookAccountData`
 * (which contains an account password). Assignment is read from folder
 * membership instead (`GoLoginFolder.profileIds`), which only the master token
 * can see, so no renderer ever needs `sharedEmails`.
 */
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
    folders: stringArray(raw.folders),
    createdAtMs: ms(raw.createdAt),
    updatedAtMs: ms(raw.updatedAt),
    lastActivityMs: ms(raw.lastActivity),
  };
}

/** `osSpec` ships as a string; `isM1` is the older spelling of Apple Silicon. */
function readOsSpec(raw: Raw): string {
  if (typeof raw.osSpec === 'string') return raw.osSpec;
  if (raw.osSpec && typeof raw.osSpec === 'object') return str(raw.osSpec.value) || str(raw.osSpec.name);
  return raw.isM1 === true ? 'M1' : '';
}

function obj(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
}

/**
 * The Edit panel's projection. Same boundary as `normaliseProfile`, one step
 * wider: fingerprint facts are read (to be *shown*, never edited), and the proxy
 * password is reduced to a boolean. `facebookAccountData`, `sharedEmails` and
 * `permissions` are still dropped.
 */
function normaliseProfileDetail(raw: Raw): GoLoginProfileDetail {
  const base = normaliseProfile(raw);
  if (!base) throw new GoLoginApiError('GoLogin returned a profile with no id.', 502);
  const navigator = obj(raw.navigator);
  const webgl = obj(raw.webGLMetadata);
  const proxy = obj(raw.proxy);
  const timezone = obj(raw.timezone);
  return {
    id: base.id,
    name: base.name,
    notes: base.notes,
    os: base.os,
    osSpec: readOsSpec(raw),
    browserType: base.browserType,
    userAgent: str(navigator.userAgent),
    resolution: str(navigator.resolution),
    language: str(navigator.language),
    platform: str(navigator.platform),
    hardwareConcurrency: num(navigator.hardwareConcurrency),
    deviceMemory: num(navigator.deviceMemory),
    webglVendor: str(webgl.vendor),
    webglRenderer: str(webgl.renderer),
    webRtcMode: str(obj(raw.webRTC).mode),
    canvasMode: str(obj(raw.canvas).mode),
    // GoLogin's default is to derive the zone from the proxy's IP, so only an
    // explicit `false` means it was pinned by hand.
    timezoneFromIp: timezone.fillBasedOnIp !== false,
    timezone: str(timezone.timezone),
    autoLang: raw.autoLang === true,
    proxy: {
      mode: str(proxy.mode) || str(raw.proxyType) || 'none',
      host: str(proxy.host) || str(raw.host),
      port: num(proxy.port) ?? num(raw.port),
      username: str(proxy.username),
      hasPassword: !!str(proxy.password),
    },
    folders: base.folders,
    isRunning: base.isRunning,
    createdAtMs: base.createdAtMs,
    updatedAtMs: base.updatedAtMs,
    lastActivityMs: base.lastActivityMs,
  };
}

function normaliseFolder(raw: Raw): GoLoginFolder | null {
  const id = str(raw.id) || str(raw._id);
  const name = str(raw.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    shared: raw.shared === true,
    profileIds: stringArray(raw.associatedProfiles),
    order: num(raw.order),
  };
}

/**
 * `GET /user` is a large document — subscription, card, feature flags, templates.
 * Only the identity, the plan ceilings and the folder tree are kept; the payment
 * block in particular (Stripe customer id, card last four) must never travel.
 */
function normaliseAccount(raw: Raw): GoLoginAccountInfo {
  const plan: Raw = raw.plan && typeof raw.plan === 'object' ? raw.plan : {};
  const folders: unknown[] = Array.isArray(raw.folders) ? raw.folders : [];
  return {
    id: str(raw._id) || str(raw.id),
    email: str(raw.email),
    planName: str(plan.name),
    maxShares: num(plan.maxShares),
    maxProfiles: num(plan.maxProfiles),
    profilesCount: num(raw.profiles) ?? 0,
    profilesCountWithShares: num(raw.profilesCountWithShares) ?? num(raw.profiles) ?? 0,
    defaultWorkspaceId: str(raw.defaultWorkspace),
    folders: folders
      .map((f) => (f && typeof f === 'object' ? normaliseFolder(f as Raw) : null))
      .filter((f): f is GoLoginFolder => f !== null),
  };
}

/**
 * One workspace member.
 *
 * `role` is a **string** on the way in (the invite payload's enum) but an
 * **object** on the way out, per the provider's own schema — so it is read
 * defensively rather than assumed. Same for `folders`, whose entries carry a
 * name and a role of unstated shape; only the name is kept, because the name is
 * what `PATCH` addresses.
 */
function normaliseMember(raw: Raw): GoLoginMember | null {
  const id = str(raw.id) || str(raw._id);
  const email = str(raw.email);
  if (!id || !email) return null;

  const role =
    typeof raw.role === 'string'
      ? raw.role
      : raw.role && typeof raw.role === 'object'
        ? str(raw.role.name) || str(raw.role.role) || str(raw.role.value)
        : '';

  const folders: unknown[] = Array.isArray(raw.folders) ? raw.folders : [];

  return {
    id,
    email,
    userId: str(raw.user),
    role,
    limitedAccess: raw.limitedAccess === true,
    folderNames: folders
      .map((f) => (typeof f === 'string' ? f : f && typeof f === 'object' ? str((f as Raw).name) : ''))
      .filter(Boolean),
    // Absent means joined on some payloads, so only an explicit `false` is
    // treated as pending — the alternative locks out every existing member.
    joined: raw.joined !== false,
    lastActiveAtMs: ms(raw.lastActiveAt),
    createdAtMs: ms(raw.createdAt),
  };
}

function normaliseWorkspace(raw: Raw): GoLoginWorkspace {
  const plan: Raw = raw.plan && typeof raw.plan === 'object' ? raw.plan : {};
  const members: unknown[] = Array.isArray(raw.members) ? raw.members : [];
  return {
    id: str(raw._id) || str(raw.id),
    name: str(raw.name),
    planName: str(plan.name),
    // Probed across the plausible spellings: the seat ceiling is documented only
    // as "member limits" and is display-only, so a miss costs a missing number
    // rather than a broken gate.
    maxMembers: num(plan.maxMembers) ?? num(plan.membersLimit) ?? num(plan.maxUsers),
    members: members
      .map((m) => (m && typeof m === 'object' ? normaliseMember(m as Raw) : null))
      .filter((m): m is GoLoginMember => m !== null),
  };
}

// ─── Client ─────────────────────────────────────────────────────────

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Some endpoints answer 201/204 with an empty body; do not try to parse one. */
  expectBody?: boolean;
}

class GoLoginApiClient implements IGoLoginClient {
  constructor(private readonly token: string) {}

  private async request(path: string, options: RequestOptions = {}): Promise<Raw> {
    const { method = 'GET', body, expectBody = true } = options;
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
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
      // a "back off and retry" condition - it means the key needs reissuing.
      console.error('[gologin] 429 — the API token may have been revoked by the provider');
      throw new GoLoginApiError('GoLogin rate limit hit — the API token may now be invalid.', 429);
    }
    if (response.status === 401 || response.status === 403) {
      // 401 rather than 502: with per-user tokens this is routinely "your key is
      // wrong", which the onboarding form must be able to tell you.
      throw new GoLoginApiError('GoLogin rejected the API token.', 401);
    }
    if (!response.ok) {
      // The endpoint and GoLogin's own body are the only things that make a 500
      // actionable. Without them a failure is "GoLogin returned 500." and there
      // is no way to tell a bad folder name from a rejected member invite —
      // which is exactly the hole that cost a debugging round trip on
      // 2026-09-10. Logged rather than returned: a provider error body can echo
      // the request, and these payloads carry email addresses.
      const detail = await response.text().catch(() => '');
      console.error(
        `[gologin] ${method} ${path} -> ${response.status}`,
        detail.slice(0, 1000) || '(empty body)',
      );
      throw new GoLoginApiError(
        `GoLogin returned ${response.status} for ${method} ${path.split('?')[0]}.`,
        502,
      );
    }

    if (!expectBody || response.status === 204) return {};

    // A Cloudflare block answers HTML with a 200, so the content type is
    // checked rather than trusted — otherwise the parse error surfaces to the
    // operator as a meaningless "Unexpected token <".
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

  async getAccount(): Promise<GoLoginAccountInfo> {
    return normaliseAccount(await this.request('/user'));
  }

  async createFolder(name: string): Promise<void> {
    // 201 with no documented body — the new id is read back from `getAccount()`.
    await this.request('/folders/folder', { method: 'POST', body: { name }, expectBody: false });
  }

  async shareFolder(
    folderId: string,
    recipients: string[],
    role: GoLoginShareRole,
  ): Promise<void> {
    await this.request('/share/multi', {
      method: 'POST',
      body: {
        type: 'folder',
        instanceIds: [folderId],
        role,
        // `recepients` — the provider's own misspelling, and load-bearing.
        // "Correcting" it here shares with nobody and returns 201 anyway.
        recepients: recipients,
      },
      expectBody: false,
    });
  }

  async setFolderProfiles(
    folderName: string,
    profileIds: string[],
    action: 'add' | 'remove',
  ): Promise<void> {
    if (!profileIds.length) return;
    // Addressed by NAME. See the note on `IGoLoginClient.setFolderProfiles`.
    await this.request('/folders/folder', {
      method: 'PATCH',
      body: { name: folderName, profiles: profileIds, action },
      expectBody: false,
    });
  }

  // ─── Workspace membership ─────────────────────────────────────────

  async getWorkspace(workspaceId: string): Promise<GoLoginWorkspace> {
    return normaliseWorkspace(await this.request(`/workspaces/${encodeURIComponent(workspaceId)}`));
  }

  async addWorkspaceMember(params: {
    workspaceId: string;
    email: string;
    role: GoLoginMemberRole;
    folderNames: string[];
  }): Promise<void> {
    const { workspaceId, email, role, folderNames } = params;
    await this.request(`/workspaces/${encodeURIComponent(workspaceId)}/members`, {
      method: 'POST',
      body: {
        emails: [email],
        // `folders` is documented as required only when `limitedAccess` is true,
        // and limited access is the entire point: a member must see their own
        // folder and nothing else.
        limitedAccess: true,
        role,
        folders: folderNames.map((name) => ({ name, role })),
      },
      expectBody: false,
    });
  }

  async updateWorkspaceMember(params: {
    workspaceId: string;
    memberId: string;
    role: GoLoginMemberRole;
    folderNames: string[];
  }): Promise<void> {
    const { workspaceId, memberId, role, folderNames } = params;
    await this.request(
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
      {
        method: 'PATCH',
        body: { limitedAccess: true, role, folders: folderNames.map((name) => ({ name, role })) },
        expectBody: false,
      },
    );
  }

  async removeWorkspaceMember(workspaceId: string, memberId: string): Promise<void> {
    await this.request(
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
      { method: 'DELETE', expectBody: false },
    );
  }

  // ─── Profile management ───────────────────────────────────────────
  //
  // ⚠ `PUT /browser/{id}/custom` is never called from here. GoLogin documents
  // that it re-randomises every parameter the body omits, so an "edit the name"
  // through it would re-roll the fingerprint of a logged-in account. Each method
  // below touches only the field it is named for.

  /** The raw profile document. Never returned above this file. */
  private rawProfile(profileId: string): Promise<Raw> {
    return this.request(`/browser/${encodeURIComponent(profileId)}`);
  }

  async getProfile(profileId: string): Promise<GoLoginProfile> {
    const row = normaliseProfile(await this.rawProfile(profileId));
    if (!row) throw new GoLoginApiError('GoLogin returned a profile with no id.', 502);
    return row;
  }

  async getProfileDetail(profileId: string): Promise<GoLoginProfileDetail> {
    return normaliseProfileDetail(await this.rawProfile(profileId));
  }

  async getProfileProxySecret(
    profileId: string,
  ): Promise<(GoLoginProxyInput & { password: string }) | null> {
    const raw = await this.rawProfile(profileId);
    const proxy = obj(raw.proxy);
    const mode = str(proxy.mode);
    const port = num(proxy.port);
    if (!isGoLoginProxyMode(mode) || !str(proxy.host) || port === null) return null;
    return {
      mode,
      host: str(proxy.host),
      port,
      username: str(proxy.username),
      password: str(proxy.password),
    };
  }

  async quickCreateProfile(params: {
    name: string;
    os: string;
    osSpec: string;
    workspaceId: string;
  }): Promise<string> {
    const { name, os, osSpec, workspaceId } = params;
    const query = workspaceId ? `?currentWorkspace=${encodeURIComponent(workspaceId)}` : '';
    const body = await this.request(`/browser/quick${query}`, {
      method: 'POST',
      body: { name, os, osSpec },
    });
    // The response schema is undocumented; GoLogin's own quickstart reads
    // `profile.id` off it. `_id` is probed for the same reason every other
    // normaliser here probes it.
    const id = str(body.id) || str(body._id);
    if (!id) {
      throw new GoLoginApiError('GoLogin created the profile but did not return its id.', 502);
    }
    return id;
  }

  async renameProfile(profileId: string, name: string): Promise<void> {
    await this.request('/browser/name/many', {
      method: 'PATCH',
      body: [{ profileId, name }],
      expectBody: false,
    });
  }

  async setProfileNotes(profileId: string, notes: string): Promise<void> {
    // GoLogin's own SDK `update()`: read the whole document, change one field,
    // write the whole document back. The fingerprint travels back untouched.
    const raw = await this.rawProfile(profileId);
    await this.request(`/browser/${encodeURIComponent(profileId)}`, {
      method: 'PUT',
      body: { ...raw, notes },
      expectBody: false,
    });
  }

  async setProfileProxy(profileId: string, proxy: GoLoginProxyInput | null): Promise<void> {
    let payload: Raw;
    if (!proxy) {
      payload = { mode: 'none' };
    } else {
      let password = proxy.password;
      if (password === undefined) {
        // "Keep the stored password": read it back here, inside the adapter, so
        // the secret never has to pass through a caller or a renderer.
        password = (await this.getProfileProxySecret(profileId))?.password ?? '';
      }
      payload = { ...proxy, password };
    }
    await this.request('/browser/proxy/many/v2', {
      method: 'PATCH',
      body: { proxies: [{ profileId, proxy: payload }] },
      expectBody: false,
    });
  }

  async deleteProfiles(profileIds: string[]): Promise<void> {
    if (!profileIds.length) return;
    await this.request('/browser', {
      method: 'DELETE',
      body: { profilesToDelete: profileIds },
      expectBody: false,
    });
  }

  async restoreProfiles(profileIds: string[], workspaceId: string): Promise<void> {
    if (!profileIds.length) return;
    await this.request('/deleted-profiles/restore', {
      method: 'POST',
      body: { profileIds, workspaceId },
      expectBody: false,
    });
  }

  async deleteFolder(folderName: string): Promise<void> {
    await this.request(`/folders/folder?name=${encodeURIComponent(folderName)}`, {
      method: 'DELETE',
      expectBody: false,
    });
  }
}

export function createGoLoginApiClient(token: string): IGoLoginClient {
  return new GoLoginApiClient(token);
}
