"use client";

interface UserAvatarProps {
  photoURL?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-24 h-24 text-2xl',
};

function getInitials(name: string): string {
  if (!name || name.trim() === '') return '?';

  const initials = name
    .split(' ')
    .map(part => part[0])
    .filter(char => char && char.trim() !== '')
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return initials || '?';
}

export default function UserAvatar({ photoURL, name, size = 'md', className = '' }: UserAvatarProps) {
  const sizeClass = sizeClasses[size];

  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt={name || 'User avatar'}
        className={`${sizeClass} rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center font-semibold ${className}`}
      style={{ background: 'var(--hover-background)' }}
    >
      <span style={{ color: 'var(--foreground-secondary)' }}>
        {getInitials(name)}
      </span>
    </div>
  );
}
