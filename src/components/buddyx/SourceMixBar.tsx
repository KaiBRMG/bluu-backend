'use client';

import { SOURCE_MIX_COLORS } from '@/lib/buddyx/chartColors';
import { formatUsd } from '@/lib/salary/salaryFormat';

/**
 * Subscriptions / tips / messages as one three-segment bar — where a creator's
 * money comes from, at a glance. The three hues are the validated
 * `SOURCE_MIX_COLORS`; the split is also in the accessible name, so the bar is
 * never the only carrier of the figures.
 */
export function SourceMixBar({ subs, tips, messages }: { subs: number; tips: number; messages: number }) {
  const total = Math.max(subs, 0) + Math.max(tips, 0) + Math.max(messages, 0);
  const pct = (v: number) => (total > 0 ? `${(Math.max(v, 0) / total) * 100}%` : '0%');
  return (
    <span
      className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-white/[0.06]"
      role="img"
      aria-label={`Subscriptions ${formatUsd(subs)}, tips ${formatUsd(tips)}, messages ${formatUsd(messages)}`}
    >
      <span style={{ width: pct(subs), background: SOURCE_MIX_COLORS.subs }} />
      <span style={{ width: pct(tips), background: SOURCE_MIX_COLORS.tips }} />
      <span style={{ width: pct(messages), background: SOURCE_MIX_COLORS.messages }} />
    </span>
  );
}
