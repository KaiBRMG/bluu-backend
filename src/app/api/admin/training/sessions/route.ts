import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { createSession, listSessions } from '@/lib/services/trainingService';

/**
 * Training sessions — list and create (page permission `training`, `no-store`;
 * both from `withTrainingAdmin`). The list carries the server clock so the page
 * judges Upcoming / Running / Closed against it and no render reads the time.
 */
export const GET = withTrainingAdmin(async () => {
  return NextResponse.json({ nowMs: Date.now(), sessions: await listSessions() });
});

export const POST = withTrainingAdmin(async (request, { token }) => {
  const read = await readJsonBody(request, 64 * 1024);
  if (!read.ok) return read.response;
  const b = (read.body ?? {}) as Record<string, unknown>;

  const opensAtMs: Record<string, number> = {};
  if (b.opensAtMs && typeof b.opensAtMs === 'object') {
    for (const [k, v] of Object.entries(b.opensAtMs as Record<string, unknown>)) opensAtMs[k] = Number(v);
  }
  const created = await createSession({
    label: typeof b.label === 'string' ? b.label : '',
    moduleId: typeof b.moduleId === 'string' ? b.moduleId : '',
    emails: typeof b.emails === 'string' ? b.emails : '',
    opensAtMs,
    closesAtMs: Number(b.closesAtMs),
    createdBy: token.uid,
  });
  return NextResponse.json(created, { status: 201 });
});
