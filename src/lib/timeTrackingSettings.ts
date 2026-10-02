/**
 * Time-tracking policy: organization defaults → group overrides → user overrides.
 *
 * Pure and dependency-free so the server (which enforces) and the admin UI
 * (which explains) resolve with the same code — "where does this value come
 * from" can never disagree with what the user's session actually runs.
 *
 * Storage:
 *   org-settings/time-tracking         → TimeTrackingSettings (the defaults)
 *   groups/{id}.timeTrackingOverrides  → TimeTrackingOverrides
 *   users/{uid}.timeTrackingOverrides  → TimeTrackingOverrides
 *   users/{uid}.{enableIdleTimeout, idleTimeoutMinutes, idleInputMode, enableScreenshots}
 *     → the RESOLVED values, denormalised by timeTrackingSettingsService so the
 *       renderer reads them off its existing users/{uid} snapshot for free.
 *
 * See documentation/time-tracking.md §"Time-tracking settings".
 */

export interface TimeTrackingSettings {
  enableIdleTimeout: boolean;
  /** Minutes without counted input (see `idleInputMode`) before a working session goes idle. */
  idleTimeoutMinutes: number;
  /** Which input counts as activity for the idle timeout. */
  idleInputMode: IdleInputMode;
  enableScreenshots: boolean;
}

/**
 * Which input keeps a session out of idle:
 *   any      — keyboard OR mouse (idle only after neither for the timeout)
 *   keyboard — only typing counts; mouse movement is ignored
 *   mouse    — only mouse input counts; typing is ignored
 * Measured per input type by the Electron main process
 * (`timeTracking.getInputIdleTimes`); builds without it fall back to `any`.
 */
export type IdleInputMode = 'any' | 'keyboard' | 'mouse';

export const IDLE_INPUT_MODES: readonly IdleInputMode[] = ['any', 'keyboard', 'mouse'];

export const IDLE_INPUT_MODE_LABELS: Record<IdleInputMode, string> = {
  any: 'Keyboard or mouse',
  keyboard: 'Keyboard only',
  mouse: 'Mouse only',
};

export function isIdleInputMode(v: unknown): v is IdleInputMode {
  return typeof v === 'string' && (IDLE_INPUT_MODES as readonly string[]).includes(v);
}

/** The mode a renderer should apply; absent/malformed → `any` (the pre-setting behaviour). */
export function normalizeIdleInputMode(v: unknown): IdleInputMode {
  return isIdleInputMode(v) ? v : 'any';
}

/** A field that is absent inherits from the level above. */
export type TimeTrackingOverrides = Partial<TimeTrackingSettings>;

export type TimeTrackingSettingKey = keyof TimeTrackingSettings;

export const TIME_TRACKING_SETTING_KEYS: readonly TimeTrackingSettingKey[] = [
  'enableIdleTimeout',
  'idleTimeoutMinutes',
  'idleInputMode',
  'enableScreenshots',
];

export const DEFAULT_TIME_TRACKING_SETTINGS: TimeTrackingSettings = {
  enableIdleTimeout: true,
  idleTimeoutMinutes: 6,
  idleInputMode: 'any',
  enableScreenshots: true,
};

export const MIN_IDLE_TIMEOUT_MINUTES = 1;
export const MAX_IDLE_TIMEOUT_MINUTES = 60;

/**
 * The idle threshold a renderer should apply, from whatever the user doc holds.
 * Clamped so a malformed value can never disable idle detection by stealth
 * (e.g. 0 → instantly idle, 1e9 → never idle).
 */
export function idleThresholdSeconds(minutes: unknown): number {
  const m = isValidIdleMinutes(minutes) ? minutes : DEFAULT_TIME_TRACKING_SETTINGS.idleTimeoutMinutes;
  return m * 60;
}

export function isValidIdleMinutes(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= MIN_IDLE_TIMEOUT_MINUTES &&
    v <= MAX_IDLE_TIMEOUT_MINUTES
  );
}

function isValidValue(key: TimeTrackingSettingKey, v: unknown): boolean {
  if (key === 'idleTimeoutMinutes') return isValidIdleMinutes(v);
  if (key === 'idleInputMode') return isIdleInputMode(v);
  return typeof v === 'boolean';
}

