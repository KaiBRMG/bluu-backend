import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { listModules } from '@/lib/services/trainingService';

/** The training modules with their switch, open test and headcount (page permission `training`, `no-store`). */
export const GET = withTrainingAdmin(async () => {
  return NextResponse.json({ modules: await listModules() });
});
