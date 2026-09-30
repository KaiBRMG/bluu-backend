/**
 * Growth Tracking — the account category.
 *
 * A tracked account belongs to exactly one operational grouping: the roster is
 * maintained as a handful of named lists (the TWXNK network, the bonus pool, the
 * creators' own accounts, the SFW repost farm, the general Facebook pages), and
 * the question "how is the repost farm doing against the creators" is the one
 * this page could not answer before.
 *
 * ── Five built in, the rest made by the people who run the roster ───────────
 * The five below ship in code. Anyone holding the page can add more from Manage
 * accounts (the "New category…" item at the bottom of every category picker);
 * those live in `growth-categories/{id}` and are merged in by
 * `listCategoryDefs()` on the server. Every consumer works from the merged list
 * — a {@link CategoryDef} array — never from the built-ins alone, so a new
 * grouping gets a filter chip, a colour and a picker entry without a deploy.
 *
 * ── The vocabulary is scoped to the platform ────────────────────────────────
 * The groupings are not the same on both platforms and never were. TWXNK, BONUS
 * and SFW REPOST describe how the **X** roster is run; a Facebook page is either
 * a creator's own page or a general one. So every definition carries the
 * platforms it may be assigned on, and every picker, every validator and the
 * bulk importer asks {@link categoriesFor} — or they offer an X grouping for a
 * Facebook page and store something the page's own filter row can never mean. A
 * created category states its platforms when it is made.
 *
 * **CREATOR is deliberately shared by both platforms.** A creator's X account and
 * that same creator's Facebook page are the same grouping seen twice, so
 * filtering by CREATOR is meant to return both. Splitting it into `FB CREATOR`
 * would put one grouping behind two chips and make "how are the creators doing"
 * a question you have to ask twice.
 *
 * ── Why these carry a hue, when the platform chip does not ───────────────────
 * DESIGN.md forbids hashing an *open-ended* label onto N colours, and the
 * platform mark stays greyscale for exactly that reason. A category is the other
 * case the same rule names: a **vocabulary with a meaning per value**, whose
 * colour was *chosen with the grouping* rather than derived from its spelling.
 * That is still true of a created category — the person creating it picks its
 * colour from {@link CATEGORY_TONES}, a fixed, contrast-measured palette — so the
 * hue stays learnable. Nothing here ever hashes a name to a colour.
 *
 * They are declared here rather than pulled from `campaignTracking.ts` for the
 * same reason `stateColors.ts` keeps its own: these hues mean *this grouping*,
 * not "success" or "warning". Same triad shape as every other tinted chip in the
 * app — `-400` foreground, `/10` wash, `/30` border.
 *
 * NOT part of an account's identity. The Firestore document id is built from
 * platform + handle only (see `platform.ts`), so a category can be corrected at
 * any time without orphaning a single reading.
 */

import { GROWTH_PLATFORMS, PLATFORM_LABEL, type GrowthPlatform } from './platform';

/** A category's name — upper-case, as it is stored on an account and shown on a chip. */
export type GrowthCategory = string;

interface CategoryTone {
  /** Chip in its resting state — the tinted triad. */
  chip: string;
  /** Chip while it is the selected filter: the same hue, filled. */
  active: string;
  /**
   * The bare dot, for surfaces too tight for a chip — the account card's
   * category line and the signal card's leading mark. It is the same `-400`
   * foreground step as `chip`, as a fill: a non-text mark, so it answers to the
   * 3:1 floor rather than to AA, and every one of these clears it on the card
   * ground. The label always sits beside it, so the dot never carries the
   * meaning alone.
   */
  dot: string;
  /** How the colour is named in the create dialog. */
  label: string;
}

