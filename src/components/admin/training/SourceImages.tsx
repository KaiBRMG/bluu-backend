'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IMAGE_TYPES, MAX_SOURCE_BYTES, OUTPUT_ACCEPT } from '@/lib/training/modules';

interface SourceImagesProps {
  images: { id: string; name: string; thumbUrl: string }[];
  required: number;
  /** Once a part has opened a candidate may be choosing from these, so they are fixed. */
  locked: boolean;
  onAdd: (file: File) => Promise<void>;
  onRemove: (imageId: string) => Promise<void>;
  /** Once per batch, not once per file, so ten uploads read the session once. */
  onBatchDone: () => void;
}

/**
 * A part's source images. The admin picks files; each is previewed in this
 * browser, then both go straight to Storage (rule 9i). Uploads run three at a
 * time so ten large images do not queue behind each other or flood the line.
 */
export default function SourceImages({ images, required, locked, onAdd, onRemove, onBatchDone }: SourceImagesProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const room = required - images.length;

  async function addFiles(files: File[]) {
    const accepted = files.filter((f) => f.type in IMAGE_TYPES);
    if (accepted.length < files.length) toast.error('Only JPG, PNG and WebP images are accepted');
    const batch = accepted.slice(0, Math.max(0, room));
    if (accepted.length > batch.length) toast.error(`Only ${required} images fit. Added the first ${batch.length}.`);
    if (batch.length === 0) return;

    setProgress({ done: 0, total: batch.length });
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      while (cursor < batch.length) {
        const file = batch[cursor++];
        if (file.size > MAX_SOURCE_BYTES) {
          toast.error(`${file.name} is over ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB`);
        } else {
          try {
            await onAdd(file);
          } catch (err) {
            toast.error(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
          }
        }
        done += 1;
        setProgress({ done, total: batch.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setProgress(null);
    onBatchDone();
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-400 tabular-nums">
          Source images · {images.length} of {required}
        </p>
        {!locked && room > 0 && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={OUTPUT_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                void addFiles(files);
              }}
            />
            <Button variant="outline" size="xs" disabled={!!progress} onClick={() => inputRef.current?.click()}>
              {progress ? <Loader2 className="activity-spinner size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
              {progress ? `Uploading ${progress.done} of ${progress.total}` : 'Add images'}
            </Button>
          </>
        )}
      </div>

      {images.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">
          None yet. Candidates cannot start this part until all {required} are here.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {images.map((img) => (
            <li key={img.id} className="group relative overflow-hidden rounded-lg border border-white/[0.07] bg-black/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumbUrl} alt={img.name} width={240} height={240} loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
              {!locked && (
                <Button
                  variant="secondary"
                  size="icon-xs"
                  aria-label={`Remove ${img.name}`}
                  disabled={removing === img.id}
                  onClick={async () => {
                    setRemoving(img.id);
                    try {
                      await onRemove(img.id);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Could not remove it');
                    } finally {
                      setRemoving(null);
                    }
                  }}
                  className="absolute top-1 right-1 size-6 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </Button>
              )}
              <p className="truncate px-2 py-1 text-[11px] text-zinc-400">{img.name}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
