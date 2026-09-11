/**
 * GoLogin accounts — one operator, one paid seat, one folder, one personal token.
 *
 * ## The model, and the constraint that forced it
 *
 * **A free GoLogin account cannot generate an API token.** Only a workspace
 * *member* — a paid seat — can. That single fact decides the shape of everything
 * here, and it is why sharing a folder to someone's free account (the first
 * design) was never going to work: they could see the profiles in GoLogin's own
 * app and had no way to give Bluu a key.
 *
 * So the sequence is:
 *
 *   1. An **admin adds the person as a workspace member** on the Management
 *      surface. That call creates their folder *and* invites them scoped to it,
 *      in one request (`POST /workspaces/{wid}/members` with `limitedAccess`).
 *      Provisioning happens **here**, not at onboarding — a folder is a
 *      consequence of holding a seat, so it is created when the seat is granted.
 *   2. They accept GoLogin's invitation email and can now mint an API token.
 *   3. They paste it into Bluu's onboarding, which only verifies and stores it.
 *
 * ## Membership is the gate, not the page permission
 *
 * `apps-gologin` can be granted on `/admin-portal/sharing` to anyone, and that
 * grant says nothing about whether GoLogin will accept their key. So every
 * GoLogin route checks **both**: the page permission (can you open this) and
 * `requireGoLoginMember` (does GoLogin know you). The membership check gates the
 * onboarding screen too — being told to fetch a token you cannot generate is a
 * worse experience than being told you have not been added yet.
 *
 * ## Things that will bite whoever edits this
 *
 * - **`folderId` is the anchor; `folderName` is not.** Both `PATCH /folders/folder`
 *   and the member-scoping calls address folders **by name**, and anyone can
 *   rename one in GoLogin's dashboard. The id is stored and the current name is
 *   resolved before every mutation.
 * - **`POST /folders/folder` returns no id.** The folder is read back from
 *   `GET /user` by name — safe only because the name carries a uid fragment.
 * - **A member's email is usually not their Bluu `workEmail`.** The admin
 *   supplies it when adding them, and it is what everything downstream matches
 *   on. Reconciliation guesses by normalised email and leaves the rest to a human.
 * - **Nothing is mirrored.** Assignment lives in GoLogin's folder membership.
 */
import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizeEmail } from '@/lib/authEmail';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import {
  getMasterGoLoginClient,
  getUserGoLoginClient,
  GoLoginApiError,
  GOLOGIN_MANAGED_FOLDER_PREFIX,
  GOLOGIN_MEMBER_ROLE,
  type GoLoginAccountInfo,
  type GoLoginFolder,
  type GoLoginMember,
  type GoLoginWorkspace,
} from '@/lib/gologin';
import { decryptToken, encryptToken, isTokenCryptoConfigured } from '@/lib/gologin/tokenCrypto';

/**
 * Server-only collection. **Never client-readable** — it holds an encrypted
 * credential, and `users/{uid}` is streamed to the renderer by `onSnapshot`,
 * which is exactly why the token does not live there.
 */
export const GOLOGIN_ACCOUNTS_COLLECTION = 'gologin-accounts';

/** What `gologin-accounts/{uid}` holds. The token is an envelope, never plaintext. */
export interface GoLoginAccountDoc {
  uid: string;
  /** Their GoLogin address — the seat, the share and every match key downstream. */
  glEmail: string;
  /** GoLogin's own user id. Only known once they have linked a token. */
  glUserId?: string;
  /** `v1:iv:tag:ciphertext`. Absent until they complete onboarding. */
  tokenCipher?: string;
  tokenAddedAtMs?: number;
  /** The folder scoped to their seat. The stable anchor for every assignment. */
  folderId: string;
  /** Cached for display only. Re-resolved from the master before any mutation. */
  folderName: string;
  /** When the admin granted the seat. */
  memberAddedAtMs: number;
  /** Which admin granted it. Audit only. */
  addedByUid?: string;
  planName?: string;
}

/** The half of an account row that is safe to send to a renderer. */
export interface GoLoginAccountSummary {
  /** True once they have pasted a working API token. */
  linked: boolean;
  /** True once an admin has granted them a seat. Gates the whole window. */
  member: boolean;
  /** False while a GoLogin invitation is still outstanding. */
  joined: boolean;
  glEmail: string;
  folderName: string;
  planName: string;
  linkedAtMs: number | null;
}

