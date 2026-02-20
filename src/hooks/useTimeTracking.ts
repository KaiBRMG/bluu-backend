'use client';

import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';

/**
 * Thin wrapper around TimeTrackingContext.
 * The actual logic lives in TimeTrackingProvider (mounted at the app root),
 * so heartbeat, idle detection, and timer state persist across page navigations.
 */
export function useTimeTracking() {
  return useTimeTrackingContext();
}
