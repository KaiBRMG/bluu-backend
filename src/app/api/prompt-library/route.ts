import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { createPrompt, getPromptLibrary, MAX_TEXT_LENGTH } from '@/lib/services/promptLibraryService';
import { isValidModelId, MAX_MODELS_PER_PROMPT } from '@/types/promptLibrary';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const PAGE_ID = 'apps-prompt-library';

/**
 * GET /api/prompt-library
 *
 * The whole library in one response: head docs (each carrying its current text)
 * plus the managed taxonomy. Search, the LLM pages and the detail cards all run
 * off this single payload — the versions subcollection is a separate, lazy call.
 */
export const GET = withAuth(async (_req: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, PAGE_ID);
    if (denied) return denied;

    const { prompts, taxonomy } = await getPromptLibrary();
    return NextResponse.json({ prompts, taxonomy });
  } catch (err) {
    return handleApiError(err, 'prompt-library GET');
  }
});

/**
 * POST /api/prompt-library
 * Creates a prompt at version 1. Anyone with the page may create.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, PAGE_ID);
    if (denied) return denied;

    const body = await req.json();

    if (typeof body?.title !== 'string' || !body.title.trim()) {
      return NextResponse.json({ error: 'A title is required' }, { status: 400 });
    }
    if (typeof body?.text !== 'string' || !body.text.trim()) {
      return NextResponse.json({ error: 'Prompt text is required' }, { status: 400 });
    }
    if (body.text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Prompt text exceeds the ${MAX_TEXT_LENGTH.toLocaleString()} character limit` },
        { status: 400 }
      );
    }
    // The rich body is optional — a prompt written without a single mark stays
    // plain in Firestore — but it must be markup or nothing when it is sent.
    if (body?.textHtml !== undefined && body.textHtml !== null && typeof body.textHtml !== 'string') {
      return NextResponse.json({ error: 'Malformed prompt body' }, { status: 400 });
    }
    // A prompt may target several models, but must target at least one.
    if (
      !Array.isArray(body?.llmTypes) ||
      body.llmTypes.length === 0 ||
      body.llmTypes.length > MAX_MODELS_PER_PROMPT ||
      !body.llmTypes.every(isValidModelId)
    ) {
      return NextResponse.json({ error: 'Choose at least one model' }, { status: 400 });
    }
    if (typeof body?.category !== 'string' || !body.category.trim()) {
      return NextResponse.json({ error: 'A category is required' }, { status: 400 });
    }

    const prompt = await createPrompt(body, token.uid);
    return NextResponse.json({ prompt }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'prompt-library POST');
  }
});
