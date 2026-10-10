/**
 * Screen fingerprints — did the screen change between two screenshots?
 *
 * A fingerprint is the capture shrunk to a 32×18 greyscale grid (576 bytes,
 * base64). Two captures are **unchanged** when no cell moved by more than a
 * small tolerance. Why not a 64-bit perceptual hash: at 9×8 each cell covers a
 * ninth of the screen's width, and a few new lines in a chat window shift a
 * cell's mean too little to flip a bit — a working agent would read as static,
 * which is the one mistake this must not make. At 32×18 a new message moves a
 * cell by far more than the tolerance, while the menu-bar clock ticking over
 * (a few digits inside one ~100×110px cell) stays under it.
 *
 * Computed in the renderer from the PNG it is about to upload (no extra bytes,
 * no image decode on the server); compared on the server against the previous
 * capture's fingerprints, held on `active_sessions`. Display only — a static
 * screen never changes worked time.
 */

export const FINGERPRINT_COLS = 32;
export const FINGERPRINT_ROWS = 18;
const CELLS = FINGERPRINT_COLS * FINGERPRINT_ROWS;

/** Largest change in any one cell (0–255) still treated as "the same screen". */
const MAX_CELL_DELTA = 12;
/** Largest mean change across all cells still treated as "the same screen". */
const MAX_MEAN_DELTA = 1.5;

function decode(fp: string): Uint8Array | null {
  try {
    const bin = typeof atob === 'function' ? atob(fp) : Buffer.from(fp, 'base64').toString('binary');
    if (bin.length !== CELLS) return null;
    const out = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function isFingerprint(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 800 && decode(v) !== null;
}

/** True when two fingerprints describe the same screen. Malformed input is never "unchanged". */
export function sameScreen(a: string, b: string): boolean {
  const x = decode(a);
  const y = decode(b);
  if (!x || !y) return false;
  let sum = 0;
  for (let i = 0; i < CELLS; i++) {
    const d = Math.abs(x[i] - y[i]);
    if (d > MAX_CELL_DELTA) return false;
    sum += d;
  }
  return sum / CELLS <= MAX_MEAN_DELTA;
}

/**
 * Browser only. Fingerprint a decoded capture (the same Blob that is uploaded).
 * Two-step downscale with high-quality resampling so each cell is an average
 * of its block rather than one sampled pixel. Resolves `null` on any failure —
 * a capture without a fingerprint is simply not compared.
 */
export async function computeFingerprint(blob: Blob): Promise<string | null> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;
    const mid = await createImageBitmap(blob, { resizeWidth: FINGERPRINT_COLS * 8, resizeHeight: FINGERPRINT_ROWS * 8, resizeQuality: 'high' });
    const small = await createImageBitmap(mid, { resizeWidth: FINGERPRINT_COLS, resizeHeight: FINGERPRINT_ROWS, resizeQuality: 'high' });
    mid.close();
    const canvas = new OffscreenCanvas(FINGERPRINT_COLS, FINGERPRINT_ROWS);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(small, 0, 0);
    small.close();
    const { data } = ctx.getImageData(0, 0, FINGERPRINT_COLS, FINGERPRINT_ROWS);
    let bin = '';
    for (let i = 0; i < CELLS; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      bin += String.fromCharCode(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
    }
    return btoa(bin);
  } catch {
    return null;
  }
}