/** Org defaults with any missing/malformed field filled from the built-in defaults. */
export function normalizeOrgSettings(raw: unknown): TimeTrackingSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_TIME_TRACKING_SETTINGS };
  for (const key of TIME_TRACKING_SETTING_KEYS) {
    if (isValidValue(key, src[key])) (out as Record<string, unknown>)[key] = src[key];
  }
  return out;
}

/** Keeps only valid override fields; anything else is dropped (= inherit). */
export function normalizeOverrides(raw: unknown): TimeTrackingOverrides {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: TimeTrackingOverrides = {};
  for (const key of TIME_TRACKING_SETTING_KEYS) {
    if (isValidValue(key, src[key])) (out as Record<string, unknown>)[key] = src[key];
  }
  return out;
}

/**
 * A request body's override patch: each key is a valid value (set) or `null`
 * (clear → inherit). Returns null if any key is unknown or malformed, so a bad
 * request is rejected whole rather than half-applied.
 */
export function parseOverridePatch(
  raw: unknown,
): Partial<Record<TimeTrackingSettingKey, TimeTrackingSettings[TimeTrackingSettingKey] | null>> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(TIME_TRACKING_SETTING_KEYS as readonly string[]).includes(key)) return null;
    if (value !== null && !isValidValue(key as TimeTrackingSettingKey, value)) return null;
    out[key] = value;
  }
  return out as Partial<Record<TimeTrackingSettingKey, TimeTrackingSettings[TimeTrackingSettingKey] | null>>;
}

/**
 * A user's overrides. Users predating this system have no
 * `timeTrackingOverrides` field; for them the old per-user switches ARE the
 * overrides. Only a `false` is carried across — `true` was the old default, so
 * it means "never touched" and inherits. The service writes the field on the
 * first recompute, which latches the migration.
 */
export function userOverridesFromDoc(user: {
  timeTrackingOverrides?: unknown;
  enableIdleTimeout?: unknown;
  enableScreenshots?: unknown;
}): TimeTrackingOverrides {
  if (user.timeTrackingOverrides !== undefined) return normalizeOverrides(user.timeTrackingOverrides);
  const legacy: TimeTrackingOverrides = {};
  if (user.enableIdleTimeout === false) legacy.enableIdleTimeout = false;
  if (user.enableScreenshots === false) legacy.enableScreenshots = false;
  return legacy;
}

export interface GroupOverrideSource {
  id: string;
  name: string;
  /** Higher level wins when a user's groups disagree (admin 2 > OFAM 1 > CA/SMM 0). */
  level: number;
  overrides: TimeTrackingOverrides;
}

export type SettingSource =
  | { kind: 'org' }
  | { kind: 'group'; groupId: string; groupName: string }
  | { kind: 'user' };

export interface ResolvedTimeTrackingSettings {
  values: TimeTrackingSettings;
  sources: Record<TimeTrackingSettingKey, SettingSource>;
}

/**
 * Orders a user's groups by precedence: highest `level` first, then id for a
 * deterministic tie-break. Exported so the UI can show the same order.
 */
export function sortGroupsByPrecedence<T extends { id: string; level: number }>(groups: T[]): T[] {
  return [...groups].sort((a, b) => b.level - a.level || a.id.localeCompare(b.id));
}

/**
 * Resolves each setting independently: the user's own override, else the
 * highest-precedence group that overrides that setting, else the org default.
 * Per-field, so a group can pin the timeout length without also pinning
 * whether screenshots are on.
 */
export function resolveTimeTrackingSettings(
  org: TimeTrackingSettings,
  userGroups: GroupOverrideSource[],
  userOverrides: TimeTrackingOverrides,
): ResolvedTimeTrackingSettings {
  const ordered = sortGroupsByPrecedence(userGroups);
  const values = { ...org };
  const sources = {} as Record<TimeTrackingSettingKey, SettingSource>;

  for (const key of TIME_TRACKING_SETTING_KEYS) {
    if (userOverrides[key] !== undefined) {
      (values as Record<string, unknown>)[key] = userOverrides[key];
      sources[key] = { kind: 'user' };
      continue;
    }
    const group = ordered.find(g => g.overrides[key] !== undefined);
    if (group) {
      (values as Record<string, unknown>)[key] = group.overrides[key];
      sources[key] = { kind: 'group', groupId: group.id, groupName: group.name };
      continue;
    }
    sources[key] = { kind: 'org' };
  }

  return { values, sources };
}
