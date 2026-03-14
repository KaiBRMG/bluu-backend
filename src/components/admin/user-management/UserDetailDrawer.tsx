"use client";

import type { AdminFullUser, AdminGroup } from '@/hooks/useAdminUsers';
import UserDetailContent from './UserDetailContent';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface UserDetailDrawerProps {
  userId: string | null;
  users: AdminFullUser[];
  groups: AdminGroup[];
  onClose: () => void;
  onUpdateUser: (uid: string, updates: Record<string, unknown>) => Promise<void>;
  onAddGroupMembers: (groupId: string, uids: string[]) => Promise<void>;
  onRemoveGroupMember: (groupId: string, uid: string) => Promise<void>;
  onRefetch: () => Promise<void>;
}

export default function UserDetailDrawer({
  userId,
  users,
  onClose,
  onUpdateUser,
  onAddGroupMembers,
  onRemoveGroupMember,
  onRefetch,
}: UserDetailDrawerProps) {
  const user = userId ? users.find((u) => u.uid === userId) ?? null : null;

  return (
    <Sheet open={!!userId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-[500px] sm:max-w-[500px] overflow-y-auto p-0">
        <SheetHeader className="sticky top-0 z-10 px-6 py-4" style={{ background: 'var(--background)', borderBottom: '1px solid var(--border-subtle)' }}>
          <SheetTitle>
            {user
              ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName
              : 'User Details'}
          </SheetTitle>
        </SheetHeader>

        {user && (
          <UserDetailContent
            key={user.uid}
            user={user}
            onUpdateUser={onUpdateUser}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
