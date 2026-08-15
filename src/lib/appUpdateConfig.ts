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
 * ▸ macOS is still gated by this file even though it can auto-update: a GitHub
 *   release alone never prompts anyone. `mac.latestVersion` decides who gets
 *   asked; the running app finds the actual artifact via `electron-updater`.
 *
 * ▸ **Delivery differs, policy doesn't.** `compulsory` and `latestVersion` mean
 *   the same thing on both platforms; only the button differs — macOS (v0.8.0+)
 *   downloads and installs in-app with a progress bar, Windows opens
 *   `downloadUrl` for a manual reinstall. A pre-0.8.0 mac build has no updater,
 *   so it falls back to `downloadUrl` too — `UpdateAvailableBanner` picks the
 *   delivery by feature-detecting the native updater, not by platform.
 *
 * ▸ **Only bump `latestVersion` AFTER the release artifacts are live** (and, for
 *   Windows, after `downloadUrl` actually serves the new installer). Deploying a
 *   `compulsory` bump early blocks users on a build they cannot obtain.
 *
 * ▸ `compulsory: true`  → blocking dialog; the user can't use the app until they
 *   update. `false` → dismissible card. Either way it is **start-up only** and
 *   never shown to a user who is clocked in — see `UpdateAvailableBanner`.
 *   On Windows prefer `false` for routine releases: updating means quitting and
 *   reinstalling by hand.
 */
import { PUBLIC_APP_ORIGIN } from './publicOrigin';
import { compareSemver } from './semver';

export interface PlatformUpdate {
  /** Clients running older than this are prompted. Compared with semver. */
  latestVersion: string;
  /** true → blocking dialog. false → dismissible card. */
  compulsory: boolean;
}

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
 * ▸ **Unlike `latestVersion`, this is safe to arm in the same push as the code**
 *   (cross-cutting rule 14's two-push dance does not apply to it): it can only
 *   fire for a user whose installed build already reports >= `version`, and
 *   nobody can be on that build before the release exists. Arming early is inert
 *   rather than dangerous. Arming *late* is the risk — see `AppVersionReporter`.
 */
export interface ReleaseNote {
  /** Users running this version or newer are notified — once, ever. */
  version: string;
}

export interface AppUpdateConfig {
  /** `null` → macOS users are never prompted. */
  mac: PlatformUpdate | null;
  /** `null` → Windows users are never prompted. */
  win: PlatformUpdate | null;
  /** Manual-install landing page (.dmg / .exe). Used by Windows, and by
   *  pre-0.8.0 mac builds that have no in-app updater. */
  downloadUrl: string;
  /** `null` → no release note is sent to anyone. */
  releaseNote: ReleaseNote | null;
}

export const APP_UPDATE: AppUpdateConfig = {


  mac: { latestVersion: '0.10.1', compulsory: true },
  // mac: null,

  // win: null,
  win: { latestVersion: '0.10.1', compulsory: true },

  downloadUrl: `${PUBLIC_APP_ORIGIN}/download`,

  // The session timer widget. Ships armed alongside the v0.10.1 code: see above,
  // it cannot fire before that build exists, so there is nothing to stage.
  // Set notification contents in `src\lib\notificationContent.ts`
  releaseNote: { version: '0.10.1' },
  // releaseNote: null,
};

/** Does this user's reported build qualify for the current release note? */
export function releaseNoteAppliesTo(version: string | null): boolean {
  const note = APP_UPDATE.releaseNote;
  if (!note || !version) return false;
  return compareSemver(version, note.version) >= 0;
}

/** Maps a native `process.platform` onto its config entry. Returns null for
 *  unknown platforms and for platforms with no update targeted. */
export function getPlatformUpdate(platform: string | null): PlatformUpdate | null {
  if (platform === 'darwin') return APP_UPDATE.mac;
  if (platform === 'win32') return APP_UPDATE.win;
  return null;
}
