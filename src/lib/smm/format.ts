import { format } from 'date-fns';

/** "$X.XX" — bonusAmount and userTotals must always render with 2 decimals. */
export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Round header date per SMM.md, e.g. "26 April". */
export function formatRoundDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'd MMMM');
}
