'use client';

import { WORK_CONTENT_TYPE } from '@/lib/training/modules';
import { api, ApiError } from './api';

export { WORK_CONTENT_TYPE };

/**
 * PUT a file straight to Cloud Storage over a signed URL, reporting progress.
 * `XMLHttpRequest` rather than `fetch` because a 250 MB working file needs a
 * progress bar and `fetch` has no upload progress. The content type must be
 * exactly what the URL was signed for.
 */
export function putFile(
  url: string,
  file: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError('The upload did not go through. Try again.', xhr.status));
    xhr.onerror = () => reject(new ApiError('The upload did not go through. Check your connection and try again.', 0));
    xhr.onabort = () => reject(new ApiError('The upload was interrupted. Try again.', 0));
    xhr.send(file);
  });
}

export type UploadBody =
  | { kind: 'final'; slotId: string; contentType: string; size: number }
  | { kind: 'work'; fileName: string; size: number };

/**
 * The whole upload: sign a slot, PUT the bytes, tell the server it landed. The
 * server re-verifies the object itself (size, type, magic bytes, time), so a
 * success here means the file is in.
 */
export async function uploadFile(
  base: string,
  body: UploadBody,
  file: File,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const { uploadId, uploadUrl } = await api<{ uploadId: string; uploadUrl: string }>(`${base}/upload-url`, {
    method: 'POST',
    body,
  });
  await putFile(uploadUrl, file, contentType, onProgress);
  await api(`${base}/finalize`, { method: 'POST', body: { uploadId } });
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
