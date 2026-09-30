'use client';

import { createContext, useContext } from 'react';
import type { CategoryDef } from '@/lib/growth/category';
import type { GrowthPlatform } from '@/lib/growth/platform';

/**
 * The category registry, for every chip, dot and picker under the Growth
 * Tracking page — provided by `GrowthCategoriesProvider`.
 *
 * A context rather than a prop because the registry is needed six levels deep
 * in places that otherwise know nothing about it (a card's category dot, the
 * panel's picker, the add dialog), and it changes only when someone creates a
 * category.
 *
 * **No default.** Everything that reads it sits under the page's provider; a
 * component rendered outside it would otherwise colour every created category
 * grey without a word, so it throws instead.
 */
export interface GrowthCategoriesValue {
  categories: readonly CategoryDef[];
  /**
   * Open the one "New category" dialog, scoped to `platform`; `onCreated` runs
   * with the new category once it exists (a picker files its account under it).
   */
  requestCreate: (platform: GrowthPlatform, onCreated: (category: CategoryDef) => void) => void;
}

export const GrowthCategoriesContext = createContext<GrowthCategoriesValue | null>(null);

export function useGrowthCategories(): GrowthCategoriesValue {
  const value = useContext(GrowthCategoriesContext);
  if (!value) throw new Error('useGrowthCategories must be used inside GrowthCategoriesProvider');
  return value;
}
