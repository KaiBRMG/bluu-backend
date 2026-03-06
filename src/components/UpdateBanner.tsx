'use client';

import { useEffect, useState } from 'react';

interface UpdateStatus {
  status: 'downloading' | 'error';
  version?: string;
  message?: string;
}

interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  total: number;
  transferred: number;
}

export default function UpdateBanner() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.isElectron) return;

    api.updater.onStatus((data: UpdateStatus) => {
      setUpdateStatus(data);
      setDismissed(false);
    });

    api.updater.onProgress((data: UpdateProgress) => {
      setProgress(data);
    });

    return () => {
      api.updater.removeListeners();
    };
  }, []);

  if (!updateStatus || dismissed) return null;

  const percent = progress ? Math.round(progress.percent) : 0;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1.25rem',
        right: '1.25rem',
        zIndex: 9999,
        width: '22rem',
        backgroundColor: 'var(--card, #0f2233)',
        border: '1px solid var(--border, #1e3a4a)',
        borderRadius: '0.75rem',
        padding: '1rem 1.25rem',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: 'var(--foreground, #e2e8f0)' }}>
            {updateStatus.status === 'error' ? 'Update failed' : 'Downloading update…'}
          </p>
          {updateStatus.version && updateStatus.status === 'downloading' && (
            <p style={{ margin: '0.125rem 0 0', fontSize: '0.75rem', color: 'var(--muted-foreground, #94a3b8)' }}>
              v{updateStatus.version}
            </p>
          )}
          {updateStatus.status === 'error' && updateStatus.message && (
            <p style={{ margin: '0.125rem 0 0', fontSize: '0.75rem', color: '#f87171' }}>
              {updateStatus.message}
            </p>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--muted-foreground, #94a3b8)',
            fontSize: '1rem',
            lineHeight: 1,
            padding: '0 0 0 0.5rem',
          }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>

      {updateStatus.status === 'downloading' && (
        <>
          <div
            style={{
              height: '6px',
              borderRadius: '3px',
              backgroundColor: 'var(--border, #1e3a4a)',
              overflow: 'hidden',
              marginBottom: '0.375rem',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${percent}%`,
                backgroundColor: '#3b82f6',
                borderRadius: '3px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted-foreground, #94a3b8)' }}>
            {progress ? `${percent}% — will restart automatically` : 'Starting download…'}
          </p>
        </>
      )}
    </div>
  );
}
