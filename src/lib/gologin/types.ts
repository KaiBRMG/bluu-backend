/**
 * GoLogin domain model + the client contract.
 *
 * Same seam as `src/lib/onlyfans/types.ts`: nothing above this file may know a
 * GoLogin URL, header or payload shape. The only implementation lives in
 * `providers/gologinApi.ts`; swapping it is a second file plus one line in
 * `index.ts`.
 *
 * **There is no single GoLogin identity here.** Since the per-user rollout the
 * app talks to GoLogin as two different accounts: the *master* workspace account
 * (`GL_API_TOKEN`, server-side only, used for folder + share administration) and
 * each operator's *own* account (their personal token, used to list and launch
 * the profiles shared to them). Both speak this interface; a client is built per
 * token, never as a module singleton. See `documentation/gologin.md`.
 */

/** The one error type callers see, so nothing above the adapter reads HTTP status. */
export class GoLoginApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'GoLoginApiError';
    this.status = status;
  }
}

/**
 * One browser profile, flattened to what a reader actually needs.
 *
 * **Deliberately narrow.** The provider's profile object carries the full
 * fingerprint (navigator, WebGL, fonts), the proxy's **credentials**, a
 * `facebookAccountData` block containing an account password, and — since v2 —
 * `sharedEmails`, the address of every colleague a profile is shared with. None
 * of that has any business reaching a renderer, so normalisation is a security
 * boundary as much as a convenience one; see `normaliseProfile`.
 */
export interface GoLoginProfile {
  id: string;
  name: string;
  notes: string;
  /** 'win' | 'mac' | 'lin' | 'android' | '' — the provider's own vocabulary. */
  os: string;
  browserType: string;
  /** 'none' when the profile runs without one. Never carries credentials. */
  proxyType: string;
  proxyRegion: string;
  /** Host only — no port, no username, no password. */
  proxyHost: string;
  isRunning: boolean;
  /** Who currently has it open, when the provider reports one. */
  runningUserEmail: string;
  folders: string[];
  createdAtMs: number | null;
  updatedAtMs: number | null;
  lastActivityMs: number | null;
}

/** One page of the provider's profile list (30 per page — its own maximum). */
export interface GoLoginProfilePage {
  profiles: GoLoginProfile[];
  /** Total across every page, as the provider counts it. */
  total: number;
}

/**
 * A folder as `GET /user` reports it.
 *
 * `profileIds` is the provider's `associatedProfiles`, and under the per-user
 * sharing model it is **the assignment record**: a profile is "assigned to" an
 * operator exactly when it sits in the folder shared to them. Nothing is
 * mirrored into Firestore, so there is no second copy to drift.
 */
export interface GoLoginFolder {
  id: string;
  name: string;
  /** The provider's own flag — true once the folder has been shared with anyone. */
  shared: boolean;
  profileIds: string[];
  order: number | null;
}

/**
 * `GET /user` — one request that answers "who is this token?" and "what folders
 * exist?" at the same time. Cheaper than `GET /folders` plus a profile walk, and
 * the only place the plan's share budget is reported.
 */
export interface GoLoginAccountInfo {
  id: string;
  email: string;
  planName: string;
  /** Null when the provider omits the plan block (some free accounts do). */
  maxShares: number | null;
  maxProfiles: number | null;
  /** Profiles owned outright, excluding shares. */
  profilesCount: number;
  /** Profiles visible including everything shared in. */
  profilesCountWithShares: number;
  /** `defaultWorkspace` — the id every membership call is addressed to. */
  defaultWorkspaceId: string;
  folders: GoLoginFolder[];
}

/** Recipient access level on a share. See `GOLOGIN_SHARE_ROLE` for the choice. */
export type GoLoginShareRole = 'guest' | 'redactor' | 'administrator';

