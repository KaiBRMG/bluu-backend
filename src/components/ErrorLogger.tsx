'use client';

import { useEffect } from 'react';
import { reportBug } from '@/lib/bugReporter';
import { useUserData } from '@/hooks/useUserData';

export default function ErrorLogger() {
  const { userData } = useUserData();
  const uid = userData?.uid ?? undefined;

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      reportBug({
        message: event.message,
        stack: event.error?.stack,
        context: 'renderer',
        uid,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportBug({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        context: 'renderer:unhandledRejection',
        uid,
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // Electron: receive forwarded main-process errors
    const electronAPI = (window as Window & { electronAPI?: { bugs?: { onReport: (cb: (p: { context: string; message: string; stack?: string }) => void) => void; removeReportListener: () => void } } }).electronAPI;
    electronAPI?.bugs?.onReport(({ context, message, stack }) => {
      reportBug({ message, stack, context, uid });
    });

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      electronAPI?.bugs?.removeReportListener();
    };
  }, [uid]);

  return null;
}
