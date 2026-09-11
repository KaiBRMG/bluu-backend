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
}
