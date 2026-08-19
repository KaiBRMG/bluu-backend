import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import {
  addPromptVersion,
  getPromptVersions,
  MAX_TEXT_LENGTH,
} from '@/lib/services/promptLibraryService';
import { MAX_EDIT_NOTE_LENGTH } from '@/types/promptLibrary';
import { PAGE_ID } from '../../route';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/prompt-library/[id]/versions
 * Full history, newest first. Only called when a detail card opens.
 */
export const GET = withAuth(async (
  _req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    const denied = await checkPageAccess(token.uid, PAGE_ID);
    if (denied) return denied;

    const { id } = await params;
    const versions = await getPromptVersions(id);
    if (!versions) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    return NextResponse.json({ versions });
  } catch (err) {
    return handleApiError(err, 'prompt-library versions GET');
  }
});

/**
 * POST /api/prompt-library/[id]/versions
 *
 * Saves edited text as a new version at the head. `basedOn` is the version the
 * editor was actually viewing — reaching back to revise v2 produces a new head
 * whose lineage reads "Edited from v2", and the diff is measured against v2.
 */
export const POST = withAuth(async (
  req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    const denied = await checkPageAccess(token.uid, PAGE_ID);
    if (denied) return denied;

    const { id } = await params;
    const body = await req.json();

    if (typeof body?.text !== 'string' || !body.text.trim()) {
      return NextResponse.json({ error: 'Prompt text cannot be empty' }, { status: 400 });
    }
    if (body.text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Prompt text exceeds the ${MAX_TEXT_LENGTH.toLocaleString()} character limit` },
        { status: 400 }
      );
    }
    if (body?.textHtml !== undefined && body.textHtml !== null && typeof body.textHtml !== 'string') {
      return NextResponse.json({ error: 'Malformed prompt body' }, { status: 400 });
    }
    if (typeof body?.editNote === 'string' && body.editNote.length > MAX_EDIT_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `Edit notes are limited to ${MAX_EDIT_NOTE_LENGTH.toLocaleString()} characters` },
        { status: 400 }
      );
    }
    if (!Number.isInteger(body?.basedOn) || body.basedOn < 1) {
      return NextResponse.json({ error: 'A source version is required' }, { status: 400 });
    }

    const result = await addPromptVersion(
      id,
      body.text,
      body.textHtml,
      body.editNote,
      body.basedOn,
      token.uid
    );
    if (result === null) {
      return NextResponse.json({ error: 'Prompt or source version not found' }, { status: 404 });
    }
    if (result === 'unchanged') {
      return NextResponse.json({ error: 'Nothing changed since that version' }, { status: 409 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'prompt-library versions POST');
  }
});