/**
 * Prefix on every folder Bluu creates for an operator (`Bluu · Kai · a1b2c3`).
 *
 * Lives here, in the client-safe half, because both sides need it: the server
 * builds names with it (`folderNameForUser`) and the renderer uses it to keep
 * those folders **out of the UI**. They are plumbing — an operator's own folder
 * is on every profile they can see, so as a filter chip it matches everything
 * and as a row chip it is on every row. The workspace's real folders (REPOST,
 * JORGE, …) are the grouping people actually think in, and they stay.
 */
export const GOLOGIN_MANAGED_FOLDER_PREFIX = 'Bluu · ';

/**
 * Is this one of Bluu's own per-operator folders?
 *
 * Name-based, and therefore best-effort: someone can rename a folder in
 * GoLogin's dashboard and it will start showing up again. That is deliberate —
 * this decides *display only*, never access, so the cost of a miss is one extra
 * chip rather than a profile reaching the wrong person. Anything that grants or
 * revokes must key off `folderId`, never this.
 */
export function isManagedGoLoginFolder(name: string): boolean {
  return typeof name === 'string' && name.startsWith(GOLOGIN_MANAGED_FOLDER_PREFIX);
}

// ─── Capabilities ───────────────────────────────────────────────────

/**
 * The four GoLogin capabilities, each a **sub-item** of `apps-gologin` on
 * `/admin-portal/sharing` (see `definitions.ts` and permissions.md § Sub-item
 * pages). They replaced the single `apps-gologin-management` grant on
 * 2026-09-30, which bundled "who holds a paid seat" with "who may delete a
 * profile" — two authorities an admin reasonably wants to hand to different
 * people.
 *
 * Here, in the client-safe half, because both sides key off the same ids: the
 * window decides which buttons to render, the routes decide what to allow.
 * **Admins hold all four unconditionally** — see `requireGoLoginCapability`.
 */
export const GOLOGIN_CAPABILITIES = {
  members: 'apps-gologin-members',
  profiles: 'apps-gologin-profiles',
  folders: 'apps-gologin-folders',
  sharing: 'apps-gologin-sharing',
} as const;

export type GoLoginCapability = keyof typeof GOLOGIN_CAPABILITIES;

/**
 * **Admins operate as the workspace owner; everyone else brings their own key.**
 * The one definition of "runs on the master token", shared by the server
 * (seats, launch token, capability gates) and the window (which buttons render).
 * Keyed off the `admin` group, so it follows group membership automatically.
 * See `gologinAccountService.ts` for what follows from it.
 */
export function usesMasterGoLoginToken(user: { groups?: string[] } | null | undefined): boolean {
  return Array.isArray(user?.groups) && user.groups.includes('admin');
}

/** A GoLogin profile id — a 24-char hex ObjectId. Checked before any provider call. */
export function isGoLoginId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
}

/** A user-facing folder as the management routes return it. */
export interface GoLoginFolderRow {
  id: string;
  name: string;
  profileIds: string[];
  /**
   * Display names of the people this folder is shared with (live — see
   * gologin.md § Sharing). **Adding a profile to the folder hands it to every
   * one of them**, which is why every folder picker shows this. Present on the
   * read endpoints; absent on rows returned by writes.
   */
  sharedWith?: string[];
}

