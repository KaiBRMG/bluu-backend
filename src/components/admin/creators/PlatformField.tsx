'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  ACCOUNT_PLATFORMS,
  ACCOUNT_PLATFORM_LABEL,
  isAccountPlatform,
  type AccountPlatform,
} from '@/lib/creators/accountPlatform';

/**
 * The platform an account or sub-account is on. It decides which OnlyFans data
 * maps to the account (lib/creators/accountPlatform.ts), so it is required on
 * create. `value: null` is a legacy account that was never set: it renders as a
 * placeholder rather than defaulting, because a silent default would be a guess.
 */
export function PlatformSelect({
  id,
  value,
  onChange,
  size = 'default',
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: AccountPlatform | null;
  onChange: (next: AccountPlatform) => void;
  size?: 'sm' | 'default';
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={v => isAccountPlatform(v) && onChange(v)} disabled={disabled}>
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        className={cn('border-zinc-700 bg-zinc-800', className)}
      >
        <SelectValue placeholder="Platform" />
      </SelectTrigger>
      <SelectContent>
        {ACCOUNT_PLATFORMS.map(p => (
          <SelectItem key={p} value={p}>
            {ACCOUNT_PLATFORM_LABEL[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Attribute chip (DESIGN.md §5 — greyscale, `rounded-md`): a platform is a label
 * the account carries, not a state. A missing platform says so in words, in the
 * attention orange, because it silently excludes the account from OnlyFans data.
 */
export function PlatformChip({ platform }: { platform: AccountPlatform | null | undefined }) {
  if (!platform) {
    return (
      <span className="rounded-md bg-orange-500/10 px-1.5 py-0.5 text-[11px] font-medium text-orange-300">
        No platform
      </span>
    );
  }
  return (
    <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
      {ACCOUNT_PLATFORM_LABEL[platform]}
    </span>
  );
}
