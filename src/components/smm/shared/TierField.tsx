'use client';

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { isBonusAccountType } from '@/types/firestore';
import type { SmmTier } from '@/types/firestore';

/** Tier is required for a bonus account and forbidden for anything else. */
export function tierError(type: string[], tier: SmmTier | null): string | null {
  if (!isBonusAccountType(type)) return null;
  return tier ? null : 'Bonus accounts must have a tier.';
}

/**
 * The tier control, shared by Add Account and the account edit dialog. Tier is
 * meaningless off a bonus account (it only drives bonus payouts), so it is
 * greyed out until 'Bonus' is one of the account's types — and required once
 * it is.
 */
export function TierField({
  type,
  tier,
  onChange,
  hideLabel = false,
}: {
  type: string[];
  tier: SmmTier | null;
  onChange: (tier: SmmTier | null) => void;
  hideLabel?: boolean; // the caller already renders a label (e.g. AccountDialog's Field)
}) {
  const bonus = isBonusAccountType(type);
  const error = tierError(type, tier);

  return (
    <div className="space-y-1.5">
      {!hideLabel && <Label>Tier</Label>}
      <Select
        value={tier ? String(tier) : ''}
        onValueChange={(v) => onChange(Number(v) as SmmTier)}
        disabled={!bonus}
      >
        <SelectTrigger className="w-full" aria-invalid={!!error}>
          <SelectValue placeholder={bonus ? 'Select tier' : 'No tier'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">Tier 1</SelectItem>
          <SelectItem value="2">Tier 2</SelectItem>
        </SelectContent>
      </Select>
      {!bonus ? (
        <p className="text-xs text-muted-foreground">
          Only bonus accounts can have a tier, set this in Type
        </p>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

/** "Viral Account" toggle — shared by Add Account and the account edit dialog. */
export function ViralAccountField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch id={id} checked={value} onCheckedChange={onChange} />
        <Label htmlFor={id}>Viral Account</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Set to true if this an account that SMMs may use to copy viral posts from for bonus
      </p>
    </div>
  );
}
