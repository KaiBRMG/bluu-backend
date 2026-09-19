/**
 * Desktop app update config — the single gate for **every** Electron update
 * prompt, on both platforms. If this file doesn't target a platform, users on
 * that platform are never prompted, full stop. Nothing else decides.
 *
 * ▸ **Per-platform.** A release rarely matters to both OSes equally: v0.8.0 is
 *   what gives macOS auto-update, and is irrelevant to Windows. Set that
 *   platform to `null` and those users are left alone rather than nagged about
 *   a build that does nothing for them.
 *
 * ▸ **`null` means "no update targeted"** — no banner, no dialog, nothing. This
 *   is the default state between releases. It does NOT mean "optional".
 *
 * ▸ **Per-cohort, under the platform.** Each entry (`mac`, `win`, `releaseNote`)
 *   also carries `allUsers` / `uids` / `groups` — see `UpdateCohort`. That makes
 *   a release stageable: pilot it on yourself, then a group, then the fleet,
 *   each step a one-line commit. `allUsers: true` is the whole fleet and the
 *   historical behaviour. **The cohort is resolved server-side** and only the
 *   caller's own answer crosses the wire, so a renderer never holds the list of
 *   who else is targeted.
 *
 * ▸ macOS is still gated by this file even though it can auto-update: a GitHub
 *   release alone never prompts anyone. `mac.latestVersion` decides who gets
 *   asked; the running app finds the actual artifact via `electron-updater`.
 *
 * ▸ **Delivery differs, policy doesn't.** `compulsory` and `latestVersion` mean
 *   the same thing on both platforms; only the button differs — macOS downloads
 *   and installs in-app with a progress bar, Windows opens `downloadUrl` for a
 *   manual reinstall. **`downloadUrl` is never shown to a Mac**: auto-update is
 *   the only sanctioned path there (a hand reinstall is how users end up on the
 *   wrong arch or on a build that stops auto-updating). A Mac with nothing
 *   pending is told to quit and reopen instead — see `UpdateAvailableBanner`.
 *
 * ▸ **Only bump `latestVersion` AFTER the release artifacts are live** (and, for
 *   Windows, after `downloadUrl` actually serves the new installer). Deploying a
 *   `compulsory` bump early blocks users on a build they cannot obtain.
 *
 * ▸ `compulsory: true`  → blocking dialog; the user can't use the app until they
 *   update. `false` → dismissible card. Either way it is **never shown to a user
 *   who is clocked in** — but it is no longer start-up only: the banner
 *   re-evaluates on every clock-out, and reads this config over HTTP
 *   (`fetchAppUpdateConfig`) so a renderer that has been running for days still
 *   sees it. Arming this file reaches the fleet without waiting for relaunches.
 *   On Windows prefer `false` for routine releases: updating means quitting and
 *   reinstalling by hand.
 */
import { PUBLIC_APP_ORIGIN } from './publicOrigin';
import { compareSemver } from './semver';

/**
 * Who a targeted release is aimed at — the second gate, under the platform one.
 *
 * ▸ **A user matches when `allUsers` is true, OR their uid is in `uids`, OR one
 *   of their groups is in `groups`.** The same three-way test as
 *   [`announcementConfig.ts`](announcementConfig.ts) and
 *   [`emailMigrationConfig.ts`](emailMigrationConfig.ts), so a staged rollout is
 *   a one-line commit here rather than a code change.
 *
 * ▸ **Piloting a release on yourself is `allUsers: false` + `uids: ['<your
 *   uid>']`.** Nobody else is prompted — and nobody else is even told the entry
 *   exists, because the cohort is resolved server-side (`/api/app-update`) and
 *   only the matched user's answer crosses the wire.
 *
 * ▸ **`allUsers: false` with both lists empty targets nobody.** It is inert, not
 *   a wildcard. That makes "ship the entry disarmed, arm it in its own commit"
 *   expressible without setting the platform back to `null`.
 *
 * ▸ **A cohort only ever narrows.** `latestVersion` and `compulsory` still
 *   decide what a matched user is told; this decides only whether they are
 *   considered at all. In particular it does NOT relax cross-cutting rule 14 —
 *   a cohort of one, armed before the artifacts exist, is still one person
 *   blocked on a build they cannot obtain.
 *
 * ▸ **Groups are the user's `groups` array** ('CA', 'SMM', 'OFAM', 'admin', …),
 *   read from the caller's own `users` doc — never from anything the client
 *   claims.
 */
