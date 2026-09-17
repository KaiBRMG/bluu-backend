/**
 * The tokens every **public** Bluu surface shares.
 *
 * There are now two of them — the model application form (`/model-submissions`,
 * DESIGN.md §8) and the installer page (`/download`, §9) — and both are read in
 * a normal browser by someone who is not signed in to anything. They share a
 * ground, a single accent voice and a surface recipe; they differ in scale,
 * density and in the one decorative moment each is allowed.
 *
 * The azure triad used to live in `model-submissions/_lib/theme.ts`. It moved
 * here the moment a second surface needed it, because the alternative was a
 * third literal `#00b8f5` in the codebase and no record of which spelling was
 * the intended one. That file re-exports these, so every existing import path
 * still resolves and §8's "import the skin from `_lib/theme.ts`" stays true.
 *
 * Import these; never inline a hex on a public surface.
 */

/** Bluu azure, sampled from the logo. The one voice on every public surface. */
export const AZURE = '#00b8f5';
export const AZURE_DEEP = '#0090c8';

/**
 * Ink for anything sitting ON azure. White on `AZURE` measures 2.3:1 and fails
 * AA outright; this brand-tinted near-black reads 7.2:1. Never re-ink it white.
 */
export const AZURE_INK = '#04141c';

/** Interior surface recipe — translucent white on the dark ground. */
export const PANEL = 'border border-white/[0.08] bg-white/[0.025]';
