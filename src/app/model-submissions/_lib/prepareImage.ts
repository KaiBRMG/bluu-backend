/**
 * Client-side image preparation before upload: HEIC transcode, then downscale.
 *
 * **HEIC has to be handled here, not on the server.** iPhones shoot HEIC in an
 * HEVC-coded container, and `sharp`'s prebuilt libvips ships without the HEVC
 * codec (it is patent-encumbered, and there is no way to add it on Vercel). So
 * a real iPhone HEIC is undecodable server-side, full stop — the only place it
 * can be converted is in the browser, which is what `heic-to` does via a
 * WebAssembly build of libheif.
 *
 * In practice most iPhone applicants never reach that path: iOS transcodes to
 * JPEG automatically when a photo is picked through a file input. It's the
 * AirDropped `.heic` on a Mac, the Android user forwarding an iPhone photo, and
 * the "Keep Originals" cases that need this.
 *
 * Downscaling is a convenience, never a control: this audience is on phones
 * sending 4–12MB camera files, and shrinking to a long edge of 2000px turns a
 * 30s upload into a 3s one. The server re-decodes, re-encodes and re-validates
 * every byte regardless. If anything here fails, the original file is handed
 * over untouched and the server decides.
 */

const MAX_EDGE = 2000;
const QUALITY = 0.86;
/** Below this there is nothing worth re-encoding. */
const SKIP_UNDER_BYTES = 600 * 1024;

/** HEIC/HEIF often arrives with an empty or wrong MIME type, so check both. */
function looksLikeHeic(file: File): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

function renamed(file: File, blob: Blob, extension: string, type: string): File {
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, {
    type,
    lastModified: file.lastModified,
  });
}

/**
 * Transcodes HEIC to JPEG in the browser. The libheif wasm is a meaningful
 * download, so it is imported dynamically — only the applicants who actually
 * pick a HEIC ever pay for it, and it stays out of the form's initial bundle.
 */
async function transcodeHeic(file: File): Promise<File> {
  const { heicTo, isHeic } = await import('heic-to');

  // `isHeic` sniffs the actual bytes. A Safari-supplied JPEG that merely kept a
  // .heic filename must not be run through the converter.
  if (!(await isHeic(file))) return file;

  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
  return renamed(file, blob, 'jpg', 'image/jpeg');
}

export async function prepareImage(file: File): Promise<File> {
  let working = file;

  if (looksLikeHeic(file)) {
    try {
      working = await transcodeHeic(file);
    } catch {
      // Leave it as-is. Safari can decode HEIC natively below, and if nothing
      // can, the server returns a message naming the format.
      working = file;
    }
  }

  if (typeof createImageBitmap !== 'function') return working;
  if (working.size < SKIP_UNDER_BYTES) return working;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(working);
  } catch {
    return working;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return working;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    if (!blob) return working;
    // A transcoded HEIC must go up as the JPEG even when the canvas pass didn't
    // shrink it — the original bytes are the ones the server cannot read.
    if (blob.size >= working.size && working === file) return working;

    return renamed(file, blob, 'jpg', 'image/jpeg');
  } catch {
    return working;
  } finally {
    bitmap.close();
  }
}
