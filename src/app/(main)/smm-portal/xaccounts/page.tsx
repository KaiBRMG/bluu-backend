'use client';

import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { ViralAccountsTable } from '@/components/smm/xaccounts/ViralAccountsTable';
import { LinkUsageChecker } from '@/components/smm/xaccounts/LinkUsageChecker';
import { SubmitSuggestionDialog } from '@/components/smm/xaccounts/SubmitSuggestionDialog';
import { useSmmAccounts } from '@/hooks/useSmmAccounts';

/**
 * Viral Accounts (`smm-xaccounts`) — the accounts SMMs may copy viral posts
 * from, grouped by network, plus the page-suggestion entry point. Approving a
 * suggestion happens in Admin → Bonus Management.
 */
export default function SmmViralAccountsPage() {
  const { accounts, loading } = useSmmAccounts('viral');
  const [suggestOpen, setSuggestOpen] = useState(false);

  return (
    <AppLayout>
      <div className="max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Viral Accounts</h1>
            <p className="text-sm text-muted-foreground">
              Accounts you may copy viral posts from. Copied posts earn half the bonus.
            </p>
          </div>
          <Button onClick={() => setSuggestOpen(true)}>
            <PlusIcon className="size-4" />
            Submit Page Suggestion
          </Button>
        </div>

        <LinkUsageChecker />

        <ViralAccountsTable accounts={accounts} loading={loading} />
      </div>

      <SubmitSuggestionDialog
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        accounts={accounts}
      />
    </AppLayout>
  );
}
