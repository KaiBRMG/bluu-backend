import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { getSessionDetail, updateSession } from '@/lib/services/trainingService';

/**
 * One training session — the roster with each person's state per part, and the
 * schedule edits (page permission `training`, `no-store`: states flip on the
 * server clock and the source previews are signed URLs). `?view=progress` is
 * the live poll: the roster without the source images.
 */
export const GET = withTrainingAdmin<{ sessionId: string }>(async (request, { params }) => {
  const progressOnly = new URL(request.url).searchParams.get('view') === 'progress';
  return NextResponse.json(
    progressOnly ? await getSessionDetail(params.sessionId, { progressOnly }) : await getSessionDetail(params.sessionId),
  );
});

export const PATCH = withTrainingAdmin<{ sessionId: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 8 * 1024);
  if (!read.ok) return read.response;
  const b = (read.body ?? {}) as Record<string, unknown>;
  const opensAtMs =
    b.opensAtMs && typeof b.opensAtMs === 'object'
      ? Object.fromEntries(Object.entries(b.opensAtMs as Record<string, unknown>).map(([k, v]) => [k, Number(v)]))
      : undefined;
  await updateSession(params.sessionId, {
    label: typeof b.label === 'string' ? b.label : undefined,
    closesAtMs: b.closesAtMs !== undefined ? Number(b.closesAtMs) : undefined,
    opensAtMs,
  });
  return NextResponse.json({ ok: true });
});