export interface UpdateCohort {
  /** Target everyone. Ignores `uids`/`groups`. */
  allUsers: boolean;
  /** Individual uids — the pilot and volunteer cohort. */
  uids: string[];
  /** Group slugs ('CA', 'SMM', 'OFAM', 'admin', …). */
  groups: string[];
}

/**
 * The half of a platform entry the renderer is allowed to see: the policy, with
 * the cohort stripped. Split for the same reason `ClientAnnouncement` is — the
 * cohort lists name colleagues, and a client needs none of that to draw a
 * banner it has already been told applies to it.
 */
export interface ClientPlatformUpdate {
  /** Clients running older than this are prompted. Compared with semver. */
  latestVersion: string;
  /** true → blocking dialog. false → dismissible card. */
  compulsory: boolean;
}

/** A platform entry as authored here: policy + who it is aimed at. */
export interface PlatformUpdate extends ClientPlatformUpdate, UpdateCohort {}

/**
 * The "what's new" notification for a release — the other half of a release, and
 * the mirror image of the prompt above: `PlatformUpdate` targets people who have
 * **not** updated yet, `ReleaseNote` targets people who **have**.
 *
 * ▸ **Version only. No copy.** RULE 1 of the notification system is that titles
 *   and messages live in `notificationContent.ts` and nowhere else, so this
 *   holds the gate and `notifications.releaseNote()` holds the words. **Rewrite
 *   that factory in the same commit that bumps this version** — it describes one
 *   specific release, and a bumped version pointing at last release's copy is
 *   the one failure mode here.
 *
 * ▸ **Not per-platform**, unlike the prompt above. The prompt asks people to do
 *   work, so it is worth sparing an OS a release that does nothing for it; a
 *   note just tells whoever landed on the version what changed. Where a release
 *   affects the two platforms differently, say so in the copy — the timer widget
 *   is a macOS menu-bar title and a Windows HUD, one feature with two surfaces.
 *
 * ▸ **`null` → nobody is notified.** The default state between releases.
 *
 * ▸ **Delivered once per user, ever, per version.** `users/{uid}
 *   .releaseNoteNotifiedVersion` records what they have been told about, and the
 *   send is gated on the version they actually report running — so nobody hears
 *   about a build they are not on, which is the whole point.
 *
 * ▸ **Users still in first-run onboarding never receive it.** The route marks
 *   them as notified instead of sending — the whole app is new to them, so a
 *   "what's new" note is noise, and marking stops it arriving late the moment
 *   they finish. Only the note armed at that moment is suppressed.
 *
 * ▸ **Unlike `latestVersion`, this is safe to arm in the same push as the code**
 *   (cross-cutting rule 14's two-push dance does not apply to it): it can only
 *   fire for a user whose installed build already reports >= `version`, and
 *   nobody can be on that build before the release exists. Arming early is inert
 *   rather than dangerous. Arming *late* is the risk — see `AppVersionReporter`.
 */
/** The half of a release note the renderer sees — the version gate, no cohort. */
export interface ClientReleaseNote {
  /** Users running this version or newer are notified — once, ever. */
  version: string;
}

/**
 * A release note as authored here: version gate + cohort.
 *
 * ▸ **The cohort is `AND`ed with the version**, not `OR`ed: a user is told about
 *   the release only if they are in the cohort *and* already running it. Gating
 *   a note is therefore "who, of the people on this build, hears about it".
 *
 * ▸ **A user outside the cohort is not marked as notified.** Adding them later
 *   still delivers the note, which is what makes a staged note worth having —
 *   see `POST /api/user/app-version`.
 */
export interface ReleaseNote extends ClientReleaseNote, UpdateCohort {}

/** The config as authored here — cohorts included. Server-side only. */
export interface AppUpdateConfig {
  /** `null` → macOS users are never prompted. */
  mac: PlatformUpdate | null;
  /** `null` → Windows users are never prompted. */
  win: PlatformUpdate | null;
  /** Manual-install landing page (.dmg / .exe). **Windows only** — macOS is
   *  never sent here by the update prompt; it updates in-app or not at all. */
  downloadUrl: string;
  /** `null` → no release note is sent to anyone. */
  releaseNote: ReleaseNote | null;
}

/**
 * The config as it crosses the wire: already resolved for one caller, with the
 * cohort lists removed. A `null` platform here means "nothing is targeted **at
 * you**" — either the platform is disarmed or you are outside its cohort, and
 * the client deliberately cannot tell those apart.
 */
