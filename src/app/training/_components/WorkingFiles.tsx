'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconLoader2, IconPaperclip, IconRefresh, IconX } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { MAX_WORKING_FILES, MAX_WORKING_FILE_BYTES } from '@/lib/training/modules';
import type { WorkingFileView } from '@/lib/training/types';
import { cn } from '@/lib/utils';
import { ApiError } from '../_lib/api';
import { AZURE_EDGE, AZURE_TEXT, PANEL, PROGRESS_AZURE } from '../_lib/theme';
import { WORK_CONTENT_TYPE, fmtBytes, uploadFile } from '../_lib/upload';
import { DROPZONE_ATTR } from '../_lib/useRoomGuards';

interface Item {
  key: string;
  name: string;
  bytes: number;
  state: 'queued' | 'uploading' | 'done' | 'error';
  progress: number;
  error: string;
  /** The upload itself failed and the file is still held, so Retry has something to send. */
  retryable: boolean;
}

interface WorkingFilesProps {
  base: string;
  initial: WorkingFileView[];
  /** No new files: the clock is out, the room is finishing, or the screen is not shared. */
  locked: boolean;
  /** The clock itself has run out — only then is a file in flight "still arriving". */
  expired: boolean;
  /** How many are still travelling — the room waits for them after the clock ends. */
  onBusy: (count: number) => void;
}

/**
 * Working files: any type, up to 250 MB each, uploaded one at a time so they do
 * not starve the screen recording of bandwidth. After the clock ends a file that
 * is already travelling is left to finish (the server allows it ten minutes) and
 * says "Still arriving…" until it lands or fails.
 */
export function WorkingFiles({ base, initial, locked, expired, onBusy }: WorkingFilesProps) {
  const [items, setItems] = useState<Item[]>(() =>
    initial.map((f) => ({ key: f.id, name: f.name, bytes: f.bytes, state: 'done', progress: 1, error: '', retryable: false })),
  );
  const queue = useRef<{ key: string; file: File }[]>([]);
  // A file whose upload failed stays here, so Retry does not make the candidate find it again.
  const failed = useRef(new Map<string, File>());
  const running = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const count = items.filter((i) => i.state === 'done' || i.state === 'uploading' || i.state === 'queued').length;
  const busy = items.filter((i) => i.state === 'uploading' || i.state === 'queued').length;
  useEffect(() => onBusy(busy), [busy, onBusy]);

  const patch = (key: string, next: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...next } : i)));

  async function drain() {
    if (running.current) return;
    running.current = true;
    while (queue.current.length > 0) {
      const { key, file } = queue.current.shift()!;
      patch(key, { state: 'uploading', progress: 0 });
      try {
        await uploadFile(base, { kind: 'work', fileName: file.name, size: file.size }, file, WORK_CONTENT_TYPE, (p) =>
          patch(key, { progress: p }),
        );
        failed.current.delete(key);
        patch(key, { state: 'done', progress: 1 });
      } catch (err) {
        failed.current.set(key, file);
        patch(key, { state: 'error', retryable: true, error: err instanceof ApiError ? err.message : 'Something went wrong. Try again.' });
      }
    }
    running.current = false;
  }

  function retry(key: string) {
    const file = failed.current.get(key);
    if (!file || locked || count >= MAX_WORKING_FILES) return;
    queue.current.push({ key, file });
    patch(key, { state: 'queued', progress: 0, error: '', retryable: false });
    void drain();
  }

  /** Takes a failed row off the list. A saved file cannot be removed — it is already part of the submission. */
  function dismiss(key: string) {
    failed.current.delete(key);
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  function add(files: FileList | File[]) {
    if (locked) return;
    const next: Item[] = [];
    let room = MAX_WORKING_FILES - count;
    for (const file of Array.from(files)) {
      const key = crypto.randomUUID();
      if (file.size === 0) {
        next.push({ key, name: file.name, bytes: 0, state: 'error', progress: 0, error: 'That file is empty.', retryable: false });
      } else if (file.size > MAX_WORKING_FILE_BYTES) {
        next.push({ key, name: file.name, bytes: file.size, state: 'error', progress: 0, error: `Over the ${fmtBytes(MAX_WORKING_FILE_BYTES)} limit.`, retryable: false });
      } else if (room <= 0) {
        next.push({ key, name: file.name, bytes: file.size, state: 'error', progress: 0, error: `At most ${MAX_WORKING_FILES} working files.`, retryable: false });
      } else {
        room--;
        queue.current.push({ key, file });
        next.push({ key, name: file.name, bytes: file.size, state: 'queued', progress: 0, error: '', retryable: false });
      }
    }
    setItems((prev) => [...prev, ...next]);
    void drain();
  }

  return (
    <section aria-labelledby="work-heading" className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="work-heading" className="text-xl font-semibold">
          Working files
        </h2>
        <p className="text-sm text-white/70 tabular-nums">
          {count} / {MAX_WORKING_FILES}
        </p>
      </div>
      <p className="mt-1 text-sm text-white/70">
        Rejected attempts, project files, prompts — anything of yours, any type, up to {fmtBytes(MAX_WORKING_FILE_BYTES)} each.
      </p>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files) add(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        {...{ [DROPZONE_ATTR]: locked ? 'off' : 'on' }}
        onDragOver={(e) => {
          if (locked) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!locked) add(e.dataTransfer.files);
        }}
        className={cn(
          'mt-3 flex min-h-20 items-center gap-4 rounded-xl border border-dashed p-3 transition-colors',
          over ? AZURE_EDGE : 'border-white/20',
        )}
      >
        <p className="min-w-0 flex-1 text-sm text-white/70">Drop files here, or choose them.</p>
        <Button
          type="button"
          variant="outline"
          disabled={locked || count >= MAX_WORKING_FILES}
          onClick={() => input.current?.click()}
          className="h-11 shrink-0 border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
        >
          <IconPaperclip className="size-4" aria-hidden />
          Add files
        </Button>
      </div>

      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.key} className={`${PANEL} flex flex-col gap-2 rounded-xl px-4 py-3`}>
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 truncate text-sm text-white">{i.name}</p>
                <p className="shrink-0 text-xs text-white/70 tabular-nums">{fmtBytes(i.bytes)}</p>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-white/80">
                  {i.state === 'done' && <IconCheck className={cn('size-3.5', AZURE_TEXT)} aria-hidden />}
                  {i.state === 'uploading' && <IconLoader2 className="activity-spinner size-3.5 animate-spin" aria-hidden />}
                  {i.state === 'queued' ? 'Waiting' : i.state === 'uploading' ? (expired ? 'Still arriving…' : 'Uploading') : i.state === 'done' ? 'Saved' : 'Failed'}
                </span>
              </div>
              {i.state === 'uploading' && (
                <Progress value={i.progress * 100} aria-label={`Uploading ${i.name}`} className={cn('h-1.5 bg-white/10', PROGRESS_AZURE)} />
              )}
              {i.state === 'error' && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <p role="alert" className="min-w-0 flex-1 text-sm text-red-300">
                    {i.error}
                  </p>
                  {i.retryable && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={locked}
                      onClick={() => retry(i.key)}
                      aria-label={`Retry ${i.name}`}
                      className="h-11 border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
                    >
                      <IconRefresh className="size-4" aria-hidden />
                      Retry
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => dismiss(i.key)}
                    aria-label={`Remove ${i.name} from the list`}
                    className="h-11 px-3 text-sm text-white/80 hover:text-white"
                  >
                    <IconX className="size-4" aria-hidden />
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
