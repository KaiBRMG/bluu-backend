/**
 * Makes the small WebP preview that rides with a source image.
 *
 * Done in the admin's browser because the bytes must never cross a function
 * (rule 9i) and the candidate's grid should not pull ten multi-megabyte
 * originals while a 20-minute clock is running. The original is stored
 * untouched for download; this is only what the grid shows.
 */
const PREVIEW_EDGE = 480;

export async function makePreview(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
    if (!blob || blob.type !== 'image/webp') throw new Error('This browser cannot make image previews.');
    return blob;
  } finally {
    bitmap.close();
  }
}
