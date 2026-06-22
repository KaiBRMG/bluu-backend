import type { ReactNode } from 'react';

/**
 * Italic placeholder rendered wherever a deleted user's name can no longer be
 * resolved. Deleted users are removed from the `users` collection, so any shared
 * record that still references their UID (disputes, campaign-tracking,
 * notification batches, etc.) would otherwise display the raw UID.
 */
export function DeletedUser({ className }: { className?: string }) {
  return <em className={className ? `italic ${className}` : 'italic'}>Deleted User</em>;
}

/**
 * Resolve a UID to its display name, falling back to an italic "Deleted User"
 * label when the UID is no longer present in the supplied name map. Returns
 * `null` for an empty UID so never-set fields (e.g. an unedited `lastEditedBy`)
 * render nothing rather than "Deleted User".
 */
export function resolveUserName(
  uid: string | null | undefined,
  names: Record<string, string>,
): ReactNode {
  if (!uid) return null;
  return names[uid] ?? <DeletedUser />;
}
