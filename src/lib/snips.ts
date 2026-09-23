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

/**
 * The installed Electron build the Snipping Tool needs.
 *
 * Capture is **entirely main-process work** — the global shortcut, the tray
 * item, the transparent selection surfaces, `desktopCapturer` and the crop all
 * ship in `electron/main.js`. None of it can be delivered by a Vercel deploy, so
 * a renderer running inside an older shell (rule 9c — weeks-old renderers are
 * normal here) would render a perfectly working-looking page whose every button
 * does nothing.
 *
 * Feature-detecting `window.electronAPI.snip` would catch today's case on its
 * own. This floor is the thing that stays correct if the bridge is ever
 * backported or partially present, and it is what lets the UI say *"update the
 * app"* rather than *"something went wrong"*. Mirrors `minVersion` on GoLogin's
 * entry in `SATELLITE_PAGES`.
 */
export const SNIPPING_TOOL_MIN_APP_VERSION = '0.13.0';

/**
 * The installed build that added **screen recording**.
 *
 * Deliberately a *second* floor rather than a bump of the one above. Raising
 * `SNIPPING_TOOL_MIN_APP_VERSION` would lock a user on 0.13.x out of the library
 * they already have — their existing snips, their links, their settings — to
 * withhold a mode they never had. So the page floor stays where it is and this
 * one gates the video *mode* alone: an older shell simply never draws the
 * Image/Video toggle on its selection surface, and the page says why.
 *
 * Like the floor above it is `>=` and set once. It must name the build that
 * actually shipped `electron/snip-record.html` and the recorder plumbing in
 * `main.js`, not the one it was planned for.
 */
export const SNIP_VIDEO_MIN_APP_VERSION = '0.14.0';

/**
 * The installed build that added **microphone narration**.
 *
 * A *third* floor, for the same reason the second one exists rather than a
 * bump: raising `SNIP_VIDEO_MIN_APP_VERSION` would take screen recording away
 * from a user on 0.14.x to withhold an audio source they never had.
 *
 * **Narration is the only thing in its release that needs a floor**, and that
 * is worth stating because four other features shipped beside it. Auto-copy,
 * the title/description fields, Import and the public player are all renderer
 * or server work: they reach a user on any shell the moment Vercel deploys, and
 * gating them would withhold working features to enforce a version they do not
 * need. The microphone cannot arrive that way — the toggle and the device
 * picker are drawn by `snip.html` from flags main supplies, the permission
 * status comes over IPC, and macOS additionally needs an entitlement and an
 * Info.plist usage string that only a signed build carries.
 *
 * The two sound effects are the one thing deliberately left ungated. They have
 * no UI to gate, and they degrade to something rather than nothing: the shutter
 * falls back to `snip:captured` (the same capture, a PNG encode later) and the
 * recording cue is simply absent. A version floor over a sound would be a
 * notice about a thing the user has no way to miss.
 *
 * Like the two above it is `>=` and set once. It must name the build that
 * actually ships the microphone plumbing in `main.js` and the macOS
 * capability, not the one it was planned for.
 */
export const SNIP_MIC_MIN_APP_VERSION = '0.14.2';

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

// ─── Kind ────────────────────────────────────────────────────────────

/**
 * A snip is a still or a recording.
 *
 * **Absent means `image`.** Every row written before recording existed has no
 * `kind` field, and there are live share links pointing at them — so the reader
 * defaults rather than the writer backfilling. `resolveSnipKind` is the single
 * place that decision is made; do not re-inline `kind ?? 'image'`.
 */
export type SnipKind = 'image' | 'video';

export function resolveSnipKind(value: unknown): SnipKind {
  return value === 'video' ? 'video' : 'image';
}

/** PNG for a still, and for a recording's poster frame. The overlay crops from
 *  a `nativeImage` and the recorder exports a canvas, so there is one format —
 *  an allowlist with one entry is still an allowlist. */