/** "Kai", "Kai and Sam", "Kai, Sam and 2 others" — for a sentence about who gains access. */
export function namesSentence(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/** One member, as the Sharing dialog sees them. */
export interface GoLoginSharingMember {
  uid: string;
  displayName: string;
  glEmail: string;
  /** False when the seat is gone from GoLogin — nothing can be shared to it. */
  hasSeat: boolean;
  /** Profiles in their personal folder — shared one at a time. */
  profileIds: string[];
  /** User-facing folders their seat is scoped to — shared live. */
  folderIds: string[];
}

export interface GoLoginSharingOverview {
  members: GoLoginSharingMember[];
  folders: GoLoginFolderRow[];
  profiles: { id: string; name: string; os: string; folders: string[] }[];
  truncated: boolean;
  fetchedAtMs: number;
}

// ─── Profile management (create / edit / delete) ────────────────────

/**
 * The four OS choices the New Profile dialog offers, and what each one means to
 * GoLogin.
 *
 * The pairs are not guessed: they are exactly what GoLogin's own SDK sends from
 * `getOsAdvanced()` when it creates a profile for the machine it runs on —
 * `mac` + `M1` on Apple Silicon, `mac` + `''` on Intel, `win` + `''` for the
 * default Windows fingerprint. `win11` is the documented `osSpec` for Windows 11.
 * The OS is a **fingerprint, not a requirement** (see gologin.md): a Mac profile
 * runs on a Windows desk and vice versa.
 */
export const GOLOGIN_OS_CHOICES = {
  win10: { os: 'win', osSpec: '', label: 'Windows 10' },
  win11: { os: 'win', osSpec: 'win11', label: 'Windows 11' },
  'mac-m1': { os: 'mac', osSpec: 'M1', label: 'macOS · Apple M1' },
  'mac-intel': { os: 'mac', osSpec: '', label: 'macOS · Intel' },
} as const;

export type GoLoginOsChoice = keyof typeof GOLOGIN_OS_CHOICES;

export function isGoLoginOsChoice(value: unknown): value is GoLoginOsChoice {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GOLOGIN_OS_CHOICES, value);
}

/** The label for a profile's `os` + `osSpec` pair, for read-only display. */
export function goLoginOsLabel(os: string, osSpec: string): string {
  const choice = Object.values(GOLOGIN_OS_CHOICES).find((c) => c.os === os && c.osSpec === osSpec);
  if (choice) return choice.label;
  if (os === 'mac') return osSpec ? `macOS · Apple ${osSpec}` : 'macOS';
  if (os === 'win') return 'Windows';
  if (os === 'lin') return 'Linux';
  if (os === 'android') return 'Android';
  return os || 'Unknown';
}

/**
 * The proxy protocols offered. GoLogin's vocabulary has more (`socks4`, `tor`,
 * `gologin`, …); HTTP and SOCKS5 cover every residential and mobile provider
 * this team buys from, and every extra option is one more way to mis-configure a
 * profile that holds a live account.
 */
export const GOLOGIN_PROXY_MODES = ['http', 'socks5'] as const;
export type GoLoginProxyMode = (typeof GOLOGIN_PROXY_MODES)[number];

export function isGoLoginProxyMode(value: unknown): value is GoLoginProxyMode {
  return typeof value === 'string' && (GOLOGIN_PROXY_MODES as readonly string[]).includes(value);
}

/**
 * A proxy as a manager enters it.
 *
 * `password` is **optional on purpose**: `undefined` means "keep the password
 * already on the profile". The stored password never reaches a renderer (see
 * `GoLoginProfileDetail.proxy.hasPassword`), so an edit that only changes the
 * port must be able to say "leave the secret alone" without knowing it.
 */
export interface GoLoginProxyInput {
  mode: GoLoginProxyMode;
  host: string;
  port: number;
  username: string;
  password?: string;
}

/**
 * Everything the Edit Profile panel shows — the **manager's** projection.
 *
 * Wider than `GoLoginProfile` because the panel is "all information of a
 * profile", but still a projection, not the provider's document: the proxy
 * **password** is reduced to `hasPassword`, and `facebookAccountData`,
 * `sharedEmails` and `permissions` are dropped exactly as `normaliseProfile`
 * drops them. The fingerprint fields are here to be *read* — GoLogin's own
 * guidance is that OS, user agent, resolution, fonts, canvas, WebGL and CPU/RAM
 * must never change once an account has logged in, so nothing edits them.
 */
