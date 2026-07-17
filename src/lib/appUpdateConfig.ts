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
export interface PlatformUpdate {
  /** Clients running older than this are prompted. Compared with semver. */
  latestVersion: string;
  /** true → blocking dialog. false → dismissible card. */
  compulsory: boolean;
}

export interface AppUpdateConfig {
  /** `null` → macOS users are never prompted. */
  mac: PlatformUpdate | null;
  /** `null` → Windows users are never prompted. */
  win: PlatformUpdate | null;
  /** Manual-install landing page (.dmg / .exe). Used by Windows, and by
   *  pre-0.8.0 mac builds that have no in-app updater. */
  downloadUrl: string;
}

export const APP_UPDATE: AppUpdateConfig = {
  //   mac: { latestVersion: '0.8.0', compulsory: true },
  mac: null,

  win: null,
  downloadUrl: 'https://languid-syzygy-f45.notion.site/Download-Bluu-Backend-31d6a3e187d98080b341e4ed2c9d1917?source=copy_link',
};

/** Maps a native `process.platform` onto its config entry. Returns null for
 *  unknown platforms and for platforms with no update targeted. */
export function getPlatformUpdate(platform: string | null): PlatformUpdate | null {
  if (platform === 'darwin') return APP_UPDATE.mac;
  if (platform === 'win32') return APP_UPDATE.win;
  return null;
}