export const EMPTY_ACCOUNT_SUMMARY: GoLoginAccountSummary = {
  linked: false,
  member: false,
  joined: false,
  glEmail: '',
  folderName: '',
  planName: '',
  linkedAtMs: null,
};

/**
 * **Admins operate as the workspace owner; everyone else brings their own key.**
 *
 * A Bluu admin is not an operator with a narrower view — they administer the
 * workspace, and three things follow that make a seat the wrong shape for them:
 *
 * - **They are not a "member".** `GET /workspaces/{wid}` lists the people the
 *   owner invited. The master account is the other side of that relationship, so
 *   `requireGoLoginMember` would lock admins out of the feature they run.
 * - **They already have the master token.** `GL_API_TOKEN` is the shared
 *   workspace key, so asking an admin to paste a personal one would either
 *   duplicate that credential or hand them a strictly weaker view of a workspace
 *   they can already reconfigure through Management.
 * - **They need no folder.** Assignment scopes an operator to a subset; an admin
 *   sees the whole workspace, so there is no subset to scope them to.
 *
 * Keyed off the `admin` group rather than a configured uid, so it follows group
 * membership automatically — promoting someone grants it, demoting revokes it,
 * and there is nothing to keep in sync.
 *
 * ⚠ **This is the one place the master token reaches a desktop.** An admin's
 * launch hands `GL_API_TOKEN` to their machine, where it is extractable. That is
 * access they already hold through the admin claim — but it outlives a revoked
 * Bluu account, so **rotate `GL_API_TOKEN` when an admin leaves.** Non-admins
 * are unaffected: their desktops only ever see their own key.
 */
export function usesMasterGoLoginToken(user: { groups?: string[] } | null | undefined): boolean {
  return Array.isArray(user?.groups) && user.groups.includes('admin');
}

/** The same test by uid. `getUserById` is cached 60s, so this is near-free. */
export async function isGoLoginAdmin(uid: string): Promise<boolean> {
  return usesMasterGoLoginToken(await getUserById(uid));
}

export async function getGoLoginAccount(uid: string): Promise<GoLoginAccountDoc | null> {
  const snap = await adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).doc(uid).get();
  return snap.exists ? (snap.data() as GoLoginAccountDoc) : null;
}

/**
 * The operator's decrypted token, or null.
 *
 * Null covers situations that all present the same way to a caller — never
 * linked, key rotated out from under the envelope, corrupt row — and all have
 * the same remedy: the operator re-enters their API token.
 */
export async function getGoLoginUserToken(uid: string): Promise<string | null> {
  // Admins launch with the master token, because the workspace is theirs to run —
  // the alternative is storing a second copy of the same credential encrypted
  // in Firestore, which adds a place for it to leak and protects nothing.
  if (await isGoLoginAdmin(uid)) return process.env.GL_API_TOKEN ?? null;

  const account = await getGoLoginAccount(uid);
  if (!account?.tokenCipher) return null;
  return decryptToken(account.tokenCipher);
}

// ─── The master account and its workspace ───────────────────────────

/**
 * `GET /user` on the master token, memoised.
 *
 * One request answers "what folders exist, which profiles are in them, and which
 * workspace is this" — cheaper than `GET /folders` plus a walk. Memoised because
 * the Management surface reads it on every render and a 429 revokes the token
 * permanently.
 */
const MASTER_TTL_MS = 60_000;
let masterCache: { data: GoLoginAccountInfo; fetchedAtMs: number } | null = null;
let masterInFlight: Promise<GoLoginAccountInfo> | null = null;

export async function getMasterAccount(force = false): Promise<GoLoginAccountInfo> {
  if (!force && masterCache && Date.now() - masterCache.fetchedAtMs < MASTER_TTL_MS) {
    return masterCache.data;
  }
  if (masterInFlight) return masterInFlight;
  masterInFlight = getMasterGoLoginClient()
    .getAccount()
    .then((data) => {
      masterCache = { data, fetchedAtMs: Date.now() };
      return data;
    })
    .finally(() => {
      masterInFlight = null;
    });
  return masterInFlight;
}

