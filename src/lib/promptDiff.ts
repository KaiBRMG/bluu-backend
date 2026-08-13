/**
 * Prompt version diffing. Two tiers, deliberately:
 *
 *   summariseChange()  O(n) — runs on the server at save time and is stored on
 *                      the version doc, so listing history costs no computation.
 *   wordDiff()         O(n*m) LCS — runs on the client only when someone opens
 *                      "Show changes" for one specific pair of versions.
 *
 * Shared by the service and the UI; must stay free of server-only imports.
 */

import type { ChangeKind, ChangeRegion, ChangeStat } from '@/types/promptLibrary';

/**
 * Splits into words while keeping the whitespace that follows each one, so a
 * diff can be re-rendered without inventing or losing spacing.
 */
export function tokenizeWords(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/**
 * Comparison key for a token: the word itself, surrounding whitespace ignored.
 *
 * Case is deliberately significant. In a prompt, "must" and "MUST" are not the
 * same instruction, so a capitalisation change has to register as a change
 * rather than vanish from both the summary and the inline view.
 */
function key(token: string): string {
  return token.trim();
}

interface Trimmed {
  a: string[];
  b: string[];
  prefix: number;
  suffix: number;
  aMid: string[];
  bMid: string[];
}

/**
 * Strips the shared head and tail, leaving only the span that actually differs.
 *
 * Everything downstream is built on this: it locates the edit for the summary,
 * and it is what keeps the LCS table proportional to the size of the CHANGE
 * rather than the size of the prompt.
 */
function trimCommon(before: string, after: string): Trimmed {
  const a = tokenizeWords(before);
  const b = tokenizeWords(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && key(a[prefix]) === key(b[prefix])) prefix++;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    key(a[a.length - 1 - suffix]) === key(b[b.length - 1 - suffix])
  ) {
    suffix++;
  }

  return {
    a,
    b,
    prefix,
    suffix,
    aMid: a.slice(prefix, a.length - suffix),
    bMid: b.slice(prefix, b.length - suffix),
  };
}

function classify(ratio: number): ChangeKind {
  if (ratio < 0.08) return 'tweak';
  if (ratio < 0.35) return 'edit';
  return 'rewrite';
}

function region(start: number, end: number, total: number): ChangeRegion {
  if (total === 0 || end <= start) return 'none';
  const span = (end - start) / total;
  if (span > 0.6) return 'throughout';
  const midpoint = (start + end) / 2 / total;
  if (midpoint < 0.34) return 'start';
  if (midpoint > 0.66) return 'end';
  return 'middle';
}

/**
 * Cheap, exact-enough summary of an edit.
 *
 * Trimming the shared prefix and suffix first does two jobs at once: it locates
 * the edit (which is what `region` reports) and it shrinks the comparison to
 * only the words that actually moved, so counting them is a multiset
 * difference rather than an alignment problem.
 */