export const SNIP_CONTENT_TYPE = 'image/png';

// ─── Source ──────────────────────────────────────────────────────────

/**
 * Where a snip's bytes came from.
 *
 * **Absent means `capture`** — every row written before Import existed was one,
 * and there are live share links pointing at them, so the reader defaults rather
 * than a backfill writing the field. Same discipline as `resolveSnipKind`.
 *
 * It is display-only on the owner's surfaces (the "Imported" badge) and is
 * deliberately **not** projected to the public page: how a file reached the
 * library is the owner's business, not the recipient's.
 */
export type SnipSource = 'capture' | 'import';

export function resolveSnipSource(value: unknown): SnipSource {
  return value === 'import' ? 'import' : 'capture';
}

/**
 * The image types Import accepts, and the extension each object is stored under.
 *
 * **An allowlist, not a sniff.** The upload slot pins the content type into the
 * v4 signature, so this map is what a caller is allowed to make us sign — a
 * free-text `contentType` would let someone have us sign a slot for
 * `text/html`, which is an object the image route would then 302 a browser
 * straight at.
 *
 * Deliberately no SVG: an SVG is a script-bearing document, and the image route
 * hands out a signed URL on `storage.googleapis.com` that a browser will happily
 * execute it from. There is no video here either — Import is stills only; a
 * recording has a durable queue, a poster and a resumable session behind it, and
 * none of that applies to a file the user already has on disk.
 */
export const SNIP_IMPORT_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** For the file picker's `accept`, and for the drop zone's own check. */
export const SNIP_IMPORT_ACCEPT = Object.keys(SNIP_IMPORT_TYPES).join(',');

export function isSnipImportType(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SNIP_IMPORT_TYPES, value);
}

/** `image/jpeg` → `jpg`. PNG for anything unrecognised, which cannot happen
 *  behind `isSnipImportType` but keeps the path total. */
export function snipImportExtension(contentType: string): string {
  return SNIP_IMPORT_TYPES[contentType] ?? 'png';
}

// ─── Title & description ─────────────────────────────────────────────

/**
 * A snip has no name of its own — the picture is its identity — so these are
 * both optional and both added *after* the fact, from the library card.
 *
 * The caps are short on purpose. The title sits on a card in a three-column
 * grid and on the public page above the capture; a title that wraps to four
 * lines is a caption competing with the thing it captions.
 */
export const SNIP_TITLE_MAX = 80;
export const SNIP_DESCRIPTION_MAX = 500;

/**
 * Trims, collapses newlines out of a title, caps the length, and turns "nothing
 * left" into `null` so the caller can `FieldValue.delete()` rather than store an
 * empty string.
 *
 * Shared by the dialog (so the counter and the save agree) and by the API route,
 * because the dialog is not the authority on what gets stored.
 */
export function normaliseSnipTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim().slice(0, SNIP_TITLE_MAX);
  return clean.length > 0 ? clean : null;
}

/** Same, but newlines survive — a description is allowed to be a paragraph. */
export function normaliseSnipDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\r\n/g, '\n').trim().slice(0, SNIP_DESCRIPTION_MAX);
  return clean.length > 0 ? clean : null;
}

// ─── Microphone ──────────────────────────────────────────────────────

/**
 * What the OS says about our access to the microphone.
 *
 * These are `systemPreferences.getMediaAccessStatus('microphone')`'s own five
 * values, carried through unchanged rather than collapsed into a boolean —
 * because **each one needs different words and a different button**, and that
 * is the whole of what makes the prompting flow graceful rather than a dead
 * toggle:
 *
 * | Status | What it means | What we offer |
 * |---|---|---|
 * | `granted` | usable now | nothing; just record |
 * | `not-determined` | never asked | **macOS:** ask in-app (the OS prompt). **Windows:** nothing to prompt — try it |
 * | `denied` | the user (or an admin) said no | **Open Settings.** macOS will NOT re-prompt — see `askForMediaAccess` |
 * | `restricted` | policy/parental controls forbid it | say so; there is no button that helps |
 * | `unknown` | the platform cannot answer (Linux, old builds) | treat as "try it and see" |
 *
 * The critical one is `denied`. On macOS `askForMediaAccess` resolves with the
 * existing status **without showing an alert** once access has been refused
 * once, so an app that keeps calling it presents a button that silently does
 * nothing. That is the single most common way this flow is got wrong.
 */
