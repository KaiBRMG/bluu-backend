/**
 * Growth Tracking — the category registry.
 *
 * The five built-in groupings ship in code (`lib/growth/category.ts`); anything
 * created from Manage accounts lives in `growth-categories/{id}` and is merged
 * in here. Every route that reads or writes an account's category works from
 * {@link listCategoryDefs} — never from the built-ins alone — so a created
 * category validates exactly like a shipped one.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * One small collection read (capped at {@link MAX_CUSTOM_CATEGORIES} documents)
 * per page load, folded into the series route, and one more on a write that
 * actually sets a category. Nothing queries the collection by a field, so every
 * field is index-exempt (rule 9).
 */

import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  BUILT_IN_CATEGORIES,
  categoryNameProblem,
  cleanCategoryName,
  cleanPlatforms,
  isCategoryToneKey,
  type CategoryDef,
} from '@/lib/growth/category';
import type { GrowthPlatform } from '@/lib/growth/platform';

export const GROWTH_CATEGORIES_COLLECTION = 'growth-categories';

/**
 * A ceiling, not a target. Past a couple of dozen a filter row stops being a
 * row, and the palette has nine colours — at that point categories are being
 * used as tags, which is a different feature.
 */
export const MAX_CUSTOM_CATEGORIES = 20;

/**
 * Document id for a category name: lower-case, spaces → hyphens, anything else
 * dropped. Deterministic, so `create()` is the duplicate check — two people
 * creating "VIP" at the same moment produce one document and one clear error,
 * rather than two categories that render as one chip.
 */
function categoryDocId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9&+\-]/g, '');
}

/** Built-ins first, in their shipped order, then created categories oldest first. */
export async function listCategoryDefs(): Promise<CategoryDef[]> {
  const snap = await adminDb.collection(GROWTH_CATEGORIES_COLLECTION)
    .limit(MAX_CUSTOM_CATEGORIES)
    .get();

  const custom = snap.docs
    .map((doc) => {
      const d = doc.data();
      const name = cleanCategoryName(d.name);
      const platforms = cleanPlatforms(d.platforms);
      const tone = isCategoryToneKey(d.tone) ? d.tone : 'neutral';
      if (!name || !platforms) return null;
      return {
        def: { name, platforms, tone, builtIn: false } satisfies CategoryDef,
        createdAt: d.createdAt?.toMillis?.() ?? 0,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    // A stored name that collides with a built-in (written by hand, say) must
    // not shadow it with a second colour.
    .filter((c) => !BUILT_IN_CATEGORIES.some((b) => b.name === c.def.name))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((c) => c.def);

  return [...BUILT_IN_CATEGORIES, ...custom];
}

export class CategoryInputError extends Error {}

/**
 * Create a category. Validates everything the client could have got wrong — the
 * dialog's checks are an affordance (rule 10) — and refuses a duplicate name
 * atomically via `create()` on the deterministic id.
 */
export async function createCategory(
  input: { name?: unknown; platforms?: unknown; tone?: unknown },
  uid: string,
): Promise<{ category: CategoryDef; categories: CategoryDef[] }> {
  const existing = await listCategoryDefs();

  const name = cleanCategoryName(input.name);
  if (!name) throw new CategoryInputError('Give the category a name.');
  const problem = categoryNameProblem(name, existing);
  if (problem) throw new CategoryInputError(problem);

  const platforms: GrowthPlatform[] | null = cleanPlatforms(input.platforms);
  if (!platforms) throw new CategoryInputError('Choose at least one platform the category is for.');

  const tone = input.tone;
  if (!isCategoryToneKey(tone)) throw new CategoryInputError('Choose a colour from the palette.');

  if (existing.filter((d) => !d.builtIn).length >= MAX_CUSTOM_CATEGORIES) {
    throw new CategoryInputError(
      `There are already ${MAX_CUSTOM_CATEGORIES} custom categories — the most the filter row can hold.`,
    );
  }

  try {
    await adminDb.collection(GROWTH_CATEGORIES_COLLECTION).doc(categoryDocId(name)).create({
      name,
      platforms,
      tone,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // ALREADY_EXISTS — someone else made the same name between our read and
    // this write, or two names differ only in characters the id drops.
    if ((error as { code?: number }).code === 6) {
      throw new CategoryInputError(`${name} already exists.`);
    }
    throw error;
  }

  const category: CategoryDef = { name, platforms, tone, builtIn: false };
  return { category, categories: [...existing, category] };
}
