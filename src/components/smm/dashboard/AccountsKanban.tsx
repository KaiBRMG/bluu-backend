'use client';

import { LinkWithCopy } from '@/components/smm/shared/LinkWithCopy';
import { TypeBadges } from '@/components/smm/shared/badges';
import { Skeleton } from '@/components/ui/skeleton';
import type { SmmAccount } from '@/types/firestore';

/**
 * Single-column stack of the caller's assigned accounts. Clicking the card
 * opens the account dialog; clicking the account name opens its X profile.
 * Empty optional fields (driveLink, comments) are simply omitted.
 */
export function AccountsKanban({
  accounts,
  loading,
  onCardClick,
}: {
  accounts: SmmAccount[];
  loading: boolean;
  onCardClick: (account: SmmAccount) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
        No accounts assigned to you yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.map((account) => (
        <div
          key={account.id}
          role="button"
          tabIndex={0}
          onClick={() => onCardClick(account)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCardClick(account); }}
          className="group cursor-pointer rounded-xl border bg-card p-3 shadow-xs transition-colors hover:border-primary/50 hover:bg-accent/40"
        >
          <div className="flex items-start justify-between gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (account.accountLink) window.open(account.accountLink, '_blank', 'noopener,noreferrer');
              }}
              className="text-sm font-semibold text-left hover:underline underline-offset-4 break-words min-w-0"
            >
              {account.accountName}
            </button>
          </div>

          {account.type.length > 0 && <TypeBadges type={account.type} className="mt-2" />}

          {account.driveLink && (
            <div className="mt-2 min-w-0" onClick={(e) => e.stopPropagation()}>
              <LinkWithCopy url={account.driveLink} label="Drive" className="max-w-full" />
            </div>
          )}

          {account.comments && (
            <p className="mt-2 text-xs text-muted-foreground break-words whitespace-pre-wrap">{account.comments}</p>
          )}
        </div>
      ))}
    </div>
  );
}
