/**
 * GoLogin client factory — the one place a provider implementation is chosen.
 *
 * Server-only. Nothing under `src/lib/gologin/**` may be imported from a client
 * component: it handles API tokens.
 *
 * **Two identities, deliberately.** Since the per-user rollout there is no
 * single "the GoLogin client":
 *
 *   - `getMasterGoLoginClient()` speaks as the **workspace owner** (`GL_API_TOKEN`).
 *     It is the only identity that can create folders, share them, and move
 *     profiles between them — i.e. everything on the admin Management surface.
 *     It never leaves the server any more.
 *   - `getUserGoLoginClient(token)` speaks as **one operator**, using the personal
 *     token they supplied at onboarding. This is what lists the profiles they can
 *     see and what launches a browser on their machine.
 *
 * Keeping them apart is the point: an operator listing profiles can only ever see
 * what has been shared into their own account, enforced by GoLogin rather than by
 * a filter we wrote.
 */
import 'server-only';
import { createGoLoginApiClient, PROFILES_PER_PAGE } from './providers/gologinApi';
import { GoLoginApiError, type IGoLoginClient } from './types';

export { GoLoginApiError, PROFILES_PER_PAGE };
export { GOLOGIN_MANAGED_FOLDER_PREFIX, isManagedGoLoginFolder } from './types';
export type {
  GoLoginAccountInfo,
  GoLoginFolder,
  GoLoginMember,
  GoLoginMemberRole,
  GoLoginProfile,
  GoLoginProfilePage,
  GoLoginShareRole,
  GoLoginWorkspace,
  IGoLoginClient,
} from './types';

/**
 * The role every operator's folder share is created with.
 *
 * **`redactor`, not `guest`.** Running a profile writes its session back: the
 * teardown in `electron/main.js` calls `gl.stop()`, which uploads the profile's
 * cookies and local state to GoLogin. A read-only recipient would lose that work
 * on every session — the operator logs into an account, closes the browser, and
 * is logged out again next time. `administrator` is deliberately not used: it
 * would let any operator re-share the workspace's profiles onward.
 */
export const GOLOGIN_SHARE_ROLE = 'redactor' as const;

/**
 * The workspace role every operator's seat is granted with.
 *
 * **`editor`, not `guest`.** Running a profile *writes*: the teardown in
 * `electron/main.js` calls `gl.stop()`, which uploads the profile's cookies and
 * local state back to GoLogin. A read-only member would lose that on every
 * session — they would log into an account, close the browser, and be logged out
 * again next time. `admin` and `owner` are deliberately not used: either would
 * let an operator manage the workspace and re-scope their own folder access,
 * which is the whole thing the assignment surface exists to control.
 *
 * Always paired with `limitedAccess: true`, without which the role applies to
 * the entire workspace rather than to their own folder.
 */
export const GOLOGIN_MEMBER_ROLE = 'editor' as const;

let masterClient: IGoLoginClient | null = null;

/** The workspace owner. Folder + share administration only. */
export function getMasterGoLoginClient(): IGoLoginClient {
  if (masterClient) return masterClient;
  const token = process.env.GL_API_TOKEN;
  if (!token) {
    // Fail closed and say which variable is missing — an empty result would read
    // as "there are no folders", which is a different fact.
    throw new GoLoginApiError('GL_API_TOKEN is not configured.', 503);
  }
  masterClient = createGoLoginApiClient(token);
  return masterClient;
}

/**
 * One operator's own account.
 *
 * Not memoised: the token is decrypted per request and must not be pinned into a
 * module-scope map that would outlive a revocation. Constructing a client is a
 * closure over a string — it costs nothing.
 */
export function getUserGoLoginClient(token: string): IGoLoginClient {
  if (!token) throw new GoLoginApiError('No GoLogin API key on file for this user.', 428);
  return createGoLoginApiClient(token);
}
