'use client';

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DeletedUser } from '@/components/DeletedUser';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';

/**
 * Avatar + display name pill. Promoted from DisputeTable for reuse across
 * the disputes and SMM tables.
 * - name === 'No One' renders as muted text (unassigned disputes/accounts)
 * - empty name renders <DeletedUser /> (user doc no longer exists)
 */
export function UserChip({ name, photoURL }: { name: string; photoURL: string | null }) {
  if (name === 'No One') return <span className="text-muted-foreground text-sm">No One</span>;
  if (!name) return <span className="text-sm"><DeletedUser /></span>;
  return (
    <Button variant="outline" className="rounded-full p-0! pe-3! h-8 gap-0 text-sm font-normal">
      <Avatar className="size-7" style={{ background: getAvatarColor(name) }}>
        {photoURL && <AvatarImage src={photoURL} alt={name} />}
        <AvatarFallback className="text-xs" style={{ background: getAvatarColor(name), color: '#fff' }}>{getInitials(name)}</AvatarFallback>
      </Avatar>
      <span className="pl-1.5">{name}</span>
    </Button>
  );
}
