/**
 * Build a Partial containing only the fields that changed between `original`
 * and `form`. Keeps edit dialogs from maintaining two parallel field lists
 * (one to compute `dirty`, one to build the PATCH body) that can drift.
 * Pass a custom comparator per key for non-primitive fields (e.g. arrays).
 */
export function buildDiff<T>(
  form: T,
  original: T,
  keys: (keyof T)[],
  equals: Partial<Record<keyof T, (a: unknown, b: unknown) => boolean>> = {},
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    const eq = equals[key] ?? ((a, b) => a === b);
    if (!eq(form[key], original[key])) out[key] = form[key];
  }
  return out;
}

/** Order-sensitive array equality, for multi-select fields like `type`. */
export function arrayEquals(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((v, i) => v === b[i]);
}
