'use client';

import { useCallback, useRef, useState } from 'react';
import { IconCheck, IconPhotoPlus, IconRefresh, IconX } from '@tabler/icons-react';
import { UPLOAD_ACCEPT } from '@/lib/modelSubmissions';
import { cn } from '@/lib/utils';
import { prepareImage } from '../_lib/prepareImage';
import { AZURE } from '../_lib/theme';

export type PhotoKind = 'selfie' | 'body' | 'earnings';

export interface PhotoSlot {
  /** Stable local key. Independent of the server id, which arrives later. */
  key: string;
  previewUrl: string;
  status: 'uploading' | 'done' | 'error';
  /** Server-issued id, present once the upload succeeded. */
  id: string | null;
  error?: string;
  file: File;
}

interface PhotoUploaderProps {
  kind: PhotoKind;
  slots: PhotoSlot[];
  onChange: (next: PhotoSlot[]) => void;
  max: number;
  min?: number;
  sessionId: string;
  token: string;
  /** Label announced to screen readers on the add button. */
  addLabel: string;
}

let slotCounter = 0;

/**
 * A grid of photo tiles that upload as soon as they're picked.
 *
 * Uploading on selection rather than on submit is the mobile-first call: the
 * applicant's photos are moving while they read the next question, so pressing
 * Submit is instant instead of a 40-second wait they might abandon. Each tile
 * owns its own state, so one failure never blocks the others and can be retried
 * in place.
 */