export interface ClientAppUpdateConfig {
  mac: ClientPlatformUpdate | null;
  win: ClientPlatformUpdate | null;
  downloadUrl: string;
  releaseNote: ClientReleaseNote | null;
}

export const APP_UPDATE: AppUpdateConfig = {

  // `latestVersion` here is a POLICY (who gets prompted). The version the public
  // /download page prints on its buttons is a FACT about the Drive folders and
  // lives in `latestRelease.ts` — keep the two in step when a release ships.

  // Cohort reminder: `allUsers: true` is the whole fleet (the historical
  // behaviour, and the right end state for a real release). To pilot one first,
  // set `allUsers: false` and list uids or group slugs instead — see
  // `UpdateCohort`. `allUsers: false` with both lists empty prompts nobody.

  mac: { latestVersion: '0.13.0', compulsory: false, allUsers: true, uids: [], groups: ['admin'] },
  // mac: null,

  win: null,
  // win: { latestVersion: '0.10.1', compulsory: true, allUsers: true, uids: [], groups: [] },

  downloadUrl: `${PUBLIC_APP_ORIGIN}/download`,

  // The session timer widget. Ships armed alongside the v0.10.1 code: see above,
  // it cannot fire before that build exists, so there is nothing to stage.
  // Set notification contents in `src\lib\notificationContent.ts`
  // releaseNote: { version: '0.10.1', allUsers: true, uids: [], groups: [] },
  releaseNote: null,
};

/**
 * The shape the user side of a cohort match needs. Kept structural — same trick
 * as `AnnouncementAudience` — so a `users` doc (server) and the `useUserData`
 * snapshot (client) both satisfy it without a shared import.
 */
export interface UpdateAudience {
  uid?: string | null;
  groups?: string[] | null;
}

/**
 * Is this user in the entry's cohort?
 *
 * **`null`/`undefined` audience matches only `allUsers`.** That is the
 * load-bearing default, not a convenience: every path that cannot identify the
 * caller — an unauthenticated `/api/app-update` request, the offline fallback in
 * `fetchAppUpdateConfig` — lands here, and the safe answer for "I don't know who
 * you are" is "only what was aimed at everybody". Guessing the other way would
 * let a pilot entry, possibly `compulsory`, reach the whole fleet the moment a
 * token was missing.
 */
export function matchesUpdateCohort(
  cohort: UpdateCohort | null | undefined,
  user: UpdateAudience | null | undefined,
): boolean {
  if (!cohort) return false;
  if (cohort.allUsers) return true;
  if (!user) return false;
  if (user.uid && cohort.uids.includes(user.uid)) return true;
  return (user.groups ?? []).some((g) => cohort.groups.includes(g));
}

/** Drop the cohort fields — everything past this point is client-visible. */
function toClientPlatform(entry: PlatformUpdate | null): ClientPlatformUpdate | null {
  return entry ? { latestVersion: entry.latestVersion, compulsory: entry.compulsory } : null;
}

/**
 * The config as it applies to **one** user: entries whose cohort they are not in
 * become `null`, and the cohort lists never leave the server.
 *
 * This is the only thing that should build the `/api/app-update` response. The
 * alternative — shipping the cohorts and matching in the renderer — would put a
 * list of colleagues' uids in every client's memory to answer a question the
 * server already knows the answer to.
 */
export function resolveAppUpdateConfigFor(
  config: AppUpdateConfig,
  user: UpdateAudience | null | undefined,
): ClientAppUpdateConfig {
  return {
    mac: toClientPlatform(matchesUpdateCohort(config.mac, user) ? config.mac : null),
    win: toClientPlatform(matchesUpdateCohort(config.win, user) ? config.win : null),
    downloadUrl: config.downloadUrl,
    releaseNote:
      config.releaseNote && matchesUpdateCohort(config.releaseNote, user)
        ? { version: config.releaseNote.version }
        : null,
  };
}

/**
 * Does this user's reported build qualify for the current release note — and are
 * they in its cohort?
 *
 * Both halves, because the two are only meaningful together. `user` is optional
 * and omitting it means "only an `allUsers` note qualifies" (see
 * `matchesUpdateCohort`), so a caller that cannot identify anybody fails closed
 * rather than notifying the fleet.
 */
export function releaseNoteAppliesTo(
  version: string | null,
  user?: UpdateAudience | null,
): boolean {
  return (
    releaseNoteVersionQualifies(version) && matchesUpdateCohort(APP_UPDATE.releaseNote, user)
  );
}

