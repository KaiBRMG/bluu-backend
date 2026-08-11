'use client';

import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/smm/shared/Combobox';
import { useSmmAccounts } from '@/hooks/useSmmAccounts';

/**
 * "Uploaded from" — the creator page whose content the SMM reposted.
 *
 * This is a different account from the page the post goes ON: the tier comes
 * from your own page, but the **network bonus** (Inhouse +$3 / X Managed +$1 /
 * Twink + half the Tier 1 target) is paid for uploading *from* one of those
 * creator lists, and the $2 page-suggestion share goes to whoever suggested
 * this creator. Leaving it blank simply forfeits both.
 *
 * Options are the viral-account list (the creator database SMMs pick from).
 */
export function SourceAccountField({
  value,
  onChange,
  hideLabel = false,
}: {
  value: string;
  onChange: (accountId: string) => void;
  hideLabel?: boolean; // the caller already renders a label
}) {
  const { accounts, loading } = useSmmAccounts('viral');

  return (
    <div className="space-y-1.5">
      {!hideLabel && <Label>Uploaded from (creator page)</Label>}
      <Combobox
        options={accounts.map((a) => ({ value: a.id, label: a.accountName }))}
        value={value}
        onChange={onChange}
        placeholder={loading ? 'Loading creators...' : 'Select creator page'}
        searchPlaceholder="Search creator pages..."
        emptyText="No viral accounts found."
        className="w-full"
      />
      <p className="text-xs text-muted-foreground">
        The creator you reposted from. Your network bonus is based on this page.
      </p>
    </div>
  );
}
