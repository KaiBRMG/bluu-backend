/**
 * "A desktop update is downloading or installing right now."
 *
 * A one-bit module flag rather than context, because it has exactly one reader
 * and one writer and it must be readable from an event handler that is not in
 * the React tree: `UpdateAvailableBanner` sets it, `DeploymentRefresher` checks
 * it before reloading the page.
 *
 * The reason it exists: both are armed while the user is clocked out, so they
 * *will* overlap. Reloading mid-download tears down the progress dialog while
 * `electron-updater` keeps going in the main process, leaving the user with a
 * silent download and a prompt inviting them to start a second one. Nothing
 * about the deployment refresh is urgent enough to be worth that — and the
 * install restarts the app anyway, which fetches the new bundle for free.
 */

let inFlight = false;

export function setUpdateInFlight(value: boolean): void {
  inFlight = value;
}

export function isUpdateInFlight(): boolean {
  return inFlight;
}
