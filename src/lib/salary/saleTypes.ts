/**
 * One vocabulary for "what kind of sale is this", shared by both sources.
 *
 * Infloww labels a row `Messages` / `Tips from messages` / `Tips from posts` /
 * `Tips from profile` / `Tips`; BuddyX labels a tip `tips_messages` /
 * `tips_posts` / `tips_profile` and sends no `type` on a PPV at all. Stored and
 * displayed, they are the BuddyX spelling, so a month that spans the cutover
 * has one type column rather than two vocabularies for the same thing.
 *
 * Pure and dependency-free: the importer, the sync, the serialiser and the UI
 * all read it.
 */
import { salesSourceFor, type SaleKind, type SalesSource } from './salaryConstants';

export const SALE_TYPES = ['tips_messages', 'tips_posts', 'tips_profile', 'tips', 'ppv'] as const;
export type SaleType = (typeof SALE_TYPES)[number];

const INFLOWW_TYPES: Record<string, SaleType> = {
  messages: 'ppv',
  'tips from messages': 'tips_messages',
  'tips from posts': 'tips_posts',
  'tips from profile': 'tips_profile',
  tips: 'tips',
};

/**
 * Any spelling → the stored vocabulary. An unrecognised value is returned
 * lower-cased rather than guessed: a new label the provider adds later should
 * show up as itself on the report, not be silently filed under the wrong type.
 */
export function normaliseSaleType(raw: string): string {
  const text = (raw ?? '').trim().toLowerCase();
  if (text === '') return 'tips';
  if ((SALE_TYPES as readonly string[]).includes(text)) return text;
  return INFLOWW_TYPES[text] ?? text;
}

/** Only `ppv` is a PPV; every tip type, and anything unrecognised that starts `tip`, is a tip. */
export function kindForSaleType(raw: string): SaleKind {
  return normaliseSaleType(raw) === 'ppv' ? 'ppv' : 'tip';
}

/**
 * A stored row's kind and source, defaulting the rows written before the BuddyX
 * integration (which carry neither). The one place the legacy rule lives — the
 * serialiser, the dispute rules and the fan rollups all ask here.
 */
export function saleKindOf(doc: { kind?: SaleKind | null; type?: string | null }): SaleKind {
  return doc.kind ?? kindForSaleType(doc.type ?? '');
}

export function saleSourceOf(doc: { source?: SalesSource | null }, occurredAtMs: number): SalesSource {
  return doc.source ?? salesSourceFor(occurredAtMs);
}

const LABELS: Record<string, string> = {
  tips_messages: 'Tip · message',
  tips_posts: 'Tip · post',
  tips_profile: 'Tip · profile',
  tips: 'Tip',
  ppv: 'PPV',
};

/** The label the ledger and the "By type" card show. */
export function saleTypeLabel(type: string): string {
  return LABELS[normaliseSaleType(type)] ?? type;
}