/**
 * The version half of the test on its own — "is there a note armed, and is this
 * build new enough for it?" — with no opinion on who the user is.
 *
 * Exported so the server can ask the cheap question *before* reading the user
 * doc it needs for the cohort half. Between releases (`releaseNote: null`) this
 * is false and no read happens at all, which is what keeps the release note off
 * the steady-state I/O budget (rule 9). Never use it as the gate on its own.
 */
export function releaseNoteVersionQualifies(version: string | null): boolean {
  const note = APP_UPDATE.releaseNote;
  if (!note || !version) return false;
  return compareSemver(version, note.version) >= 0;
}

/** Maps a native `process.platform` onto a config's entry. Returns null for
 *  unknown platforms and for platforms with no update targeted.
 *
 *  Takes the **client** shape: by the time a renderer holds a config, the cohort
 *  has already been applied server-side and a platform it is not in reads as
 *  `null`. Passing the authored `APP_UPDATE` here would skip that check, which
 *  is why `getPlatformUpdate` below takes an audience. */
export function resolvePlatformUpdate(
  config: ClientAppUpdateConfig,
  platform: string | null,
): ClientPlatformUpdate | null {
  if (platform === 'darwin') return config.mac;
  if (platform === 'win32') return config.win;
  return null;
}

/** Same, against the compiled-in config, for a given user. Server-side callers
 *  should pass the audience from the `users` doc; omitting it narrows to
 *  `allUsers` entries. */
export function getPlatformUpdate(
  platform: string | null,
  user?: UpdateAudience | null,
): ClientPlatformUpdate | null {
  return resolvePlatformUpdate(resolveAppUpdateConfigFor(APP_UPDATE, user), platform);
}

/**
 * Read the config **as it is deployed right now**, not as it was compiled into
 * the bundle this renderer happens to be running.
 *
 * This exists for one specific user: the one who never quits the app. Vercel
 * ships a new bundle in seconds, but Electron only picks it up on a **full page
 * load** — so someone who leaves the app running for a week is still executing
 * the `APP_UPDATE` constant from the day they launched. Arming a release would
 * never reach them, no matter how often the banner re-evaluates. Fetching over
 * HTTP is what makes "arm the config → everyone is prompted" true for them too.
 *
 * **Pass `idToken` whenever the caller has one.** The cohort match runs
 * server-side, so the route can only narrow to this user if it knows who they
 * are; without a token it answers with `allUsers` entries only. That is correct
 * — not a bug to work around — but it does mean a targeted release silently
 * misses a caller that forgets the token, which is the failure this parameter
 * exists to make visible.
 *
 * Falls back to the compiled constant when the request fails (offline, or a
 * build old enough to predate the route), **narrowed to `allUsers` entries** by
 * `resolveAppUpdateConfigFor(APP_UPDATE, null)`. That narrowing is the one real
 * change from the old behaviour, and it is deliberate: the renderer cannot
 * evaluate a cohort it is never sent, so the honest offline answer is "only what
 * was aimed at everybody". Falling back to the raw constant instead would prompt
 * — possibly block, on a `compulsory` entry — every user who briefly lost the
 * network, including the ones a pilot was carefully kept away from. For an
 * `allUsers` release (the normal case) the fallback is byte-for-byte what it
 * always was, so the fetch still only ever adds prompts, never removes them.
 *
 * Deliberately uncached: a stale-while-revalidate hit would reintroduce the very
 * staleness this is here to fix.
 */
export async function fetchAppUpdateConfig(idToken?: string | null): Promise<ClientAppUpdateConfig> {
  const fallback = () => resolveAppUpdateConfigFor(APP_UPDATE, null);
  try {
    const res = await fetch('/api/app-update', {
      cache: 'no-store',
      headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
    });
    if (!res.ok) return fallback();
    const data: unknown = await res.json();
    if (!isAppUpdateConfig(data)) return fallback();
    return data;
  } catch {
    return fallback();
  }
}

function isPlatformUpdate(value: unknown): value is ClientPlatformUpdate | null {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.latestVersion === 'string' && typeof v.compulsory === 'boolean';
}

/** The response is same-origin and our own, but it decides whether a user is
 *  locked out of the app — so it is shape-checked rather than trusted. */
function isAppUpdateConfig(value: unknown): value is ClientAppUpdateConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    isPlatformUpdate(v.mac) &&
    isPlatformUpdate(v.win) &&
    typeof v.downloadUrl === 'string'
  );
}