/** Called after any folder mutation, so the next read is not a stale membership list. */
export function invalidateMasterAccount(): void {
  masterCache = null;
}

/**
 * The workspace id every membership call is addressed to.
 *
 * `GL_WORKSPACE_ID` overrides it for the case where the master account owns more
 * than one workspace and the default is not the right one. Otherwise it comes
 * from `defaultWorkspace` on `GET /user`, so nothing has to be configured.
 */
export async function getWorkspaceId(): Promise<string> {
  const override = process.env.GL_WORKSPACE_ID?.trim();
  if (override) return override;
  const master = await getMasterAccount();
  if (!master.defaultWorkspaceId) {
    throw new GoLoginApiError(
      'GoLogin did not report a default workspace. Set GL_WORKSPACE_ID.',
      503,
    );
  }
  return master.defaultWorkspaceId;
}

/** `GET /workspaces/{wid}`, memoised on the same terms as the master account. */
let workspaceCache: { data: GoLoginWorkspace; fetchedAtMs: number } | null = null;
let workspaceInFlight: Promise<GoLoginWorkspace> | null = null;

export async function getWorkspace(force = false): Promise<GoLoginWorkspace> {
  if (!force && workspaceCache && Date.now() - workspaceCache.fetchedAtMs < MASTER_TTL_MS) {
    return workspaceCache.data;
  }
  if (workspaceInFlight) return workspaceInFlight;
  const wid = await getWorkspaceId();
  workspaceInFlight = getMasterGoLoginClient()
    .getWorkspace(wid)
    .then((data) => {
      workspaceCache = { data, fetchedAtMs: Date.now() };
      return data;
    })
    .finally(() => {
      workspaceInFlight = null;
    });
  return workspaceInFlight;
}

export function invalidateWorkspace(): void {
  workspaceCache = null;
}

/** Find a member by email, normalised — the addresses come from two systems. */
export function findMember(workspace: GoLoginWorkspace, email: string): GoLoginMember | null {
  const key = normalizeEmail(email);
  if (!key) return null;
  return workspace.members.find((m) => normalizeEmail(m.email) === key) ?? null;
}

/**
 * Resolve a folder by its **id** and hand back its **current** name.
 *
 * The indirection is the whole point: folder mutations are addressed by name,
 * and an admin renaming a folder in GoLogin's dashboard would otherwise make
 * every later assignment silently target a folder that no longer exists (or
 * worse, a different one that took the old name).
 */
export async function resolveFolder(folderId: string, force = false): Promise<GoLoginFolder | null> {
  const account = await getMasterAccount(force);
  return account.folders.find((f) => f.id === folderId) ?? null;
}

// ─── Membership ─────────────────────────────────────────────────────

export interface MembershipStatus {
  member: boolean;
  joined: boolean;
  account: GoLoginAccountDoc | null;
}

/**
 * Is this Bluu user a GoLogin workspace member?
 *
 * Both halves must hold: a row binding them to a GoLogin address, **and** that
 * address still on the workspace's member list. The second is what makes a
 * removal in GoLogin's own dashboard take effect here without anyone telling us.
 */
export async function getMembershipStatus(uid: string): Promise<MembershipStatus> {
  // Short-circuited before any provider call: admins are not in the member
  // list at all, so looking would both cost a request and answer "no".
  if (await isGoLoginAdmin(uid)) return { member: true, joined: true, account: null };

  const account = await getGoLoginAccount(uid);
  if (!account?.glEmail) return { member: false, joined: false, account: null };
  const workspace = await getWorkspace();
  const member = findMember(workspace, account.glEmail);
  return { member: !!member, joined: member?.joined === true, account };
}

// ─── Provisioning ───────────────────────────────────────────────────

/**
 * The folder name an operator gets.
 *
 * Carries a uid fragment because the name must be unique **at creation time** —
 * two people called "Kai" must not end up sharing one folder, and adoption of an
 * existing folder by name is how that would happen. After creation the id is the
 * anchor, so the name is free to be renamed by a human.
 */
