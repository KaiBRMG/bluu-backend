/**
 * Desktop app update config — the single place to announce a new Electron build.
 *
 * ▸ Edit this file and deploy (Vercel is instant) to push the notice to every
 *   running client. The desktop shell can't auto-update (unsigned builds), so
 *   this drives the in-app "please update" prompt (`UpdateAvailableBanner`).
 *
 * ▸ `latestVersion` — set to the version in `electron/package.json` of the build
 *   you just published. Clients on an older version get the prompt.
 * ▸ `downloadUrl`   — where users download the new installer (.dmg / .exe).
 * ▸ `compulsory`    — `true` for security/critical updates. A compulsory update
 *   BLOCKS the app at start-up until the user updates (they cannot navigate or
 *   use the app). It never interrupts an in-progress session — see
 *   `UpdateAvailableBanner`. `false` shows a dismissible prompt instead.
 * |
 */
export interface AppUpdateConfig {
  latestVersion: string;
  downloadUrl: string;
  compulsory: boolean;
}

export const APP_UPDATE: AppUpdateConfig = {
  latestVersion: '0.7.0',
  downloadUrl: 'https://languid-syzygy-f45.notion.site/Download-Bluu-Backend-31d6a3e187d98080b341e4ed2c9d1917?source=copy_link',
  compulsory: true,

};
