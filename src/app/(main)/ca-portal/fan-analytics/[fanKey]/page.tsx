import { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import { FanReportSkeleton, FanReportView } from './FanReportView';

/**
 * One fan's report — `/ca-portal/fan-analytics/[fanKey]`, inheriting Fan
 * Analytics' permission by path; the API applies the agent/admin scope. The
 * key is an OnlyFans id, or `h_<handle>` for a fan known only from a custom.
 *
 * The key is read here, on the server, and passed down — under Cache
 * Components `useParams()` in the prerendered shell returns the placeholder,
 * not the id (see `chatter-analytics/[uid]/page.tsx`).
 */
export default function FanReportPage({ params }: { params: Promise<{ fanKey: string }> }) {
  return (
    <AppLayout>
      <Suspense fallback={<FanReportSkeleton />}>
        <ResolvedReport params={params} />
      </Suspense>
    </AppLayout>
  );
}

async function ResolvedReport({ params }: { params: Promise<{ fanKey: string }> }) {
  const { fanKey } = await params;
  let decoded = fanKey;
  try {
    decoded = decodeURIComponent(fanKey);
  } catch {
    // Not percent-encoded — use as is.
  }
  return <FanReportView fanKey={decoded} />;
}