/**
 * The palette a category may be given. Closed: a category stores the *key*, and
 * a created one can only pick from here.
 *
 * The filled step carries white text, so it is a deeper step of each hue rather
 * than the `-400` used for the label: white on a `-400` fill sits under the AA
 * floor at this size, the same arithmetic that makes the page's other filter
 * chips fill at `#2563eb` rather than `#3b82f6` (DESIGN.md §2).
 *
 * **The depth is per hue, measured, not assumed.** `-600` is not one step that
 * clears the floor everywhere — it depends entirely on the hue's luminance, and
 * two of these were shipped failing on the assumption that it did:
 *
 * | Fill | White on it | Verdict |
 * |---|---|---|
 * | `purple-600` `#9333ea` | 5.39:1 | passes |
 * | `blue-600`   `#2563eb` | 5.17:1 | passes |
 * | `zinc-600`   `#52525b` | 7.60:1 | passes |
 * | `green-600`  `#16a34a` | **3.30:1** | failed — now `green-700`  `#15803d`, 5.02:1 |
 * | `orange-600` `#ea580c` | **3.54:1** | failed — now `orange-700` `#c2410c`, 5.18:1 |
 * | `pink-700`   `#be185d` | 6.04:1 | passes (`pink-600` is 4.60 — too close to the floor) |
 * | `teal-700`   `#0f766e` | 5.47:1 | passes (`teal-600` is 3.74 — fails) |
 * | `lime-700`   `#4d7c0f` | 4.99:1 | passes |
 * | `indigo-600` `#4f46e5` | 6.29:1 | passes |
 *
 * The chips carry 12px non-bold text, so the floor is 4.5:1 with no large-text
 * exemption. Anything added below is measured against white before it ships.
 * Yellow and red are deliberately absent: they already mean *attention* and
 * *error* on this page (a red chip would read as the Stopped filter).
 */
export const CATEGORY_TONES = {
  purple: {
    label: 'Purple',
    chip: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    active: 'bg-purple-600 text-white border-purple-600',
    dot: 'bg-purple-400',
  },
  orange: {
    label: 'Orange',
    chip: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
    active: 'bg-orange-700 text-white border-orange-700',
    dot: 'bg-orange-400',
  },
  green: {
    label: 'Green',
    chip: 'bg-green-500/10 text-green-400 border-green-500/30',
    active: 'bg-green-700 text-white border-green-700',
    dot: 'bg-green-400',
  },
  blue: {
    label: 'Blue',
    chip: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    active: 'bg-blue-600 text-white border-blue-600',
    dot: 'bg-blue-400',
  },
  pink: {
    label: 'Pink',
    chip: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
    active: 'bg-pink-700 text-white border-pink-700',
    dot: 'bg-pink-400',
  },
  teal: {
    label: 'Teal',
    chip: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
    active: 'bg-teal-700 text-white border-teal-700',
    dot: 'bg-teal-400',
  },
  lime: {
    label: 'Lime',
    chip: 'bg-lime-500/10 text-lime-400 border-lime-500/30',
    active: 'bg-lime-700 text-white border-lime-700',
    dot: 'bg-lime-400',
  },
  indigo: {
    label: 'Indigo',
    chip: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    active: 'bg-indigo-600 text-white border-indigo-600',
    dot: 'bg-indigo-400',
  },
  // The absence of a distinguishing grouping — GENERAL, and what an unknown
  // category falls back to. Always available to a new category too: it is the
  // one step that may be shared without two hues meaning the same thing.
  neutral: {
    label: 'Grey',
    chip: 'bg-white/[0.08] text-zinc-300 border-white/[0.12]',
    active: 'bg-zinc-600 text-white border-zinc-600',
    dot: 'bg-zinc-400',
  },
} as const satisfies Record<string, CategoryTone>;

export type CategoryToneKey = keyof typeof CATEGORY_TONES;
export const CATEGORY_TONE_KEYS = Object.keys(CATEGORY_TONES) as CategoryToneKey[];

/** Whether an untrusted value names a palette entry — own keys only, never `toString`. */
export function isCategoryToneKey(value: unknown): value is CategoryToneKey {
  return typeof value === 'string' && Object.hasOwn(CATEGORY_TONES, value);
}

/** One category: its name, where it may be assigned, and the colour chosen for it. */
export interface CategoryDef {
  name: GrowthCategory;
  platforms: GrowthPlatform[];
  tone: CategoryToneKey;
  /** Shipped in code — cannot be removed, and its name is reserved. */
  builtIn: boolean;
}

/**
 * The five groupings that ship in code, in the order they are rendered. CREATOR
 * appears on both platforms on purpose (see the file header); GENERAL is
 * Facebook's default grouping and has no meaning on X.
 *
 * GENERAL takes the neutral step it inherited from the retired `FACEBOOK` value
 * — "a page that is not a creator's" is the absence of a grouping, not a sixth
 * hue.
 */
export const BUILT_IN_CATEGORIES: readonly CategoryDef[] = [
  { name: 'TWXNK', platforms: ['twitter'], tone: 'purple', builtIn: true },
  { name: 'BONUS', platforms: ['twitter'], tone: 'orange', builtIn: true },
  { name: 'CREATOR', platforms: ['twitter', 'facebook'], tone: 'green', builtIn: true },
  { name: 'SFW REPOST', platforms: ['twitter'], tone: 'blue', builtIn: true },
  { name: 'GENERAL', platforms: ['facebook'], tone: 'neutral', builtIn: true },
];