export type SnipMicPermission =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unknown';

export function resolveSnipMicPermission(value: unknown): SnipMicPermission {
  return value === 'granted' || value === 'denied' || value === 'not-determined' ||
    value === 'restricted'
    ? value
    : 'unknown';
}

/** One audio input, as the selection surface's picker lists it. */
export interface SnipMicDevice {
  /** Chromium's per-origin id. `''` is never used here — the default is
   *  represented by the absence of a selection, not by a sentinel device. */
  deviceId: string;
  /** Empty until the permission is granted: Chromium withholds device labels
   *  from a context that has not been allowed the microphone. A picker showing
   *  "Microphone 1 / Microphone 2" is the symptom of enumerating too early. */
  label: string;
}

/**
 * A stored `micDeviceId`, cleaned.
 *
 * Chromium device ids are 64 hex characters, plus the two reserved names
 * `default` and `communications`. Rather than pin that shape — it is a browser
 * implementation detail and has changed before — this bounds the length and
 * refuses anything that is not a plain token, which is enough to keep junk out
 * of Firestore and out of a `getUserMedia` constraint.
 */
export function normaliseSnipMicDeviceId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value.trim();
  if (clean.length === 0 || clean.length > 256) return '';
  return /^[A-Za-z0-9+/=_-]+$/.test(clean) ? clean : '';
}

/**
 * The device to actually open, given what was stored and what exists now.
 *
 * **A stored id is a preference, never a promise.** The id is per-origin and
 * per-machine, so the same user on a second laptop — or on the same laptop
 * after unplugging a headset — holds an id that matches nothing. Returning
 * `''` there means `getUserMedia` takes the system default, which is the
 * behaviour a person expects from every other app they own: their microphone
 * still works, it is simply the default one again.
 */
export function resolveSnipMicDevice(
  storedId: string,
  devices: ReadonlyArray<SnipMicDevice>,
): string {
  const wanted = normaliseSnipMicDeviceId(storedId);
  if (!wanted) return '';
  return devices.some(device => device.deviceId === wanted) ? wanted : '';
}

/**
 * Whether this platform has a microphone permission worth checking.
 *
 * `getMediaAccessStatus` is documented for macOS and Windows only, so anywhere
 * else the answer is `unknown` and the right move is to try rather than to
 * gate. Note this is the **opposite shape** to screen capture, where macOS has
 * a permission and Windows has none: the microphone is a real, grantable
 * permission on both, which is why the "Open Settings" button here is NOT
 * macOS-only the way the screen-recording one is.
 */
export const SNIP_MIC_PLATFORMS = ['darwin', 'win32'] as const;

// ─── Playback ────────────────────────────────────────────────────────

/**
 * The speeds the public player offers.
 *
 * A short list rather than a slider: these are screen recordings, and the two
 * things a recipient actually wants are "skim this faster" and "what did that
 * click do" — 0.5 and 2 cover both ends and the rest are the steps in between.
 */
export const SNIP_PLAYBACK_RATES: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * WebM for a recording, and the container is **fixed here** because the signed
 * upload slot pins it into the signature — Storage rejects a PUT whose
 * `Content-Type` disagrees with what was signed. The recorder picks its codecs
 * inside this container (VP9 first, VP8 as the fallback); it must never pick a
 * different container without this constant and the slot moving with it.
 */
export const SNIP_VIDEO_CONTENT_TYPE = 'video/webm';

