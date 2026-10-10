import { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import { ReportSkeleton, ReportView } from './ChatterReportView';

/**
 * One chat agent's report — `/ca-portal/chatter-analytics/[uid]`, `ca-admin`
 * only (the API refuses anyone else; the page inherits Chatter Analytics'
 * permission by path). The UI lives in `ChatterReportView.tsx`.
 *
 * **The uid is read here, on the server, and passed down.** This route is
 * partially prerendered (Cache Components), and `useParams()` in a client
 * component inside the prerendered shell returns the dynamic-param placeholder
 * (`%%drp:uid:…%%`) rather than the real id. Awaiting `params` is runtime data,
 * so it happens inside the Suspense boundary, never above it.
 */
export default function ChatterReportPage({ params }: { params: Promise<{ uid: string }> }) {
  return (
    <AppLayout>
      <Suspense fallback={<ReportSkeleton />}>
        <ResolvedReport params={params} />
      </Suspense>
    </AppLayout>
  );
}

async function ResolvedReport({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  let decoded = uid;
  try {
    decoded = decodeURIComponent(uid);
  } catch {
    // Not percent-encoded — use as is.
  }
  return <ReportView uid={decoded} />;
}
