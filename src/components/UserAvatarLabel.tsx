'use client';

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { DeletedUser } from '@/components/DeletedUser';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { cn } from '@/lib/utils';

/**
 * Non-interactive avatar + display name. Unlike {@link UserChip} (a Button),
 * this renders as inline spans, so it can live inside another button — e.g. a
 * collapsible group-header toggle or a calendar post card.
 * - name === 'No One' renders as muted text (unassigned)
 * - empty name renders <DeletedUser /> (user doc no longer exists)
 */
export function UserAvatarLabel({
  name,
  photoURL,
  className,
  size = 'sm',
}: {
  name: string;
  photoURL: string | null;
  className?: string;
  size?: 'sm' | 'md';
}) {
  if (name === 'No One') return <span className="text-muted-foreground text-sm">No One</span>;
  if (!name) return <span className="text-sm"><DeletedUser /></span>;
  const avatarSize = size === 'md' ? 'size-7' : 'size-5';
  const fallbackSize = size === 'md' ? 'text-xs' : 'text-[9px]';
  const nameSize = size === 'md' ? 'text-sm' : 'text-[11px]';
  return (
    <span className={cn('flex items-center gap-1.5 min-w-0', className)}>
      <Avatar className={cn('shrink-0', avatarSize)} style={{ background: getAvatarColor(name) }}>
        {photoURL && <AvatarImage src={photoURL} alt={name} />}
        <AvatarFallback className={fallbackSize} style={{ background: getAvatarColor(name), color: '#fff' }}>
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      <span className={cn('truncate', nameSize)}>{name}</span>
    </span>
  );
}
