'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/smm/shared/ConfirmDialog';
import { LinkWithCopy } from '@/components/smm/shared/LinkWithCopy';
import { UserAvatarLabel } from '@/components/UserAvatarLabel';
import { useSmmSuggestions } from '@/hooks/useSmmSuggestions';
import type { SmmPageSuggestion } from '@/types/firestore';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5 min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm break-words">{children}</div>
    </div>
  );
}

/**
 * Viral Page Suggestions — pending nominations from the Viral Accounts page.
 * Approve flags the named account `isViralBonus`; if no such account exists the
 * admin is warned and may create it from the suggestion. Deny hides it for good.
 */
export function SuggestionsSection() {
  const { fetchPending, reviewSuggestion } = useSmmSuggestions();

  const [suggestions, setSuggestions] = useState<SmmPageSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SmmPageSuggestion | null>(null);
  const [missingAccount, setMissingAccount] = useState<SmmPageSuggestion | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSuggestions(await fetchPending());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }, [fetchPending]);

  useEffect(() => { load(); }, [load]);

  const review = async (
    suggestion: SmmPageSuggestion,
    action: 'approve' | 'deny',
    createAccount = false,
  ) => {
    setWorking(true);
    try {
      const res = await reviewSuggestion(suggestion.id, action, createAccount);
      // Approve found no matching account — ask before creating one.
      if (res.accountMissing) {
        setSelected(null);
        setMissingAccount(suggestion);
        return;
      }
      toast.success(
        action === 'deny' ? 'Suggestion denied'
          : res.created ? `Account created and marked as a viral account`
          : 'Account marked as a viral account',
      );
      setSelected(null);
      setMissingAccount(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update suggestion');
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Viral Page Suggestions</h2>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending suggestions.</p>
      ) : (
        <div className="rounded-lg border divide-y">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-all hover:brightness-110 active:scale-[0.98]"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.accountName}</span>
              <UserAvatarLabel name={s.submittedByName ?? ''} photoURL={s.submittedByPhotoURL ?? null} />
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected?.accountName}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <Field label="Account link"><LinkWithCopy url={selected.accountLink} /></Field>
              <Field label="Submitted by">{selected.submittedByName || '—'}</Field>
              <Field label="Submitted">
                {selected.submissionDate ? format(new Date(selected.submissionDate), 'PPp') : '—'}
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="text-red-600 border-red-600/40 hover:bg-red-50 dark:hover:bg-red-950"
              disabled={working}
              onClick={() => selected && review(selected, 'deny')}
            >
              Deny
            </Button>
            <Button disabled={working} onClick={() => selected && review(selected, 'approve')}>
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!missingAccount}
        onOpenChange={(open) => !open && setMissingAccount(null)}
        title={`${missingAccount?.accountName} is not in the account database`}
        description="No account with this name exists. Continue to create it from the suggestion — every other field is left blank for you to fill in from the Account Database."
        confirmLabel="Create account"
        onConfirm={() => { if (missingAccount) review(missingAccount, 'approve', true); }}
      />
    </section>
  );
}
