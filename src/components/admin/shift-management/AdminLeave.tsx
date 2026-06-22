'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Info } from 'lucide-react';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface LeaveEdits {
  [uid: string]: {
    remainingUnpaidLeave: number;
    remainingPaidLeave: number;
  };
}

export default function AdminLeave() {
  const { users, loading, error, updateUser } = useAdminUsers();
  const [edits, setEdits] = useState<LeaveEdits>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sortedUsers = users
    .filter(u => !u.isArchived)
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

  // Rebuild baseline whenever users reload (after save)
  useEffect(() => {
    setEdits({});
    setHasChanges(false);
  }, [users]);

  const getValue = useCallback(
    (uid: string, field: 'remainingUnpaidLeave' | 'remainingPaidLeave') => {
      if (edits[uid] !== undefined) return edits[uid][field];
      const user = users.find(u => u.uid === uid);
      return user?.[field] ?? (field === 'remainingPaidLeave' ? 10 : 4);
    },
    [edits, users]
  );

  const handleChange = (
    uid: string,
    field: 'remainingUnpaidLeave' | 'remainingPaidLeave',
    raw: string
  ) => {
    const value = parseInt(raw, 10);
    if (isNaN(value) || value < 0) return;

    const user = users.find(u => u.uid === uid);
    const baseline = {
      remainingUnpaidLeave: user?.remainingUnpaidLeave ?? 4,
      remainingPaidLeave: user?.remainingPaidLeave ?? 10,
    };
    const current = edits[uid] ?? baseline;
    const updated = { ...current, [field]: value };

    setEdits(prev => ({ ...prev, [uid]: updated }));
    setHasChanges(true);
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all(
        Object.entries(edits).map(([uid, values]) =>
          updateUser(uid, {
            remainingUnpaidLeave: values.remainingUnpaidLeave,
            remainingPaidLeave: values.remainingPaidLeave,
          })
        )
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading users...</div>;
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Assign the amount of leave days per user
        </h2>
        {hasChanges && (
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        )}
      </div>

      {saveError && (
        <p className="text-sm text-destructive mb-4">{saveError}</p>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_140px_140px] gap-4 px-3 pb-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Employee</span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Unpaid Leave</span>
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Paid Leave
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="size-3 cursor-default" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-center leading-relaxed">
                Paid leave can be enabled in the user&apos;s profile information in{' '}
                <Link
                  href="/admin/user-management"
                  className="underline hover:opacity-80"
                >
                  User Management &gt; Employee Registry &gt; Time Tracking
                </Link>
              </TooltipContent>
            </Tooltip>
          </span>
        </div>

        {sortedUsers.map(user => (
          <div
            key={user.uid}
            className="grid grid-cols-[1fr_140px_140px] gap-4 items-center rounded-md px-3 py-2"
            style={{ background: 'var(--background)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user.displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{user.workEmail}</p>
            </div>

            <Input
              type="number"
              min={0}
              value={getValue(user.uid, 'remainingUnpaidLeave')}
              onChange={e => handleChange(user.uid, 'remainingUnpaidLeave', e.target.value)}
              className="h-8 text-sm"
            />

            <Input
              type="number"
              min={0}
              value={getValue(user.uid, 'remainingPaidLeave')}
              onChange={e => handleChange(user.uid, 'remainingPaidLeave', e.target.value)}
              disabled={!user.hasPaidLeave}
              className="h-8 text-sm"
            />
          </div>
        ))}

        {sortedUsers.length === 0 && (
          <p className="text-sm text-muted-foreground px-3">No users found.</p>
        )}
      </div>
    </div>
  );
}
