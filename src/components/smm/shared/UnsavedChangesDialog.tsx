'use client';

import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/**
 * Three-way guard shown when the user tries to navigate away with unsaved
 * changes: continue without saving, save first, or cancel and stay.
 */
export function UnsavedChangesDialog({
  open,
  onCancel,
  onDiscard,
  onSave,
  saving = false,
}: {
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  saving?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes. Do you want to save them before leaving?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button variant="outline" onClick={onDiscard} disabled={saving}>Continue without saving</Button>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); onSave(); }} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
