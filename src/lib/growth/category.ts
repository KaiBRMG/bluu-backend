/**
 * Growth Tracking — the account category.
 *
 * A tracked account belongs to exactly one operational grouping: the roster is
 * maintained as a handful of named lists (the TWXNK network, the bonus pool, the
 * creators' own accounts, the SFW repost farm, the general Facebook pages), and
 * the question "how is the repost farm doing against the creators" is the one
 * this page could not answer before.
 *
 * ── The vocabulary is scoped to the platform ────────────────────────────────
 * The groupings are not the same on both platforms and never were. TWXNK, BONUS
 * and SFW REPOST describe how the **X** roster is run; a Facebook page is either
 * a creator's own page or a general one. So {@link CATEGORIES_BY_PLATFORM} is
 * the real vocabulary and {@link GROWTH_CATEGORIES} is only its union — every
 * picker, every validator and the bulk importer must ask the per-platform set,
 * or they offer an X grouping for a Facebook page and store something the page's
 * own filter row can never mean.
 *
 * **CREATOR is deliberately shared by both platforms.** A creator's X account and
 * that same creator's Facebook page are the same grouping seen twice, so
 * filtering by CREATOR is meant to return both. Splitting it into `FB CREATOR`
 * would put one grouping behind two chips and make "how are the creators doing"
 * a question you have to ask twice.
 *
 * This replaced a flat five-value set whose fifth entry was `FACEBOOK` — a
 * "category" that only ever restated the platform mark already on the row, and
 * left every Facebook page in one undifferentiated bucket.
 *
 * ── Why these carry a hue, when the platform chip does not ───────────────────
 * DESIGN.md forbids hashing an *open-ended* label onto N colours, and the
 * platform mark stays greyscale for exactly that reason. A category is the other
 * case the same rule names: a **closed vocabulary with a meaning per value**,
 * which is what earns a hue. The set below is the whole set — a category that is
 * not one of these is not stored — and the colours were specified with the
 * grouping, so they are learnable rather than incidental.
 *
 * They are declared here rather than pulled from `campaignTracking.ts` for the
 * same reason `stateColors.ts` keeps its own five: these hues mean *this
 * grouping*, not "success" or "warning", and reading them out of the status
 * palette would tie a roster label to a status change. Same triad shape as every
 * other tinted chip in the app — `-400` foreground, `/10` wash, `/30` border.
 *
 * NOT part of an account's identity. The Firestore document id is built from
 * platform + handle only (see `platform.ts`), so a category can be corrected at
 * any time without orphaning a single reading.
 */

import { GROWTH_PLATFORMS, type GrowthPlatform } from './platform';

/**
 * Every category any account may hold — the **union**, not a menu.
 *
 * Use it to render a set of chips already present in the data (the filter row
 * counts what the roster actually uses) or to check that a stored value is
 * still in the vocabulary. Never offer it as a picker: see
 * {@link CATEGORIES_BY_PLATFORM}.
 */
export const GROWTH_CATEGORIES = ['TWXNK', 'BONUS', 'CREATOR', 'SFW REPOST', 'GENERAL'] as const;
export type GrowthCategory = (typeof GROWTH_CATEGORIES)[number];

/**
 * What may actually be assigned, per platform. **This is the menu** — every
 * picker and every server-side validator reads it.
 *
 * Ordered as they are rendered. CREATOR appears in both on purpose (see the
 * file header); GENERAL is Facebook's default grouping and has no meaning on X,
 * where an account always belongs to one of the three named programmes.
 */
export const CATEGORIES_BY_PLATFORM: Record<GrowthPlatform, readonly GrowthCategory[]> = {
  twitter: ['TWXNK', 'BONUS', 'CREATOR', 'SFW REPOST'],
  facebook: ['GENERAL', 'CREATOR'],
};

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
}

/**
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
 *
 * The chips carry 12px non-bold text, so the floor is 4.5:1 with no large-text
 * exemption. Anything added below is measured against white before it ships.
 */
export const CATEGORY_TONE: Record<GrowthCategory, CategoryTone> = {
  TWXNK: {
    chip: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    active: 'bg-purple-600 text-white border-purple-600',
    dot: 'bg-purple-400',
  },
  BONUS: {
    chip: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
    active: 'bg-orange-700 text-white border-orange-700',
    dot: 'bg-orange-400',
  },
  CREATOR: {
    chip: 'bg-green-500/10 text-green-400 border-green-500/30',
    active: 'bg-green-700 text-white border-green-700',
    dot: 'bg-green-400',
  },
  'SFW REPOST': {
    chip: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    active: 'bg-blue-600 text-white border-blue-600',
    dot: 'bg-blue-400',
  },
  // GENERAL is the absence of a distinguishing grouping — a Facebook page that
  // is not a creator's own — so it takes the neutral step rather than a sixth
  // invented hue, which is also what an account with no category at all renders
  // as. It inherits this slot from the old `FACEBOOK` value it replaced.
  GENERAL: {
    chip: 'bg-white/[0.08] text-zinc-300 border-white/[0.12]',
    active: 'bg-zinc-600 text-white border-zinc-600',
    dot: 'bg-zinc-400',
  },
};

/**
 * Accept a stored or pasted category, or `null`.
 *
 * Case- and space-insensitive so `sfw repost`, `SFW  REPOST` and the heading in
 * the import file all resolve to one value. Anything outside the set is `null`
 * rather than a new category: the vocabulary being closed is what makes the
 * colours mean something.
 *
 * **Platform-blind on purpose**, and this is the read path's behaviour: it is
 * what `serializeGrowthAccount` applies on the way out of Firestore, where the
 * job is "is this still a category the app knows" and rejecting a value for
 * being wrong *for its platform* would blank a filed account rather than show
 * the misfiling. A retired value — `FACEBOOK`, before the Facebook pages were
 * split into GENERAL and CREATOR — therefore reads as unfiled, which is a state
 * the manage view can fix. Use {@link normalizeCategoryFor} on every **write**.
 */
export function normalizeCategory(input: unknown): GrowthCategory | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/\s+/g, ' ').toUpperCase();
  return (GROWTH_CATEGORIES as readonly string[]).includes(cleaned)
    ? (cleaned as GrowthCategory)
    : null;
}

/** Whether `category` is one this platform is allowed to hold. */
export function isCategoryAllowed(platform: GrowthPlatform, category: GrowthCategory): boolean {
  return CATEGORIES_BY_PLATFORM[platform].includes(category);
}

/**
 * The write path's normaliser: accept a category **only if the platform may hold
 * it**.
 *
 * Every route that stores a category uses this rather than
 * {@link normalizeCategory}, so a Facebook page can never be filed under TWXNK
 * by a hand-rolled request. A client-side picker that only offers the right
 * options is an affordance, not a validation.
 */
export function normalizeCategoryFor(
  platform: GrowthPlatform,
  input: unknown,
): GrowthCategory | null {
  const category = normalizeCategory(input);
  return category !== null && isCategoryAllowed(platform, category) ? category : null;
}

/** For an error message: "General or Creator" / "TWXNK, Bonus, Creator or SFW Repost". */
export function categoryListFor(platform: GrowthPlatform): string {
  const list = CATEGORIES_BY_PLATFORM[platform];
  return list.length === 1
    ? list[0]
    : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
}

/** Every platform a category may be assigned on — the inverse of the map above. */
export function platformsFor(category: GrowthCategory): GrowthPlatform[] {
  return GROWTH_PLATFORMS.filter((p) => isCategoryAllowed(p, category));
}