export function PhotoUploader({
  kind,
  slots,
  onChange,
  max,
  min,
  sessionId,
  token,
  addLabel,
}: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Latest slots in a ref so an in-flight upload never commits a stale array
  // when several files are processing at once.
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const patch = useCallback(
    (key: string, changes: Partial<PhotoSlot>) => {
      onChange(slotsRef.current.map((s) => (s.key === key ? { ...s, ...changes } : s)));
    },
    [onChange],
  );

  /**
   * Hands a stored photo back to the server: deletes the file and frees the
   * session's slot, so replacing a photo never costs capacity. Fire-and-forget
   * — the tile is already gone from the screen, and a failed release is our
   * bookkeeping problem, not something to interrupt the applicant with.
   */
  const release = useCallback(
    (id: string) => {
      void fetch('/api/model-submissions/upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, token, id }),
      }).catch(() => {});
    },
    [sessionId, token],
  );

  const upload = useCallback(
    async (slot: PhotoSlot) => {
      try {
        const prepared = await prepareImage(slot.file);
        const body = new FormData();
        body.append('sessionId', sessionId);
        body.append('token', token);
        body.append('kind', kind);
        body.append('file', prepared);

        const res = await fetch('/api/model-submissions/upload', { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed. Tap to retry.');

        // The applicant may have removed this tile while it was in flight. The
        // file exists on the server now, so hand it straight back rather than
        // leaking a slot they can never see or clear.
        if (!slotsRef.current.some((s) => s.key === slot.key)) {
          release(data.id);
          return;
        }

        patch(slot.key, { status: 'done', id: data.id, error: undefined });
      } catch (error) {
        patch(slot.key, {
          status: 'error',
          id: null,
          error: error instanceof Error ? error.message : 'Upload failed. Tap to retry.',
        });
      }
    },
    [kind, patch, release, sessionId, token],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const room = max - slotsRef.current.length;
      if (room <= 0) return;
      const accepted = Array.from(files)
        .filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
        .slice(0, room);
      if (accepted.length === 0) return;

      const created: PhotoSlot[] = accepted.map((file) => ({
        key: `slot-${++slotCounter}`,
        previewUrl: URL.createObjectURL(file),
        status: 'uploading',
        id: null,
        file,
      }));

      onChange([...slotsRef.current, ...created]);
      created.forEach((slot) => void upload(slot));
    },
    [max, onChange, upload],
  );

  const remove = useCallback(
    (key: string) => {
      const target = slotsRef.current.find((s) => s.key === key);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        // Already stored? Give the slot back so the replacement can go up.
        if (target.id) release(target.id);
      }
      onChange(slotsRef.current.filter((s) => s.key !== key));
    },
    [onChange, release],
  );

  // NOTE: previews are revoked in `remove()` only, never on unmount. Slot state
  // is owned by the page, so this component unmounts every time the applicant
  // steps away — revoking here would blank every preview the moment they went
  // Back. The remaining handful of blobs are released when the page unloads.

  const full = slots.length >= max;
  const done = slots.filter((s) => s.status === 'done').length;
  const uploading = slots.some((s) => s.status === 'uploading');
  const failures = [
    ...new Set(
      slots
        .filter((s) => s.status === 'error')
        .map((s) => s.error ?? 'That photo could not be uploaded. Tap the tile to retry.'),
    ),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'grid grid-cols-3 gap-2.5 rounded-2xl transition-colors sm:grid-cols-4',
          dragging && 'outline-2 outline-offset-4 outline-dashed outline-[#00b8f5]/60',
        )}
      >
        {/* Fixed tiles: each preview is `absolute inset-0` so it is out of flow
            and cannot stretch its frame. An aspect-ratio box only *prefers* its
            size — a tall in-flow image grows it, and the grid would jump as each
            photo decoded. */}
        {slots.map((slot) => (
          <figure
            key={slot.key}
            className="group relative aspect-3/4 overflow-hidden rounded-xl border border-white/[0.10] bg-white/[0.03]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slot.previewUrl}
              alt=""
              className={cn(
                'absolute inset-0 size-full object-cover transition-opacity duration-200',
                slot.status !== 'done' && 'opacity-45',
              )}
            />

            {slot.status === 'uploading' && (
              <span
                className="absolute inset-0 grid place-items-center"
                role="status"
                aria-label="Uploading photo"
              >
                <span
                  className="size-6 animate-spin rounded-full border-2 border-white/25 motion-reduce:animate-none"
                  style={{ borderTopColor: AZURE }}
                />
              </span>
            )}

            {slot.status === 'done' && (
              <span
                className="absolute bottom-1.5 left-1.5 grid size-5 place-items-center rounded-full"
                style={{ backgroundColor: AZURE }}
                aria-hidden
              >
                <IconCheck className="size-3.5 stroke-[3] text-[#04141c]" />
              </span>
            )}

            {slot.status === 'error' && (
              <button
                type="button"
                onClick={() => {
                  patch(slot.key, { status: 'uploading', error: undefined });
                  void upload({ ...slot, status: 'uploading' });
                }}
                // The tile is far too small to hold the reason legibly, so it
                // stays a plain Retry target and the message renders full-width
                // under the grid.
                aria-label={`Retry upload — ${slot.error ?? 'upload failed'}`}
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-950/70 px-1 text-center text-xs font-medium text-red-100"
              >
                <IconRefresh className="size-4" />
                Retry
              </button>
            )}

            <button
              type="button"
              onClick={() => remove(slot.key)}
              aria-label="Remove photo"
              className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-black/65 text-white/85 transition-colors hover:bg-black/85 hover:text-white"
            >
              <IconX className="size-4" />
            </button>
          </figure>
        ))}

        {!full && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex aspect-3/4 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/20 bg-white/[0.02] text-white/55 transition-colors hover:border-[#00b8f5]/60 hover:bg-[#00b8f5]/[0.06] hover:text-white focus-visible:border-[#00b8f5] focus-visible:outline-none"
          >
            <IconPhotoPlus className="size-6" />
            <span className="text-xs font-medium">Add</span>
            <span className="sr-only">{addLabel}</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple={max > 1}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <p className="text-sm tabular-nums text-white/50" aria-live="polite">
        {uploading
          ? `Uploading… ${done} of ${slots.length} ready`
          : min
            ? `${done} of ${min} required · up to ${max}`
            : `${done} uploaded`}
      </p>

      {/* Why an upload failed. Deduplicated: five photos rejected for the same
          reason is one problem, not five. Without this the applicant sees a
          Retry tile with no explanation and no way to act on it. */}
      {failures.length > 0 && (
        <div role="alert" className="flex flex-col gap-1">
          {failures.map((message) => (
            <p key={message} className="text-sm font-medium text-red-300">
              {message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