export interface GoLoginProfileDetail {
  id: string;
  name: string;
  notes: string;
  os: string;
  osSpec: string;
  browserType: string;
  userAgent: string;
  resolution: string;
  language: string;
  platform: string;
  hardwareConcurrency: number | null;
  /** GiB, as GoLogin reports it. */
  deviceMemory: number | null;
  webglVendor: string;
  webglRenderer: string;
  webRtcMode: string;
  canvasMode: string;
  /** True when the timezone follows the proxy's IP (GoLogin's default). */
  timezoneFromIp: boolean;
  timezone: string;
  /** True when the language follows the proxy's location. */
  autoLang: boolean;
  proxy: {
    mode: string;
    host: string;
    port: number | null;
    username: string;
    /** Whether a password is stored. The password itself never leaves the server. */
    hasPassword: boolean;
  };
  folders: string[];
  isRunning: boolean;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  lastActivityMs: number | null;
}

/** What "Ping proxy" reports. `ok: false` carries a sentence, never a stack. */
export type GoLoginProxyCheckResult =
  | {
      ok: true;
      /** The exit IP the proxy presents to the world. */
      ip: string;
      country: string;
      city: string;
      timezone: string;
      latencyMs: number;
    }
  | { ok: false; error: string; latencyMs: number };

/** Workspace member role. Note this is NOT the same vocabulary as a share role. */
export type GoLoginMemberRole = 'owner' | 'admin' | 'editor' | 'guest';

/**
 * One workspace member — i.e. one **paid seat**.
 *
 * Membership is the thing that lets someone generate an API token at all: a free
 * GoLogin account cannot, which is why a share alone was never enough. So this
 * list is the authority on who may use the feature, and `requireGoLoginMember`
 * checks against it.
 */
export interface GoLoginMember {
  /** The id `DELETE`/`PATCH .../members/{id}` addresses. Not a GoLogin user id. */
  id: string;
  email: string;
  /** GoLogin's own user id, present once the invitation is accepted. */
  userId: string;
  role: string;
  limitedAccess: boolean;
  /** Folder names this member can reach. Names, not ids — the provider's choice. */
  folderNames: string[];
  /** False while an invitation is outstanding. They cannot mint a token yet. */
  joined: boolean;
  lastActiveAtMs: number | null;
  createdAtMs: number | null;
}

/** `GET /workspaces/{wid}` — members and the seat ceiling in one request. */
export interface GoLoginWorkspace {
  id: string;
  name: string;
  planName: string;
  /** Seats the plan allows. Null when the provider omits it. */
  maxMembers: number | null;
  members: GoLoginMember[];
}

export interface IGoLoginClient {
  /** `page` is 1-based, matching the provider. */
  listProfiles(page: number): Promise<GoLoginProfilePage>;
  /** Identity + folders for whichever token this client holds. */
  getAccount(): Promise<GoLoginAccountInfo>;
  /** `POST /folders/folder`. The provider does not return the new id — read it
   *  back from `getAccount()`. */
  createFolder(name: string): Promise<void>;
  /** `POST /share/multi` with `type: 'folder'`. Done **once** per operator. */
  shareFolder(folderId: string, recipients: string[], role: GoLoginShareRole): Promise<void>;
  /**
   * `PATCH /folders/folder` — add or remove profiles.
   *
   * ⚠ Addressed by folder **name**, not id: that is the provider's own contract,
   * and the reason callers must resolve the current name from `getAccount()`
   * rather than trusting a stored one (someone can rename a folder in GoLogin's
   * dashboard at any time).
   */
  setFolderProfiles(folderName: string, profileIds: string[], action: 'add' | 'remove'): Promise<void>;

  // ─── Workspace membership (master token only) ─────────────────────

  /** `GET /workspaces/{wid}` — the member list and the plan's seat ceiling. */
  getWorkspace(workspaceId: string): Promise<GoLoginWorkspace>;

