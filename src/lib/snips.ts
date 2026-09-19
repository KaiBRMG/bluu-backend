/**
 * Snipping Tool — the values shared by the renderer, the API routes and the
 * public page.
 *
 * Nothing in here touches Firestore or the Storage SDK, so it is safe to import
 * from a client component. The server-only half lives in
 * `src/lib/services/snipService.ts`.
 */

/**
 * The page permission that gates the whole tool — the page, every API route,
 * and (pushed to Electron by `SnipController`) the tray item and the global
 * shortcut.
 *
 * Declared here rather than in the service so a client component can read it
 * without pulling `firebase-admin` into the bundle.
 */
export const SNIPPING_TOOL_PAGE_ID = 'apps-snipping-tool';

// ─── Share tokens ────────────────────────────────────────────────────

/**
 * A snip's share token is also its **Firestore document id**, which is the one
 * meaningful difference from the prompt library's share (`promptLibraryService`),
 * where a second `prompt-shares` index doc maps token → prompt.
 *
 * A prompt exists before it is shared and is addressed by its own id in internal
 * URLs, so its share token has to be a separate, later-minted secret. A snip is
 * *born* shared — nothing addresses it by any other id, and no internal surface
 * prints one — so a separate index would be a second document and a second read
 * per public page view for no gain. The doc id carries the same ~160 bits.
 *
 * The consequence to keep in mind: **a snip id is a secret.** It must never be
 * logged, put in an error message, or returned by any route that has not
 * authorised the caller as the owner.
 */
const SHARE_ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const SHARE_ID_LENGTH = 32;

const SHARE_ID_RE = new RegExp(`^[${SHARE_ID_ALPHABET}]{${SHARE_ID_LENGTH}}$`);

export function isValidSnipId(value: unknown): value is string {
  return typeof value === 'string' && SHARE_ID_RE.test(value);
}

export { SHARE_ID_ALPHABET };

// ─── Storage ─────────────────────────────────────────────────────────

export const SNIP_STORAGE_PREFIX = 'snips';

/** PNG only. The overlay crops from a `nativeImage`, so there is one producer
 *  and exactly one format — an allowlist with one entry is still an allowlist. */
export const SNIP_CONTENT_TYPE = 'image/png';

/** A full-resolution capture of a 6K display lands well under this; a request
 *  claiming more is not a screenshot. */
export const MAX_SNIP_BYTES = 25 * 1024 * 1024;

// ─── Retention ───────────────────────────────────────────────────────

export type SnipRetention = '1m' | '3m' | '6m' | '1y' | 'never';

export const SNIP_RETENTION_OPTIONS: ReadonlyArray<{
  value: SnipRetention;
  label: string;
  /** Whole months from creation. `null` = kept until deleted by hand. */
  months: number | null;
}> = [
  { value: '1m', label: '1 month', months: 1 },
  { value: '3m', label: '3 months', months: 3 },
  { value: '6m', label: '6 months', months: 6 },
  { value: '1y', label: '1 year', months: 12 },
  { value: 'never', label: 'Never', months: null },
];

export const DEFAULT_SNIP_RETENTION: SnipRetention = '6m';

export function isSnipRetention(value: unknown): value is SnipRetention {
  return SNIP_RETENTION_OPTIONS.some(option => option.value === value);
}

export function snipRetentionLabel(retention: SnipRetention): string {
  return SNIP_RETENTION_OPTIONS.find(o => o.value === retention)?.label ?? retention;
}

/**
 * When a snip created at `createdAtMs` expires under `retention`, or `null` for
 * "never".
 *
 * Month arithmetic via `setUTCMonth` deliberately: adding 30-day blocks makes
 * "1 month" drift against the calendar, and a retention the user reads as a
 * month must delete on the same day of the following month. A 31st that has no
 * counterpart rolls into the next month, which is the standard JS behaviour and
 * is correct here — one extra day of retention, never one fewer.
 */