export function folderNameForUser(uid: string, displayName: string): string {
  const label = (displayName || 'Operator').trim().replace(/\s+/g, ' ').slice(0, 40);
  // The prefix is shared with the renderer, which uses it to keep these folders
  // out of the UI — see `isManagedGoLoginFolder`. Changing it here without
  // changing it there makes every operator's plumbing folder visible again.
  return `${GOLOGIN_MANAGED_FOLDER_PREFIX}${label} · ${uid.slice(0, 6)}`;
}

export type LinkFailure =
  | 'invalid-key'
  | 'master-key'
  | 'already-linked'
  | 'wrong-account'
  | 'no-email'
  | 'not-a-member'
  | 'not-configured'
  | 'folder-failed';

export class GoLoginLinkError extends Error {
  constructor(readonly code: LinkFailure, message: string, readonly status = 400) {
    super(message);
    this.name = 'GoLoginLinkError';
  }
}

/**
 * Ensure a folder exists for this user and return it.
 *
 * Adopts, in order: the folder already on their row, then one already named for
 * them, then a newly created one. Idempotent by construction — running it twice
 * never produces two folders.
 */
async function ensureFolder(uid: string, existing: GoLoginAccountDoc | null): Promise<GoLoginFolder> {
  const master = await getMasterAccount();
  const user = await getUserById(uid);
  const wantedName = folderNameForUser(uid, user?.displayName ?? '');

  let folder = existing?.folderId ? await resolveFolder(existing.folderId) : null;
  if (!folder) folder = master.folders.find((f) => f.name === wantedName) ?? null;
  if (!folder) {
    await getMasterGoLoginClient().createFolder(wantedName);
    invalidateMasterAccount();
    // The create endpoint returns no id, so the folder is read back by name —
    // the one moment a name is trusted, and safe because the name carries a uid.
    const refreshed = await getMasterAccount(true);
    folder = refreshed.folders.find((f) => f.name === wantedName) ?? null;
  }
  if (!folder) {
    throw new GoLoginLinkError(
      'folder-failed',
      'Could not create the profile folder in GoLogin. Try again in a moment.',
      502,
    );
  }
  return folder;
}

/**
 * Grant a Bluu user a GoLogin seat: create their folder, then invite them scoped
 * to it. **This is where provisioning happens** — a folder is a consequence of
 * holding a seat, so it is created when the seat is granted rather than when the
 * person later pastes a token.
 *
 * Idempotent: someone who is already a member is re-scoped with `PATCH` instead,
 * which is also the repair path for a member whose folder access drifted.
 */
