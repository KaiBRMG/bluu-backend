'use client';

import { useCallback, useMemo, useState } from 'react';
import type { CategoryDef } from '@/lib/growth/category';
import type { GrowthPlatform } from '@/lib/growth/platform';
import type { CreateCategoryPayload } from '@/hooks/useGrowthTracking';
import { GrowthCategoriesContext } from './categoryContext';
import { CreateCategoryDialog } from './CreateCategoryDialog';

/**
 * Provides the category registry — and owns the **one** create dialog.
 *
 * Every category picker ends in "New category…", and the Manage table renders a
 * picker per account. A dialog per picker would be a hundred Radix roots and
 * their state for a dialog that can only ever be open once; instead a picker
 * asks for it through `requestCreate`, and the answer comes back through the
 * callback it passed.
 */
export function GrowthCategoriesProvider({
  categories,
  createCategory,
  children,
}: {
  categories: readonly CategoryDef[];
  createCategory: (payload: CreateCategoryPayload) => Promise<CategoryDef>;
  children: React.ReactNode;
}) {
  const [request, setRequest] = useState<{
    platform: GrowthPlatform;
    onCreated: (category: CategoryDef) => void;
  } | null>(null);

  const requestCreate = useCallback(
    (platform: GrowthPlatform, onCreated: (category: CategoryDef) => void) => {
      setRequest({ platform, onCreated });
    },
    [],
  );

  const value = useMemo(() => ({ categories, requestCreate }), [categories, requestCreate]);

  return (
    <GrowthCategoriesContext.Provider value={value}>
      {children}
      <CreateCategoryDialog
        open={request !== null}
        onOpenChange={(open) => { if (!open) setRequest(null); }}
        platform={request?.platform ?? 'twitter'}
        categories={categories}
        createCategory={createCategory}
        onCreated={(category) => request?.onCreated(category)}
      />
    </GrowthCategoriesContext.Provider>
  );
}
