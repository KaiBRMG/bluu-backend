/**
 * The desktop installers, as the public `/download` page offers them. Client-safe:
 * ids and shapes only. The lookup against GitHub lives in
 * [`installerReleases.ts`](installerReleases.ts), which is server-only.
 */

export const INSTALLER_PLATFORMS = ['windows', 'mac-arm', 'mac-intel'] as const;

export type InstallerPlatform = (typeof INSTALLER_PLATFORMS)[number];

export function isInstallerPlatform(value: string): value is InstallerPlatform {
  return (INSTALLER_PLATFORMS as readonly string[]).includes(value);
}

/**
 * `GET /api/download` — the version each button will actually hand over, per
 * platform. `null` when no published release carries that platform's file, or
 * when GitHub could not be reached; the page then drops the version chip rather
 * than guess one.
 */
export type InstallerVersions = Record<InstallerPlatform, string | null>;

/** The link a download button points at. A 302 to the file on GitHub. */
export function installerHref(platform: InstallerPlatform): string {
  return `/api/download/${platform}`;
}