export async function addGoLoginMember(params: {
  uid: string;
  email: string;
  addedByUid: string;
}): Promise<GoLoginAccountDoc> {
  const { uid, email, addedByUid } = params;
  const glEmail = email.trim();
  if (!normalizeEmail(glEmail)) {
    throw new GoLoginLinkError('no-email', 'That is not a valid email address.', 400);
  }
  if (await isGoLoginAdmin(uid)) {
    // Inviting the owner to their own workspace would either fail at the
    // provider or burn a seat to grant access they already have in full.
    throw new GoLoginLinkError(
      'already-linked',
      'That user owns the GoLogin workspace and already has full access.',
      409,
    );
  }

  // One GoLogin address per Bluu user, and vice versa. Two people on one address
  // would share a seat and a folder, so revoking one would revoke both.
  //
  // Scanned in memory rather than queried. This was a `where('glEmail', '==')`,
  // which needs a single-field index — and on 2026-09-11 it failed in production
  // with FAILED_PRECONDITION because `glEmail` sat in the index *exemption* list
  // (correct when the check queried `glUserId`, stale after the seat rework).
  // Three things make the scan the better shape, not merely the safer one:
  //
  //   • It removes the deploy-order coupling entirely. Code that only works once
  //     an index has been deployed AND finished building is code that breaks
  //     between two correct deploys.
  //   • Every other consumer of this collection already reads it whole, so the
  //     query was the outlier, not the norm.
  //   • The collection is one document per **paid seat** — bounded by headcount,
  //     read here only when an admin adds a member. The index cost the opposite
  //     trade: write amplification on every account write, forever.
  //
  // Matched on the normalised address, which the query could not do at all.
  const all = await adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).get();
  const wanted = normalizeEmail(glEmail);
  const clashes = all.docs.filter(
    (d) => d.id !== uid && normalizeEmail((d.data() as GoLoginAccountDoc).glEmail) === wanted,
  );
  if (clashes.length > 0) {
    throw new GoLoginLinkError(
      'already-linked',
      'That GoLogin address is already assigned to another Bluu user.',
      409,
    );
  }

  const existing = await getGoLoginAccount(uid);
  const folder = await ensureFolder(uid, existing);

  const client = getMasterGoLoginClient();
  const workspaceId = await getWorkspaceId();
  const workspace = await getWorkspace(true);
  const alreadyMember = findMember(workspace, glEmail);

  if (alreadyMember) {
    // They hold a seat already — from before this feature, or from a previous
    // grant. Re-invited they would 409; re-scoped they simply gain the folder.
    const folderNames = [...new Set([...alreadyMember.folderNames, folder.name])];
    await client.updateWorkspaceMember({
      workspaceId,
      memberId: alreadyMember.id,
      role: GOLOGIN_MEMBER_ROLE,
      folderNames,
    });
  } else {
    await client.addWorkspaceMember({
      workspaceId,
      email: glEmail,
      role: GOLOGIN_MEMBER_ROLE,
      folderNames: [folder.name],
    });
  }
  invalidateWorkspace();

  const doc: GoLoginAccountDoc = {
    ...(existing ?? {}),
    uid,
    glEmail,
    folderId: folder.id,
    folderName: folder.name,
    memberAddedAtMs: existing?.memberAddedAtMs ?? Date.now(),
    addedByUid,
  };
  await adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).doc(uid).set(doc);

  // The gate the window renders is read off the user doc's existing onSnapshot,
  // so this costs the renderer no extra read. Non-secret half only.
  await adminDb.collection('users').doc(uid).set(
    { gologinEmail: glEmail, gologinMemberSince: FieldValue.serverTimestamp() },
    { merge: true },
  );
  invalidateUserCache(uid); // rule 2

  return doc;
}

/**
 * Revoke a seat: remove them from the workspace and forget their row.
 *
 * **Their folder is deliberately left in place.** It holds the assignment record
 * for profiles that still exist, and deleting it would silently unassign work
 * that someone may simply be handing over. Re-adding the person adopts the same
 * folder, so a mistaken removal is fully reversible.
 */
export async function removeGoLoginMember(uid: string): Promise<void> {
  if (await isGoLoginAdmin(uid)) {
    // There is no "remove" for the owner — the master token is the workspace.
    // Refusing here stops an admin locking the whole feature's administrator
    // out of it with one click.
    throw new GoLoginLinkError(
      'already-linked',
      'The workspace owner cannot be removed from their own workspace.',
      409,
    );
  }

  const account = await getGoLoginAccount(uid);
  if (account?.glEmail) {
    const workspace = await getWorkspace(true);
    const member = findMember(workspace, account.glEmail);
    if (member) {
      await getMasterGoLoginClient().removeWorkspaceMember(await getWorkspaceId(), member.id);
      invalidateWorkspace();
    }
  }

  await adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).doc(uid).delete();
  await adminDb.collection('users').doc(uid).set(
    {
      gologinEmail: FieldValue.delete(),
      gologinLinkedAt: FieldValue.delete(),
      gologinMemberSince: FieldValue.delete(),
    },
    { merge: true },
  );
  invalidateUserCache(uid);
}

export interface ReconcileResult {
  /** Members matched to a Bluu user and given a folder. */
  provisioned: { uid: string; email: string; folderName: string }[];
  /** Members already holding a Bluu folder. Left alone. */
  alreadyProvisioned: number;
  /** Matched a Bluu admin, who uses the master token and needs no folder. */
  skippedAdmins: number;
  /** Members whose address matches no single Bluu user — map these by hand. */
  unmatched: { memberId: string; email: string }[];
  /** Matched, but the provisioning call failed. Distinct from unmatched. */
  failed: { email: string; reason: string }[];
}

