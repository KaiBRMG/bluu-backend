"use client";

import { useCallback, useState } from 'react';
import type { AdminFullUser } from '@/hooks/useAdminUsers';
import UserDetailContent from './UserDetailContent';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface UserDetailDrawerProps {
  userId: string | null;
  users: AdminFullUser[];
  onClose: () => void;
  onUpdateUser: (uid: string, updates: Record<string, unknown>) => Promise<void>;
  onRefetch: () => Promise<void>;
  onDeleteUser?: () => Promise<void>;
}

export default function UserDetailDrawer({
  userId,
  users,
  onClose,
  onUpdateUser,
  onRefetch,
  onDeleteUser,
}: UserDetailDrawerProps) {
  const user = userId ? users.find((u) => u.uid === userId) ?? null : null;
  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // No reset effect needed: UserDetailContent is keyed by uid, so switching users
  // remounts it and its change-detection reports `false` straight back up.

  /** Close without the guard — for flows that have already committed (archive, delete). */
  const forceClose = useCallback(() => {
    setIsDirty(false);
    setShowDiscardConfirm(false);
    onClose();
  }, [onClose]);

  // Esc, overlay click and the built-in close button all route through here.
  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  };

  const fullName = user
    ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.displayName
    : 'User Details';
  const avatarSeed = user ? user.displayName || fullName || 'User' : 'User';
  const platformLabel =
    user?.appPlatform === 'darwin' ? 'macOS' : user?.appPlatform === 'win32' ? 'Windows' : null;

  return (
    <>
      <Sheet open={!!userId} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="dark flex w-[500px] max-w-full flex-col gap-0 p-0 sm:max-w-[500px]"
        >
          {/* pr-12 clears the Sheet's built-in close button at top-4 right-4. */}
          <SheetHeader className="flex-row items-center gap-3 border-b border-border-subtle py-4 pr-12 pl-6">
            {user && (
              <Avatar className="size-11 shrink-0" style={{ background: getAvatarColor(avatarSeed) }}>
                {user.photoURL && <AvatarImage src={user.photoURL} alt="" />}
                <AvatarFallback
                  style={{ background: getAvatarColor(avatarSeed), color: '#fff' }}
                >
                  {getInitials(avatarSeed)}
                </AvatarFallback>
              </Avatar>
            )}
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-base">{fullName}</SheetTitle>
              <SheetDescription className="truncate text-xs">
                {user ? user.workEmail : 'Select a user to view their record.'}
              </SheetDescription>
              {user && (
                <div className="mt-1.5">
                  {user.appVersion ? (
                    <Badge variant="secondary" className="font-mono text-xs tabular-nums">
                      v{user.appVersion}
                      {platformLabel && <span className="ml-1 opacity-70">{platformLabel}</span>}
                    </Badge>
                  ) : (
                    <span className="text-xs text-zinc-400">App version unknown</span>
                  )}
                </div>
              )}
            </div>
          </SheetHeader>

          {user && (
            <UserDetailContent
              key={user.uid}
              user={user}
              onUpdateUser={onUpdateUser}
              onRefetch={onRefetch}
              onDeleteUser={onDeleteUser}
              onClose={forceClose}
              onDirtyChange={setIsDirty}
            />
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent className="dark">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have edits to this record that have not been saved. Closing the panel will lose them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={forceClose}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
