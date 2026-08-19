import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { mergeTaxonomy, removeTaxonomyLabel } from '@/lib/services/promptLibraryService';
import { isValidModelId, toModelId } from '@/types/promptLibrary';
import { PAGE_ID } from '../route';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/prompt-library/taxonomy
 *
 * Coins categories, tags and/or models. Labels live here independently of any
 * prompt, so a category can be created up front and stay selectable while
 * empty — and a model can be added before any prompt targets it.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, PAGE_ID);
    if (denied) return denied;

    const body = await req.json();
    const categories: string[] = Array.isArray(body?.categories) ? body.categories : [];
    const tags: string[] = Array.isArray(body?.tags) ? body.tags : [];
    const rawModels: unknown[] = Array.isArray(body?.models) ? body.models : [];

    const models = rawModels
      .map(m => {
        const name = typeof (m as { name?: unknown })?.name === 'string' ? (m as { name: string }).name.trim() : '';
        const id = isValidModelId((m as { id?: unknown })?.id)
          ? ((m as { id: string }).id)
          : toModelId(name);
        return { id, name: name || id };
      })
      .filter(m => isValidModelId(m.id));

    if (categories.length === 0 && tags.length === 0 && models.length === 0) {
      return NextResponse.json({ error: 'Nothing to add' }, { status: 400 });
    }
    if (rawModels.length > 0 && models.length === 0) {
      return NextResponse.json(
        { error: 'A model name must contain letters or numbers' },
        { status: 400 }
      );
    }

    const taxonomy = await mergeTaxonomy(categories, tags, models);
    return NextResponse.json({ taxonomy });
  } catch (err) {
    return handleApiError(err, 'prompt-library taxonomy POST');
  }
});

/**
 * DELETE /api/prompt-library/taxonomy?kind=category&label=…
 *
 * Retires a label from the offered lists. Prompts already carrying it keep it —
 * this governs what can be picked, never what has been recorded.
 */
export const DELETE = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, PAGE_ID);
    if (denied) return denied;

    const kind = req.nextUrl.searchParams.get('kind');
    const label = req.nextUrl.searchParams.get('label');

    if (kind !== 'category' && kind !== 'tag' && kind !== 'model') {
      return NextResponse.json({ error: 'Unknown label kind' }, { status: 400 });
    }
    if (!label?.trim()) {
      return NextResponse.json({ error: 'A label is required' }, { status: 400 });
    }

    const taxonomy = await removeTaxonomyLabel(kind, label);
    return NextResponse.json({ taxonomy });
  } catch (err) {
    return handleApiError(err, 'prompt-library taxonomy DELETE');
  }
});
