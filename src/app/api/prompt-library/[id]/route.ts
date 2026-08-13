import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { deletePrompt, updatePromptMeta } from '@/lib/services/promptLibraryService';
import { isLlmType, type PromptMetaInput } from '@/types/promptLibrary';
import { PAGE_ID } from '../route';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * PATCH /api/prompt-library/[id]
 * Title / category / tags / LLM / archive state. Does not cut a new version —
 * version history tracks the prompt TEXT, which moves through the versions route.
 */
export const PATCH = withAuth(async (
  req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    const denied = await checkPageAccess(token.uid, PAGE_ID);
    if (denied) return denied;

    const { id } = await params;
    const body = await req.json();

    if (body?.llmType !== undefined && !isLlmType(body.llmType)) {
      return NextResponse.json({ error: 'Unknown LLM' }, { status: 400 });
    }
    if (body?.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    if (body?.category !== undefined && (typeof body.category !== 'string' || !body.category.trim())) {
      return NextResponse.json({ error: 'Category cannot be empty' }, { status: 400 });
    }

    const input: PromptMetaInput = {
      llmType: body?.llmType,
      category: body?.category,
      title: body?.title,
      tags: Array.isArray(body?.tags) ? body.tags : undefined,
      isArchived: typeof body?.isArchived === 'boolean' ? body.isArchived : undefined,
    };

    const prompt = await updatePromptMeta(id, input, token.uid);
    if (!prompt) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    return NextResponse.json({ prompt });
  } catch (err) {
    return handleApiError(err, 'prompt-library PATCH');
  }
});

/**
 * DELETE /api/prompt-library/[id]
 *
 * Hard delete, including the whole version history. Requires the ADMIN CLAIM,
 * not the page permission: archiving is the reversible action anyone with the
 * page can take, and destroying an audit trail is a different kind of act.
 */
export const DELETE = withAuth(async (
  _req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    if (token.admin !== true) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    const { id } = await params;
    const ok = await deletePrompt(id);
    if (!ok) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'prompt-library DELETE');
  }
});
