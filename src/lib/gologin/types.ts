/**
 * GoLogin domain model + the client contract.
 *
 * Same seam as `src/lib/onlyfans/types.ts`: nothing above this file may know a
 * GoLogin URL, header or payload shape. The only implementation lives in
 * `providers/gologinApi.ts`; swapping it is a second file plus one line in
 * `index.ts`.
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
 * fingerprint (navigator, WebGL, fonts), the proxy's **credentials**, and a
 * `facebookAccountData` block containing an account password. None of that has
 * any business reaching a renderer, so normalisation here is a security
 * boundary as much as a convenience one — see `normaliseProfile`.
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

export interface IGoLoginClient {
  /** `page` is 1-based, matching the provider. */
  listProfiles(page: number): Promise<GoLoginProfilePage>;
}
