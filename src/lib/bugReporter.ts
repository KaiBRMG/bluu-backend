import { getAppInfo } from '@/lib/appVersion';

// Throttle: max 1 report per 2 seconds to prevent write storms on looping errors
let lastReportedAt = 0;
const THROTTLE_MS = 2000;

interface BugPayload {
  message: string;
  stack?: string;
  context?: string;
  uid?: string;
  displayName?: string;
}

export function reportBug(payload: BugPayload): void {
  const now = Date.now();
  if (now - lastReportedAt < THROTTLE_MS) return;
  lastReportedAt = now;

  // Fire-and-forget — do not await, do not throw
  void (async () => {
    const { appVersion, platform } = await getAppInfo();
    const body = {
      ...payload,
      url: typeof window !== 'undefined' ? window.location.href : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      appVersion,
      platform,
    };

    fetch('/api/bugs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {
      // Silently swallow — reporting must never cause additional errors
    });
  })();
}