/** A full-resolution capture of a 6K display lands well under this; a request
 *  claiming more is not a screenshot. */
export const MAX_SNIP_BYTES = 25 * 1024 * 1024;

/**
 * The ceiling on one recording.
 *
 * Ten minutes at the recorder's own bitrate ceiling (5 Mbps video + 128 kbps
 * audio) is ~385 MB, so this is the number the duration cap is derived from
 * rather than an independent guess — raise one and the other has to move.
 */
export const MAX_SNIP_VIDEO_BYTES = 400 * 1024 * 1024;

/**
 * The hard stop on a recording, enforced in the recorder window itself.
 *
 * A cap is not optional here: the surfaces come down the moment recording
 * starts, so a user who forgets the control bar is on screen would otherwise
 * fill their disk and their quota with a recording nobody asked to keep. At ten
 * minutes the recorder stops itself and uploads what it has — stopping and
 * keeping is always better than stopping and discarding.
 */
export const MAX_SNIP_RECORDING_MS = 10 * 60 * 1000;

/** How long before the cap the control bar starts warning. */
export const SNIP_RECORDING_WARN_MS = 60 * 1000;

/** `93_000` → `1:33`, `3_723_000` → `1:02:03`. Used by the control bar, the
 *  library card and the public page, so it lives with the other shared values. */
export function formatSnipDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** `1536` → `1.5 MB`. Whole-number KB, one decimal past it.
 *
 *  Shared rather than per-component: the library card and the pending-upload
 *  panel sit on the same screen and print the same field, so two copies of the
 *  rounding rule is two places for them to start disagreeing about what
 *  `1048000` is. */
export function formatSnipBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

/**
 * `Deletes in 2 months`, `Deletes tomorrow`, `Expired`.
 *
 * **A duration rather than a date, because the date was answering a question
 * nobody asked.** "Deletes 2027-03-20" makes the reader do the arithmetic,
 * and the thing they actually want to know before handing a link to someone
 * is *how long it will keep working*.
 *
 * It also sidesteps a problem the date had. An expiry is the moment the sweep
 * passes it, which is a server-side fact — so rendering it as a calendar day
 * meant picking a timezone to be wrong in, and the old code sliced the ISO
 * string specifically to avoid claiming it was the viewer's local date. A
 * duration is true in every zone at once.
 *
 * The unit is the largest that still says something useful, and it steps up
 * rather than reporting "in 12 months".
 *
 * **`numeric: 'auto'` for days and below, `'always'` above.** Auto is what
 * turns "in 1 day" into "tomorrow", which is how people talk. But at month
 * and year scale it produces "next month" and "next year", and those are
 * vague exactly where precision matters: "deletes next year" read on 20
 * December could mean eleven days. A retention warning has to state a
 * duration, so those two say "in 1 month" and "in 1 year".
 */