/** Limits on a created category's name — short enough to fit a chip. */
export const CATEGORY_NAME_MAX = 20;
const CATEGORY_NAME_PATTERN = /^[A-Z0-9][A-Z0-9 &+\-]*$/;

/**
 * Tidy a stored or typed category name: trimmed, inner whitespace collapsed,
 * upper-cased — so `sfw repost`, `SFW  REPOST` and the heading in the import
 * file all resolve to one value. Returns `null` for anything that could not be
 * a name at all. Says nothing about whether the category *exists*.
 */
export function cleanCategoryName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/\s+/g, ' ').toUpperCase();
  return cleaned ? cleaned : null;
}

/**
 * Why a name cannot be used for a new category, or `null` when it can. Shared by
 * the create dialog (as-you-type) and the route (the real check).
 */
export function categoryNameProblem(
  name: string,
  defs: readonly CategoryDef[],
): string | null {
  if (name.length < 2) return 'A category name needs at least 2 characters.';
  if (name.length > CATEGORY_NAME_MAX) return `Keep it to ${CATEGORY_NAME_MAX} characters or fewer.`;
  if (!CATEGORY_NAME_PATTERN.test(name)) {
    return 'Use letters, numbers, spaces and & + - only.';
  }
  if (defs.some((d) => d.name === name)) return `${name} already exists.`;
  return null;
}

/** The definition for a stored category name, or `null` if nothing defines it. */
export function findCategory(
  defs: readonly CategoryDef[],
  name: string | null | undefined,
): CategoryDef | null {
  if (!name) return null;
  return defs.find((d) => d.name === name) ?? null;
}

/**
 * What may be assigned on this platform — **this is the menu**. Every picker and
 * every server-side validator reads it.
 */
export function categoriesFor(
  defs: readonly CategoryDef[],
  platform: GrowthPlatform,
): CategoryDef[] {
  return defs.filter((d) => d.platforms.includes(platform));
}

/**
 * The read path's normaliser: a stored value becomes a known category name, or
 * `null`.
 *
 * **Platform-blind on purpose.** It is applied on the way out of Firestore,
 * where the job is "is this still a category the app knows"; rejecting a value
 * for being wrong *for its platform* would blank a filed account rather than
 * show the misfiling. A retired value — `FACEBOOK`, before the Facebook pages
 * were split into GENERAL and CREATOR — therefore reads as unfiled, which is a
 * state the manage view can fix. Use {@link normalizeCategoryFor} on every write.
 */
export function normalizeCategory(
  defs: readonly CategoryDef[],
  input: unknown,
): GrowthCategory | null {
  return findCategory(defs, cleanCategoryName(input))?.name ?? null;
}

/**
 * The write path's normaliser: accept a category **only if the platform may hold
 * it**, so a Facebook page can never be filed under TWXNK by a hand-rolled
 * request. A client-side picker that only offers the right options is an
 * affordance, not a validation.
 */
export function normalizeCategoryFor(
  defs: readonly CategoryDef[],
  platform: GrowthPlatform,
  input: unknown,
): GrowthCategory | null {
  const def = findCategory(defs, cleanCategoryName(input));
  return def && def.platforms.includes(platform) ? def.name : null;
}

/** For an error message: "GENERAL or CREATOR" / "TWXNK, BONUS, CREATOR or SFW REPOST". */
export function categoryListFor(defs: readonly CategoryDef[], platform: GrowthPlatform): string {
  const list = categoriesFor(defs, platform).map((d) => d.name);
  if (list.length === 0) return `no category yet — create one for ${PLATFORM_LABEL[platform]} first`;
  return list.length === 1
    ? list[0]
    : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
}

/**
 * A category's colour triad. An unfiled account, or a name nothing defines any
 * more, renders in the neutral step — never in a colour derived from its text.
 */
export function toneFor(
  defs: readonly CategoryDef[],
  name: string | null | undefined,
): CategoryTone {
  const def = findCategory(defs, name);
  return CATEGORY_TONES[def?.tone ?? 'neutral'];
}

/** Whether a platform list is a valid, non-empty set of known platforms. */
export function cleanPlatforms(input: unknown): GrowthPlatform[] | null {
  if (!Array.isArray(input)) return null;
  const set = GROWTH_PLATFORMS.filter((p) => input.includes(p));
  return set.length > 0 ? set : null;
}
