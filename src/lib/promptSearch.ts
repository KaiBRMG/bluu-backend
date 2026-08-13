/**
 * The Prompt Library search engine.
 *
 * Runs entirely on the client over the already-cached prompt list, so typing
 * costs zero Firestore reads. It covers every field the library exposes — LLM,
 * category, title, tags, prompt text, the two people, and both dates — and is
 * forgiving: multiple words are AND-ed, each word may match a different field,
 * and a word that matches nothing exactly falls back to a bounded edit-distance
 * match so "imge genertion" still finds "Image Generation".
 */

import type { PromptDocument } from '@/types/promptLibrary';
import { LLM_META } from '@/types/promptLibrary';

// Field weights. Ordered by how deliberately a person put the word there: a
// title is chosen, prompt text is written at length.
const WEIGHT = {
  title: 6,
  category: 4,
  tags: 4,
  llm: 3,
  people: 3,
  date: 3,
  text: 2,
} as const;

export type MatchField = keyof typeof WEIGHT;

// Match quality multipliers, best to worst.
const EXACT = 1;
const PREFIX = 0.85;
const SUBSTRING = 0.7;
const FUZZY = 0.45;

export interface PromptSearchHit {
  prompt: PromptDocument;
  score: number;
  /** Which fields carried the match, for the "matched in" affordance. */
  fields: MatchField[];
  /** A window of prompt text around the first hit, or '' when text didn't match. */
  snippet: string;
}

interface FieldIndex {
  /** Whole-field lowercase value, for exact/substring tests. */
  value: string;
  /** Deduped lowercase words, for prefix and fuzzy tests. */
  words: string[];
}

interface PromptIndex {
  id: string;
  stamp: string;
  prompt: PromptDocument;
  fields: Record<MatchField, FieldIndex>;
  /** Original-case text, for snippet extraction. */
  rawText: string;
}

function words(value: string): string[] {
  const seen = new Set<string>();
  for (const w of value.toLowerCase().split(/[^a-z0-9]+/i)) {
    if (w) seen.add(w);
  }
  return Array.from(seen);
}

function field(value: string): FieldIndex {
  return { value: value.toLowerCase(), words: words(value) };
}

/**
 * Every way someone might reasonably type a date: "13 aug 2026", "august",
 * "2026-08-13", "13/08/2026", "thursday". Cheap to build, and it means the
 * search box handles a date without a separate date filter.
 */
function dateStrings(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    d.toLocaleDateString('en-US', { weekday: 'long' }),
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
  ].join(' ');
}

/**
 * Edit distance with an early bail. Only ever called against short field words,
 * never against a whole prompt, so the quadratic cost is bounded by word length.
 */
function withinDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;

  let prev = new Uint8Array(b.length + 1);
  let curr = new Uint8Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return false;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] <= max;
}

function fuzzyBudget(term: string): number {
  if (term.length < 4) return 0;
  return term.length <= 6 ? 1 : 2;
}

/** Best match quality of one term against one field, or 0 for no match. */
function scoreField(term: string, idx: FieldIndex, allowFuzzy: boolean): number {
  if (!idx.value) return 0;
  if (idx.value === term) return EXACT;

  for (const w of idx.words) {
    if (w === term) return EXACT;
  }
  for (const w of idx.words) {
    if (w.startsWith(term)) return PREFIX;
  }
  if (idx.value.includes(term)) return SUBSTRING;

  if (allowFuzzy) {
    const budget = fuzzyBudget(term);
    if (budget > 0) {
      for (const w of idx.words) {
        if (withinDistance(term, w, budget)) return FUZZY;
      }
    }
  }
  return 0;
}

/**
 * Splits a query into terms, honouring "quoted phrases" as single terms so an
 * exact phrase can still be demanded.
 */
export function parseQuery(query: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    const term = (m[1] ?? m[2]).trim().toLowerCase();
    if (term) terms.push(term);
  }
  return terms;
}

