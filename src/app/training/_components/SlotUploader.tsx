'use client';

import { useRef, useState } from 'react';
import { IconCheck, IconLoader2, IconUpload } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { OUTPUT_ACCEPT } from '@/lib/training/modules';
import { cn } from '@/lib/utils';
import { DROPZONE_ATTR } from '../_lib/useRoomGuards';
import { AZURE_CHIP, AZURE_EDGE } from '../_lib/theme';
import { fmtBytes } from '../_lib/upload';

export interface SlotState {
  uploaded: boolean;
  busy: boolean;
  /** 0–1 while `busy`. */
  progress: number;
  previewUrl: string | null;
  bytes: number;
  error: string;
}

export const EMPTY_SLOT: SlotState = { uploaded: false, busy: false, progress: 0, previewUrl: null, bytes: 0, error: '' };

interface SlotUploaderProps {
  /** The server's name for it: `T2 - 005`. Shown on the slot. */
  stem: string;
  state: SlotState;
  disabled: boolean;
  /** Why it cannot take an upload yet ("Choose an identity first"). */
  waitingFor?: string;
  onFile: (file: File) => void;
  compact?: boolean;
}

/**
 * One final-image slot: a drop zone that becomes the uploaded thumbnail. The
 * state — empty / uploading % / uploaded — is shown in words as well as shape.
 */
export function SlotUploader({ stem, state, disabled, waitingFor, onFile, compact }: SlotUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const off = disabled || state.busy || !!waitingFor;

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-white tabular-nums">{stem}</p>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
            state.uploaded ? AZURE_CHIP : 'border-white/[0.12] text-white/70',
          )}
        >
          {state.uploaded && <IconCheck className="size-3" aria-hidden />}
          {state.busy ? 'Uploading' : state.uploaded ? 'Uploaded' : 'Empty'}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={OUTPUT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      <div
        {...{ [DROPZONE_ATTR]: off ? 'off' : 'on' }}
        onDragOver={(e) => {
          if (off) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !off) onFile(file);
        }}
        className={cn(
          'flex items-center gap-3 rounded-xl border border-dashed p-3 transition-colors',
          compact ? 'min-h-16' : 'min-h-24',
          over ? AZURE_EDGE : 'border-white/20',
        )}
      >
        {state.previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={state.previewUrl}
            alt={`Your upload for ${stem}`}
            className={cn('shrink-0 rounded-lg object-cover', compact ? 'size-12' : 'size-20')}
          />
        )}
        <div className="min-w-0 flex-1 text-sm">
          {state.busy ? (
            <p className="flex items-center gap-2 text-white tabular-nums" role="status">
              <IconLoader2 className="activity-spinner size-4 animate-spin" aria-hidden />
              Uploading {Math.round(state.progress * 100)}%
            </p>
          ) : state.uploaded ? (
            <p className="text-white/80 tabular-nums">{fmtBytes(state.bytes)}</p>
          ) : (
            <p className="text-white/70">{waitingFor ?? 'Drop an image here, or choose a file.'}</p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={off}
          onClick={() => inputRef.current?.click()}
          className="h-11 shrink-0 border-white/20 bg-transparent px-4 text-sm text-white hover:bg-white/[0.08] hover:text-white"
        >
          <IconUpload className="size-4" aria-hidden />
          {state.uploaded ? 'Replace' : 'Upload'}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
    </div>
  );
}