export function snipExpiryLabel(iso: string, nowMs: number = Date.now()): string {
  const expiry = new Date(iso).getTime();
  if (!Number.isFinite(expiry)) return '';

  const diff = expiry - nowMs;
  // The library lists every `ready` row, and expiry is enforced on READ rather
  // than by the listing query — so a row past its date but not yet swept does
  // appear here. "Deletes soon" would be a lie: the link is already dead.
  if (diff <= 0) return 'Expired';

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  // 30.44 — the mean month. Whole-month arithmetic would drift against the
  // calendar months `snipExpiryMs` actually adds.
  const MONTH = 30.44 * DAY;

  const relative = (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    numeric: 'auto' | 'always' = 'auto',
  ) => {
    try {
      return new Intl.RelativeTimeFormat('en', { numeric }).format(value, unit);
    } catch {
      // A locked-down engine must not take the card down with it.
      return `in ${value} ${unit}${value === 1 ? '' : 's'}`;
    }
  };

  if (diff < HOUR) return `Deletes ${relative(Math.max(1, Math.round(diff / MINUTE)), 'minute')}`;
  if (diff < DAY) return `Deletes ${relative(Math.round(diff / HOUR), 'hour')}`;
  if (diff < 30 * DAY) return `Deletes ${relative(Math.round(diff / DAY), 'day')}`;

  const months = Math.round(diff / MONTH);
  // `always` from here up — see the note above on "next month".
  // Steps up rather than saying "in 12 months", which nobody says out loud.
  if (months < 12) return `Deletes ${relative(Math.max(1, months), 'month', 'always')}`;
  return `Deletes ${relative(Math.round(diff / (365 * DAY)), 'year', 'always')}`;
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
  /**
   * Whether Video mode's System audio toggle was last left on.
   *
   * **Defaults OFF, which is the one place in this map that "absent" does not
   * mean "on".** Every other setting here is a convenience the user would want
   * by default; this one records the desktop's own output. Opt-in, and sticky
   * afterwards so the choice survives the surface closing.
   *
   * The microphone is a separate field (`micEnabled` below), not a mode of
   * this one. They are independent sources on opposite platforms — loopback is
   * Windows-only, the microphone works on both — and a recording may carry
   * either, both or neither.
   */
  systemAudioEnabled: boolean;
  /**
   * Whether a finished upload puts the share link on the clipboard.
   *
   * **Default ON — it is the behaviour the tool shipped with**, and for most
   * users the clipboard *is* the deliverable: the snip is taken in order to be
   * pasted somewhere a second later. Turning it off is for the user who keeps
   * something else on their clipboard while they work and does not want a
   * capture quietly replacing it; the upload still happens and the link is
   * still one click away on the card.
   *
   * `!== false` like the rest of the map — absent reads as on.
   *
   * Note it only governs the *interactive* path. The background drain never
   * touches the clipboard regardless (see `SnipController.announce`), because
   * an upload the user did not ask for must not take it either way.
   */
  autoCopyEnabled: boolean;
  /**
   * Whether Video mode's **Microphone** toggle was last left on.
   *
   * **Opt-in (`=== true`), like `systemAudioEnabled` and for a stronger
   * reason.** System audio records the machine's own output; this records the
   * room the person is sitting in. A default-on microphone is the one setting
   * in this product that could capture something the user did not intend to
   * capture, so absent means off and it stays off until they say otherwise.
   */
  micEnabled: boolean;
  /**
   * Which input device, or `''` for the system default.
   *
   * A Chromium `deviceId`, which is **per-origin and not stable across
   * machines** — it is a hash keyed to the browsing context. Storing it on the
   * user doc rather than on the device is a deliberate trade: the common case
   * is one person on one laptop, where it survives restarts and is exactly
   * what they want; on a second machine it simply will not match any device
   * and `resolveSnipMicDevice` falls back to the default rather than failing.
   * Never treat a stored id as proof a device exists.
   */
  micDeviceId: string;
}

export const DEFAULT_SNIP_SETTINGS: SnipSettings = {
  trayIconEnabled: true,
  shortcutEnabled: true,
  shortcut: DEFAULT_SNIP_SHORTCUT,
  retention: DEFAULT_SNIP_RETENTION,
  systemAudioEnabled: false,
  autoCopyEnabled: true,
  micEnabled: false,
  micDeviceId: '',
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
    // `=== true`, not `!== false` — the one opt-in field. See `SnipSettings`.
    systemAudioEnabled: raw?.systemAudioEnabled === true,
    autoCopyEnabled: raw?.autoCopyEnabled !== false,
    // `=== true` — the second opt-in field, and the stricter of the two. See
    // `SnipSettings.micEnabled`.
    micEnabled: raw?.micEnabled === true,
    micDeviceId: normaliseSnipMicDeviceId(raw?.micDeviceId),
  };
}

// ─── Links ───────────────────────────────────────────────────────────

/** The public route a snip is served from. Allowlisted in `src/middleware.ts`. */
export const SNIP_PUBLIC_PREFIX = '/s';