export function summariseChange(before: string, after: string): ChangeStat {
  const { a, b, prefix, suffix, aMid, bMid } = trimCommon(before, after);

  // Multiset difference over the changed span: words present in one side and
  // not the other. Reordering a sentence therefore reads as no change, which is
  // the honest answer for a word-level summary.
  const counts = new Map<string, number>();
  for (const t of aMid) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);

  let added = 0;
  for (const t of bMid) {
    const k = key(t);
    const n = counts.get(k) ?? 0;
    if (n > 0) counts.set(k, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;

  const total = Math.max(a.length, b.length, 1);
  const ratio = Math.min(1, (added + removed) / total);

  return {
    added,
    removed,
    ratio,
    region: region(prefix, b.length - suffix, b.length),
    kind: added + removed === 0 ? 'tweak' : classify(ratio),
  };
}

const KIND_LABEL: Record<ChangeKind, string> = {
  initial: 'First version',
  tweak: 'Tweak',
  edit: 'Edit',
  rewrite: 'Rewrite',
};

const REGION_LABEL: Record<ChangeRegion, string> = {
  none: '',
  start: 'near the start',
  middle: 'in the middle',
  end: 'near the end',
  throughout: 'throughout',
};

export function changeKindLabel(kind: ChangeKind): string {
  return KIND_LABEL[kind];
}

/**
 * One line a human can read at a glance: what scale of edit, how many words
 * moved, and roughly where. Falls back gracefully when nothing textual changed
 * (a reordering, or a metadata-only save).
 */
export function describeChange(change: ChangeStat | null): string {
  if (!change) return '';
  if (change.kind === 'initial') return KIND_LABEL.initial;
  if (change.added === 0 && change.removed === 0) return 'Reworded — no words added or removed';

  const counts = [
    change.added > 0 ? `+${change.added}` : null,
    change.removed > 0 ? `−${change.removed}` : null,
  ]
    .filter(Boolean)
    .join(' / ');

  const where = REGION_LABEL[change.region];
  return `${KIND_LABEL[change.kind]} · ${counts} words${where ? ` · ${where}` : ''}`;
}

export type DiffOp = 'same' | 'added' | 'removed';

export interface DiffPart {
  op: DiffOp;
  text: string;
}

/**
 * Guards the LCS table. 1M cells is ~4MB of Uint32Array and tens of
 * milliseconds; past that the inline view degrades to the stored summary rather
 * than freezing the renderer.
 */
export const DIFF_CELL_LIMIT = 1_000_000;

/**
 * Measured on the TRIMMED span, matching what wordDiff actually tables. A
 * one-word fix inside a 5,000-word prompt costs almost nothing, and judging it
 * by the prompt's full length would refuse to render a diff that is free.
 */
export function canRenderDiff(before: string, after: string): boolean {
  const { aMid, bMid } = trimCommon(before, after);
  return aMid.length * bMid.length <= DIFF_CELL_LIMIT;
}

/**
 * Word-level LCS diff, prefix/suffix-trimmed so the expensive table only ever
 * covers the span that actually differs. Adjacent parts of the same op are
 * merged so the renderer emits one span per run rather than one per word.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const { b, prefix, suffix, aMid, bMid } = trimCommon(before, after);

  const parts: DiffPart[] = [];
  const push = (op: DiffOp, text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.op === op) {
      last.text += text;
      return;
    }
    // Deleted words are foreign to the new text, so nothing in the new stream
    // supplies the space in front of them. Without this, deleting the final
    // word renders it welded to the one before it ("one two~~three~~").
    // Additions need no such repair — they carry the new text's own spacing.
    if (op === 'removed' && last && !/\s$/.test(last.text) && !/^\s/.test(text)) {
      parts.push({ op, text: ` ${text}` });
      return;
    }
    parts.push({ op, text });
  };

  // Unchanged runs are emitted from the NEW token stream, not the old one.
  // The two agree on words but not necessarily on the whitespace trailing them:
  // appending a sentence turns "…times." into "…times. ", and rendering the old
  // token there would silently swallow the space before the addition.
  push('same', b.slice(0, prefix).join(''));

  if (aMid.length && bMid.length) {
    const n = aMid.length;
    const m = bMid.length;
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);

    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] =
          key(aMid[i]) === key(bMid[j])
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (key(aMid[i]) === key(bMid[j])) {
        // Keep the NEW spelling so casing/whitespace changes survive the render.
        push('same', bMid[j]);
        i++;
        j++;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        push('removed', aMid[i++]);
      } else {
        push('added', bMid[j++]);
      }
    }
    while (i < n) push('removed', aMid[i++]);
    while (j < m) push('added', bMid[j++]);
  } else {
    push('removed', aMid.join(''));
    push('added', bMid.join(''));
  }

  push('same', suffix > 0 ? b.slice(b.length - suffix).join('') : '');
  return parts;
}