function buildIndex(
  prompt: PromptDocument,
  resolveName: (uid: string) => string
): PromptIndex {
  const people = `${resolveName(prompt.createdBy)} ${resolveName(prompt.lastUpdatedBy)}`;
  const dates = `${dateStrings(prompt.createdTime)} ${dateStrings(prompt.lastUpdatedTime)}`;
  return {
    id: prompt.id,
    // Name resolution arrives asynchronously, so it is part of the cache key.
    stamp: `${prompt.lastUpdatedTime}|${prompt.version}|${people}`,
    prompt,
    rawText: prompt.text,
    fields: {
      title: field(prompt.title),
      category: field(prompt.category),
      tags: field(prompt.tags.join(' ')),
      llm: field(LLM_META[prompt.llmType]?.name ?? prompt.llmType),
      people: field(people),
      date: field(dates),
      text: field(prompt.text),
    },
  };
}

/**
 * Memoised across keystrokes: typing re-runs scoring, never re-tokenisation.
 * Keyed by prompt id and invalidated by the version/name stamp.
 */
export class PromptSearchIndex {
  private entries = new Map<string, PromptIndex>();

  sync(prompts: PromptDocument[], resolveName: (uid: string) => string): PromptIndex[] {
    const live = new Set<string>();
    const out: PromptIndex[] = [];

    for (const p of prompts) {
      live.add(p.id);
      const existing = this.entries.get(p.id);
      const next =
        existing && existing.stamp === buildStamp(p, resolveName)
          ? existing
          : buildIndex(p, resolveName);
      this.entries.set(p.id, next);
      out.push(next);
    }
    for (const id of this.entries.keys()) {
      if (!live.has(id)) this.entries.delete(id);
    }
    return out;
  }
}

function buildStamp(prompt: PromptDocument, resolveName: (uid: string) => string): string {
  return `${prompt.lastUpdatedTime}|${prompt.version}|${resolveName(prompt.createdBy)} ${resolveName(prompt.lastUpdatedBy)}`;
}

const SNIPPET_RADIUS = 90;

function snippetFor(entry: PromptIndex, terms: string[]): string {
  const lower = entry.fields.text.value;
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return '';

  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(entry.rawText.length, at + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${entry.rawText.slice(start, end).trim()}${end < entry.rawText.length ? '…' : ''}`;
}

const ALL_FIELDS = Object.keys(WEIGHT) as MatchField[];

/**
 * Scores every prompt against the query. A prompt survives only if EVERY term
 * matched something somewhere (so extra words narrow rather than widen), but
 * each term is free to match a different field.
 */
export function searchPrompts(
  entries: PromptIndex[],
  query: string,
  limit = Infinity
): PromptSearchHit[] {
  const terms = parseQuery(query);
  if (terms.length === 0) return [];

  const hits: PromptSearchHit[] = [];

  for (const entry of entries) {
    let total = 0;
    const matched = new Set<MatchField>();
    let everyTermMatched = true;

    for (const term of terms) {
      let best = 0;
      let bestField: MatchField | null = null;

      for (const f of ALL_FIELDS) {
        // Fuzzy is skipped on prompt text: a long body would otherwise match
        // almost any typo by chance, and substring already covers partials.
        const quality = scoreField(term, entry.fields[f], f !== 'text');
        if (quality === 0) continue;
        const weighted = quality * WEIGHT[f];
        if (weighted > best) {
          best = weighted;
          bestField = f;
        }
      }

      if (best === 0) {
        everyTermMatched = false;
        break;
      }
      total += best;
      if (bestField) matched.add(bestField);
    }

    if (!everyTermMatched) continue;

    // A prompt whose title alone answers the whole query beats one that needed
    // three different fields to cover it.
    if (matched.size === 1 && terms.length > 1) total *= 1.15;

    hits.push({
      prompt: entry.prompt,
      score: total,
      fields: ALL_FIELDS.filter(f => matched.has(f)),
      snippet: matched.has('text') ? snippetFor(entry, terms) : '',
    });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      new Date(b.prompt.lastUpdatedTime).getTime() - new Date(a.prompt.lastUpdatedTime).getTime()
  );

  return limit === Infinity ? hits : hits.slice(0, limit);
}

export const MATCH_FIELD_LABEL: Record<MatchField, string> = {
  title: 'title',
  category: 'category',
  tags: 'tag',
  llm: 'model',
  people: 'person',
  date: 'date',
  text: 'prompt text',
};