/**
 * Bring an already-populated workspace under management.
 *
 * The workspace predates this feature and has members in it, so they have seats
 * but no Bluu folder and no row here. For each one, this matches their GoLogin
 * address against a Bluu user's `workEmail`, creates the folder and re-scopes
 * them onto it with `PATCH` — they cannot be re-invited, they are already in.
 *
 * **Matching by email is a guess, and unmatched members are reported rather than
 * guessed harder.** Binding the wrong Bluu user to a seat would show one person
 * another person's profiles, so anything ambiguous is left for a human to map
 * explicitly on the Management surface.
 *
 * Sequential on purpose: each provision is two or three provider calls, and a
 * `Promise.all` over twenty members is exactly the burst that costs the token.
 */
export async function reconcileGoLoginMembers(addedByUid: string): Promise<ReconcileResult> {
  const [workspace, accountsSnap, usersSnap, master] = await Promise.all([
    getWorkspace(true),
    adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).get(),
    // Read once and match in memory. This used to be a `where('workEmail', '==')`
    // query **per member** — an N+1 against rule 9, and worse, it compared the
    // provider's raw string against Firestore's, so a single difference in case
    // meant no match. GoLogin echoes whatever casing a person typed at sign-up,
    // so that quietly failed to match most of the workspace.
    adminDb.collection('users').get(),
    getMasterAccount(),
  ]);

  const accounts = accountsSnap.docs.map((d) => d.data() as GoLoginAccountDoc);
  const claimed = new Set(accounts.map((a) => normalizeEmail(a.glEmail)).filter(Boolean));
  const masterEmail = normalizeEmail(master.email);

  /** Normalised address -> the Bluu users holding it. More than one is ambiguous. */
  const byEmail = new Map<string, { uid: string; groups?: string[] }[]>();
  for (const doc of usersSnap.docs) {
    const data = doc.data() as { workEmail?: string; groups?: string[]; isArchived?: boolean };
    if (data.isArchived) continue;
    const key = normalizeEmail(data.workEmail);
    if (!key) continue;
    const bucket = byEmail.get(key);
    if (bucket) bucket.push({ uid: doc.id, groups: data.groups });
    else byEmail.set(key, [{ uid: doc.id, groups: data.groups }]);
  }

  const result: ReconcileResult = {
    provisioned: [],
    alreadyProvisioned: 0,
    skippedAdmins: 0,
    unmatched: [],
    failed: [],
  };

  for (const member of workspace.members) {
    const key = normalizeEmail(member.email);
    if (!key) continue;
    // The workspace owner is not an operator — they own every profile already.
    if (key === masterEmail) continue;
    if (claimed.has(key)) {
      result.alreadyProvisioned++;
      continue;
    }

    const matches = byEmail.get(key) ?? [];
    // Exactly one match, or it is not a match. Two would be ambiguous and zero
    // means they signed up to GoLogin under a different address.
    if (matches.length !== 1) {
      result.unmatched.push({ memberId: member.id, email: member.email });
      continue;
    }

    // Admins operate on the master token, so giving them a seat-scoped folder
    // would swap full workspace access for a narrower slice of it. Counted
    // rather than skipped silently — an admin who sees "3 unchanged" with no
    // explanation reasonably concludes the run did nothing.
    if (usesMasterGoLoginToken(matches[0])) {
      result.skippedAdmins++;
      continue;
    }

    try {
      const doc = await addGoLoginMember({ uid: matches[0].uid, email: member.email, addedByUid });
      result.provisioned.push({ uid: matches[0].uid, email: member.email, folderName: doc.folderName });
    } catch (err) {
      // One bad member must not abandon the rest of the run — but it is a
      // *failure*, not an unmatched address, and conflating the two sends the
      // admin looking for a Bluu user who is sitting right there.
      console.error('[gologin] reconcile failed for', member.email, err);
      result.failed.push({
        email: member.email,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}

// ─── Linking a personal token ───────────────────────────────────────

/**
 * Attach a personal GoLogin API token to a Bluu user.
 *
 * By this point they must already hold a seat — an admin granted it, and their
 * folder already exists. This call only verifies the token, confirms it belongs
 * to the address the seat was granted to, and stores it.
 */
export async function linkGoLoginAccount(uid: string, apiKey: string): Promise<GoLoginAccountDoc> {
  if (!isTokenCryptoConfigured()) {
    throw new GoLoginLinkError(
      'not-configured',
      'GoLogin is not fully configured on the server (GL_TOKEN_ENC_KEY is missing).',
      503,
    );
  }

  if (await isGoLoginAdmin(uid)) {
    // The owner's key *is* the master key, and the check below refuses that on
    // purpose. Nothing to store, nothing to verify.
    throw new GoLoginLinkError(
      'master-key',
      'You own the GoLogin workspace — Bluu already uses your key. No token needed.',
      409,
    );
  }

  const existing = await getGoLoginAccount(uid);
  if (!existing?.glEmail) {
    throw new GoLoginLinkError(
      'not-a-member',
      'You have not been added to the GoLogin workspace yet. Ask an admin.',
      403,
    );
  }

  let identity: GoLoginAccountInfo;
  try {
    identity = await getUserGoLoginClient(apiKey).getAccount();
  } catch (err) {
    if (err instanceof GoLoginApiError && err.status === 401) {
      throw new GoLoginLinkError('invalid-key', 'GoLogin did not accept that API token.', 400);
    }
    throw err;
  }
  if (!identity.email || !identity.id) {
    throw new GoLoginLinkError('no-email', 'That GoLogin account has no email address on it.', 400);
  }

  // Refuse the master key outright. Pasted here it would hand one operator the
  // whole workspace, and would look identical to a normal link from outside.
  const master = await getMasterAccount();
  if (master.id && identity.id === master.id) {
    throw new GoLoginLinkError(
      'master-key',
      'That is the shared workspace key, not your personal one.',
      400,
    );
  }

  // The token must belong to the account the seat was granted to. Without this
  // someone could hold a seat under one address and paste a token for another,
  // and their listing would then be scoped to the wrong folder.
  if (normalizeEmail(identity.email) !== normalizeEmail(existing.glEmail)) {
    throw new GoLoginLinkError(
      'wrong-account',
      `That token belongs to ${identity.email}, but your seat was granted to ${existing.glEmail}.`,
      400,
    );
  }

  const doc: GoLoginAccountDoc = {
    ...existing,
    uid,
    glUserId: identity.id,
    tokenCipher: encryptToken(apiKey),
    tokenAddedAtMs: Date.now(),
    planName: identity.planName,
  };
  await adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).doc(uid).set(doc);

  await adminDb.collection('users').doc(uid).set(
    { gologinLinkedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  invalidateUserCache(uid);

  return doc;
}

/**
 * Forget an operator's token, keeping their seat and folder.
 *
 * The "my key stopped working" path, not the offboarding one — that is
 * `removeGoLoginMember`.
 */
export async function unlinkGoLoginToken(uid: string): Promise<void> {
  await adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).doc(uid).set(
    {
      tokenCipher: FieldValue.delete(),
      tokenAddedAtMs: FieldValue.delete(),
      glUserId: FieldValue.delete(),
    },
    { merge: true },
  );
  await adminDb
    .collection('users')
    .doc(uid)
    .set({ gologinLinkedAt: FieldValue.delete() }, { merge: true });
  invalidateUserCache(uid);
}

/** Build the renderer-safe summary, including live membership state. */
export async function getAccountSummary(uid: string): Promise<GoLoginAccountSummary> {
  // Admins are reported as fully set up, because they are: the token exists
  // (it is the master one) and there is no seat or folder to wait on. Without
  // this they would be sent to an onboarding screen with nothing to do.
  if (await isGoLoginAdmin(uid)) {
    const master = await getMasterAccount();
    return {
      linked: !!process.env.GL_API_TOKEN,
      member: true,
      joined: true,
      glEmail: master.email,
      folderName: '',
      planName: master.planName,
      linkedAtMs: null,
    };
  }

  const { member, joined, account } = await getMembershipStatus(uid);
  if (!account) return EMPTY_ACCOUNT_SUMMARY;
  return {
    linked: !!account.tokenCipher,
    member,
    joined,
    glEmail: account.glEmail,
    folderName: account.folderName,
    planName: account.planName ?? '',
    linkedAtMs: account.tokenAddedAtMs ?? null,
  };
}
