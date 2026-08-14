'use client';

import { useCallback } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { rejectUpload } from '@/lib/onlyfansUpload';

/**
 * Staging a file for an outgoing OnlyFans message.
 *
 * Three hops, and the middle one is the point: **the bytes never pass through
 * our API**. A Vercel function accepts about 4.5MB of request body and the media
 * an operator sends is routinely larger, so the browser uploads straight to
 * Cloud Storage against a signed URL and the server only ever handles the paths.
 *
 *   1. `POST /api/onlyfans/media/upload-url` → a signed PUT slot,
 *   2. `PUT` the file to Storage (XHR, because `fetch` still cannot report
 *      upload progress and a 90MB video with no progress bar reads as frozen),
 *   3. `POST /api/onlyfans/media/upload` → the provider fetches it and returns
 *      the `ofapi_media_…` id the composer attaches to the send.
 *
 * **The returned id is single-use and billed.** The composer holds it across a
 * failed send and retries against the same id rather than paying to upload the
 * same file twice — a successful send is the only thing that consumes it.
 */

export class UploadCancelled extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelled';
  }
}

interface UploadHandle {
  /** Fraction complete, 0–1, for the Storage leg. */
  onProgress?: (fraction: number) => void;
  /** Aborts the in-flight PUT. */
  signal?: AbortSignal;
}

function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  handle: UploadHandle,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // Must match the type the URL was signed with, or Storage rejects it. That
    // is what stops the allowlist being sidestepped after the fact.
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) handle.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onabort = () => reject(new UploadCancelled());

    handle.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    if (handle.signal?.aborted) {
      xhr.abort();
      return;
    }

    xhr.send(file);
  });
}

export function useOnlyFansUpload() {
  const authFetch = useAuthFetch();

  return useCallback(
    async (file: File, handle: UploadHandle = {}): Promise<string> => {
      // Checked here as well as server-side: a 400MB drop should be refused
      // before it costs the operator a minute of upload to be told no.
      const rejection = rejectUpload(file);
      if (rejection) throw new Error(rejection);

      const { uploadUrl, path, contentType } = await authFetch(
        '/api/onlyfans/media/upload-url',
        {
          method: 'POST',
          body: JSON.stringify({ contentType: file.type, size: file.size }),
        },
      );

      await putWithProgress(uploadUrl, file, contentType, handle);
      if (handle.signal?.aborted) throw new UploadCancelled();

      const { mediaId } = await authFetch('/api/onlyfans/media/upload', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      return mediaId as string;
    },
    [authFetch],
  );
}
