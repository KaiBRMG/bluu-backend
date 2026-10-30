'use client';

import { useEffect, useRef, useState } from 'react';
import { IconDownload, IconLoader2 } from '@tabler/icons-react';
import { zipSync } from 'fflate';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DATASETS, type DatasetId } from '@/lib/training/modules';
import type { DatasetView, DatasetsResponse } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { api } from '../_lib/api';
import { AZURE, AZURE_EDGE, AZURE_INK, DIALOG_PANEL, FOCUS, OVERLAY_BUTTON } from '../_lib/theme';

interface DatasetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** API base for the test: `/api/training/modules/{m}/tests/{t}`. */
  base: string;
  /** The identities this test offers. */
  identities: DatasetId[];
  /** The tab to open on. Read once: the parent mounts a fresh modal for each opening. */
  initial: DatasetId | null;
}

type Zip = { state: 'idle' } | { state: 'working'; done: number; total: number } | { state: 'done'; failed: string[] };

/**
 * The reference images, one tab per identity. Each image downloads on its own,
 * and **Download all** zips the tab in THIS browser from the signed URLs — no
 * bytes cross a function (rule 9i). A file that fails is named with a Retry and
 * the rest still zip. Only the open tab's images are fetched and signed.
 */
export function DatasetModal({ open, onOpenChange, base, identities, initial }: DatasetModalProps) {
  const [active, setActive] = useState<DatasetId>(initial ?? identities[0]);
  const [loaded, setLoaded] = useState<Partial<Record<DatasetId, DatasetView>>>({});
  const [error, setError] = useState('');
  const [zip, setZip] = useState<Zip>({ state: 'idle' });
  const retried = useRef(new Set<DatasetId>());

  // A failed image marks its tab stale, which re-runs the fetch below for that tab only.
  const [stale, setStale] = useState<Partial<Record<DatasetId, number>>>({});
  const staleNow = stale[active] ?? 0;

  useEffect(() => {
    if (!open || (loaded[active] && staleNow === 0)) return;
    let cancelled = false;
    api<DatasetsResponse>(`${base}/datasets?identity=${active}`)
      .then((res) => {
        if (cancelled) return;
        setLoaded((l) => ({ ...l, [active]: res.datasets[0] }));
        setStale((st) => ({ ...st, [active]: 0 }));
        setError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load these images.');
      });
    return () => {
      cancelled = true;
    };
    // `loaded` is read to skip a tab already fetched; it must not re-run the fetch when it fills in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, base, staleNow]);

  const view = loaded[active];

  async function downloadAll(only?: string[]) {
    if (!view) return;
    const images = only ? view.images.filter((i) => only.includes(i.id)) : view.images;
    setZip({ state: 'working', done: 0, total: images.length });
    const files: Record<string, Uint8Array> = {};
    const failed: string[] = [];
    let done = 0;
    for (const img of images) {
      try {
        const res = await fetch(img.downloadUrl);
        if (!res.ok) throw new Error(String(res.status));
        files[img.name] = new Uint8Array(await res.arrayBuffer());
      } catch {
        failed.push(img.id);
      }
      setZip({ state: 'working', done: ++done, total: images.length });
    }
    if (Object.keys(files).length > 0) {
      // Images are already compressed: store, do not deflate.
      const blob = new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${DATASETS[active].label} dataset.zip`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    setZip({ state: 'done', failed });
  }

  const failedNames = zip.state === 'done' ? view?.images.filter((i) => zip.failed.includes(i.id)).map((i) => i.name) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-0 rounded-2xl p-0 sm:max-w-5xl', DIALOG_PANEL)}>
        <DialogHeader className="shrink-0 px-5 pt-5 pb-3 sm:px-6">
          <DialogTitle className="text-xl">Datasets</DialogTitle>
          <DialogDescription className="text-white/70">
            Use only the dataset assigned to each image. Do not mix references between identities.
          </DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="Identity" className="flex shrink-0 gap-2 overflow-x-auto px-5 pt-1 pb-3 sm:px-6">
          {identities.map((id) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={active === id}
              onClick={() => {
                setActive(id);
                setZip({ state: 'idle' });
              }}
              className={cn(
                'h-11 shrink-0 rounded-full border px-5 text-sm font-medium',
                FOCUS,
                active === id ? `${AZURE_EDGE} text-white` : 'border-white/[0.12] text-white/80 hover:bg-white/[0.06]',
              )}
            >
              {DATASETS[id].label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-y border-white/10 px-5 py-3 sm:px-6">
          <Button
            disabled={!view || zip.state === 'working'}
            onClick={() => void downloadAll()}
            className="h-11 px-5 font-semibold"
            style={{ backgroundColor: AZURE, color: AZURE_INK }}
          >
            {zip.state === 'working' ? (
              <IconLoader2 className="activity-spinner size-4 animate-spin" aria-hidden />
            ) : (
              <IconDownload className="size-4" aria-hidden />
            )}
            Download all
          </Button>
          <p className="text-sm text-white/75 tabular-nums" role="status" aria-live="polite">
            {zip.state === 'working'
              ? `Preparing ${zip.done} / ${zip.total}`
              : zip.state === 'done' && zip.failed.length === 0
                ? 'Downloaded.'
                : view
                  ? `${view.images.length} images`
                  : ''}
          </p>
          {zip.state === 'done' && zip.failed.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm" role="alert">
              <p className="text-amber-200">
                {zip.failed.length} could not be fetched: {failedNames?.slice(0, 3).join(', ')}
                {zip.failed.length > 3 ? '…' : ''}
              </p>
              <Button
                variant="outline"
                onClick={() => void downloadAll(zip.failed)}
                className="h-11 border-white/20 bg-transparent px-4 text-white hover:bg-white/[0.08] hover:text-white"
              >
                Retry
              </Button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {error ? (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          ) : !view ? (
            <p className="text-sm text-white/70" role="status">
              Loading…
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {view.images.map((img) => (
                <li key={img.id} className="relative overflow-hidden rounded-xl border border-white/[0.10] bg-white/[0.03]">
                  <span className="block aspect-[3/4] w-full bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.thumbUrl}
                      alt={img.name}
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                      // A signed URL that has expired is replaced silently, once per tab.
                      onError={() => {
                        if (retried.current.has(active)) return;
                        retried.current.add(active);
                        setStale((st) => ({ ...st, [active]: (st[active] ?? 0) + 1 }));
                      }}
                    />
                  </span>
                  <span className="block truncate px-3 py-2 text-xs text-white/80">{img.name}</span>
                  <a
                    href={img.downloadUrl}
                    data-download
                    aria-label={`Download ${img.name}`}
                    className={cn(OVERLAY_BUTTON, FOCUS)}
                  >
                    <IconDownload className="size-4" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
