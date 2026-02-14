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

// Deterministic color palette (soft, muted tones similar to Notion/Google)
const AVATAR_COLORS = [
  '#E57373', // red
  '#F06292', // pink
  '#BA68C8', // purple
  '#7986CB', // indigo
  '#64B5F6', // blue
  '#4DD0E1', // cyan
  '#4DB6AC', // teal
  '#81C784', // green
  '#FFB74D', // orange
  '#A1887F', // brown
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function getAvatarColor(name: string): string {
  const index = hashString(name) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

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

  const bgColor = getAvatarColor(name || 'User');

  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center font-semibold ${className}`}
      style={{ background: bgColor }}
    >
      <span style={{ color: '#ffffff' }}>
        {getInitials(name)}
      </span>
    </div>
  );
}