  /**
   * `POST /workspaces/{wid}/members` — invite by email, scoped to folders.
   *
   * This replaces `shareFolder` for onboarding: it grants the seat *and* the
   * folder in one call, and a seat is what makes an API token possible at all.
   */
  addWorkspaceMember(params: {
    workspaceId: string;
    email: string;
    role: GoLoginMemberRole;
    folderNames: string[];
  }): Promise<void>;

  /**
   * `PATCH /workspaces/{wid}/members/{id}` — re-scope an existing member.
   *
   * The reconciliation path: members who predate this feature already hold seats
   * and cannot be re-invited, so their folder is attached this way instead.
   * Idempotent, so it is also the repair for a member whose scoping drifted.
   */
  updateWorkspaceMember(params: {
    workspaceId: string;
    memberId: string;
    role: GoLoginMemberRole;
    folderNames: string[];
  }): Promise<void>;

  /** `DELETE /workspaces/{wid}/members/{id}` — releases the seat. */
  removeWorkspaceMember(workspaceId: string, memberId: string): Promise<void>;

  // ─── Profile management (master token only) ───────────────────────
  //
  /** `GET /browser/{id}` as a list row — the same projection the listing uses. */
  getProfile(profileId: string): Promise<GoLoginProfile>;
  //
  // ⚠ `PUT /browser/{id}/custom` is deliberately absent. GoLogin documents that
  // it **re-randomises every parameter the body leaves out** — using it to
  // rename a profile would silently re-roll the fingerprint of a logged-in
  // account, which is how accounts get flagged. Every edit below goes through an
  // endpoint that touches only the field it names.

  /** `GET /browser/{id}`, projected for the Edit panel. Never carries the proxy password. */
  getProfileDetail(profileId: string): Promise<GoLoginProfileDetail>;

  /**
   * The profile's stored proxy, **including its password**. Server-only by
   * construction: it exists so "Ping proxy" can test an edited proxy whose
   * password the manager chose to keep, and it must never be returned by a route.
   */
  getProfileProxySecret(profileId: string): Promise<(GoLoginProxyInput & { password: string }) | null>;

  /**
   * `POST /browser/quick` — a profile on the workspace's **default settings**
   * for the given OS. The rest of the fingerprint (user agent, resolution,
   * WebGL, fonts, …) is generated by GoLogin to match the OS, which is the whole
   * point: a hand-assembled fingerprint is how an inconsistent one happens.
   * Returns the new profile's id (the response's `id`, as GoLogin's own
   * quickstart reads it).
   */
  quickCreateProfile(params: {
    name: string;
    os: string;
    osSpec: string;
    workspaceId: string;
  }): Promise<string>;

  /** `PATCH /browser/name/many` — the name, and nothing else. */
  renameProfile(profileId: string, name: string): Promise<void>;

  /**
   * Notes have no surgical endpoint, so this is GoLogin's own SDK `update()`:
   * `GET /browser/{id}`, change `notes`, `PUT /browser/{id}` with the whole
   * document. Every other field goes back exactly as it came, so the fingerprint
   * is preserved — unlike `PUT …/custom`, which would re-randomise it.
   */
  setProfileNotes(profileId: string, notes: string): Promise<void>;

  /**
   * `PATCH /browser/proxy/many/v2` — the proxy and nothing else. `null` removes
   * it. A `password` of `undefined` keeps the one already stored; the adapter
   * reads it back itself so it never has to travel through a caller.
   */
  setProfileProxy(profileId: string, proxy: GoLoginProxyInput | null): Promise<void>;

  /** `DELETE /browser`. GoLogin keeps deleted profiles restorable. */
  deleteProfiles(profileIds: string[]): Promise<void>;

  /** `POST /deleted-profiles/restore` — the Undo behind a delete. */
  restoreProfiles(profileIds: string[], workspaceId: string): Promise<void>;

  /** `DELETE /folders/folder?name=` — addressed by **name**, like every folder write. */
  deleteFolder(folderName: string): Promise<void>;
}