export function snipExpiryMs(createdAtMs: number, retention: SnipRetention): number | null {
  const months = SNIP_RETENTION_OPTIONS.find(o => o.value === retention)?.months;
  if (months == null) return null;
  const date = new Date(createdAtMs);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

// ─── Keyboard shortcut ───────────────────────────────────────────────

/**
 * Electron accelerator, not a browser key string. `CommandOrControl` resolves to
 * ⌘ on macOS and Ctrl elsewhere, which is exactly the "ctrl/cmd+shift+s" the
 * tool ships with.
 */
export const DEFAULT_SNIP_SHORTCUT = 'CommandOrControl+Shift+S';

const ACCELERATOR_MODIFIERS = new Set([
  'CommandOrControl',
  'CmdOrCtrl',
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
]);

const ACCELERATOR_KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown',
  'Escape', 'Plus', 'numadd', 'numsub', 'numdec',
  '~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '_', '=',
  '[', ']', '{', '}', '\\', '|', ';', ':', "'", '"', ',', '.', '/', '<', '>', '?', '`',
]);

/**
 * Validates an accelerator **before** it reaches `globalShortcut.register`.
 *
 * Two reasons this is not left to Electron. `register` *throws* on a malformed
 * accelerator rather than returning false, and it happily accepts a bare key
 * with no modifier — registering `S` globally would swallow every `s` the user
 * types in every other application on the machine, with no way to fix it from
 * inside an app they can no longer type in.
 *
 * So: at least one modifier, exactly one non-modifier key, nothing longer than
 * a sane accelerator. Shared by the settings dialog (to refuse a bad binding at
 * the point it is chosen) and by the API route (because the dialog is not the
 * authority on what gets stored).
 */
export function isValidSnipShortcut(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  const parts = value.split('+');
  if (parts.length < 2 || parts.length > 5) return false;

  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (!ACCELERATOR_KEYS.has(key)) return false;
  if (modifiers.length === 0) return false;
  if (new Set(modifiers).size !== modifiers.length) return false;
  return modifiers.every(m => ACCELERATOR_MODIFIERS.has(m));
}

/** `CommandOrControl+Shift+S` → `⌘ ⇧ S` / `Ctrl Shift S`, for display only. */
export function formatSnipShortcut(accelerator: string, platform: 'darwin' | 'other'): string {
  const mac = platform === 'darwin';
  const symbols: Record<string, string> = mac
    ? {
        CommandOrControl: '⌘', CmdOrCtrl: '⌘', Command: '⌘', Cmd: '⌘', Meta: '⌘', Super: '⌘',
        Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧',
      }
    : {
        CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Control: 'Ctrl', Ctrl: 'Ctrl',
        Command: 'Win', Cmd: 'Win', Meta: 'Win', Super: 'Win',
        Alt: 'Alt', Option: 'Alt', Shift: 'Shift',
      };
  const parts = accelerator.split('+');
  const rendered = parts.map(part => symbols[part] ?? part.toUpperCase());
  return mac ? rendered.join(' ') : rendered.join(' + ');
}

// ─── Settings ────────────────────────────────────────────────────────

export interface SnipSettings {
  /** The macOS menu-bar item / Windows tray icon. Default on. */
  trayIconEnabled: boolean;
  /** The global keyboard shortcut. Default `CommandOrControl+Shift+S`. */
  shortcutEnabled: boolean;
  shortcut: string;
  retention: SnipRetention;
}

export const DEFAULT_SNIP_SETTINGS: SnipSettings = {
  trayIconEnabled: true,
  shortcutEnabled: true,
  shortcut: DEFAULT_SNIP_SHORTCUT,
  retention: DEFAULT_SNIP_RETENTION,
};

/**
 * Fills a partial/absent `snipSettings` map with the defaults.
 *
 * Every field defaults ON or to a value, so **absent must read as the default,
 * not as off** — the same `!== false` discipline `timerWidgetEnabled` uses. A
 * user who has never opened the settings card still gets a working shortcut.
 */
export function resolveSnipSettings(raw: Partial<SnipSettings> | undefined | null): SnipSettings {
  return {
    trayIconEnabled: raw?.trayIconEnabled !== false,
    shortcutEnabled: raw?.shortcutEnabled !== false,
    shortcut: isValidSnipShortcut(raw?.shortcut) ? raw!.shortcut! : DEFAULT_SNIP_SHORTCUT,
    retention: isSnipRetention(raw?.retention) ? raw.retention : DEFAULT_SNIP_RETENTION,
  };
}

// ─── Links ───────────────────────────────────────────────────────────

/** The public route a snip is served from. Allowlisted in `src/middleware.ts`. */
export const SNIP_PUBLIC_PREFIX = '/s';
