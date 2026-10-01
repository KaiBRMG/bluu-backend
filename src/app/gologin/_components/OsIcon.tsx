'use client';

import { IconBrandApple, IconBrandWindows } from '@tabler/icons-react';
import { goLoginOsLabel } from '@/lib/gologin/types';

/**
 * The same Tabler marks the `/download` page uses for its platforms. Windows
 * and macOS only — the only two OSes this team's profiles use, and the only two
 * New Profile offers.
 */
const MARK = {
  win: IconBrandWindows,
  mac: IconBrandApple,
} as const;

/**
 * A profile's OS as its platform mark rather than the word.
 *
 * A mark is read faster than "Windows" in a line of 11px meta, and it is the
 * same one the download page uses, so the window speaks the product's own
 * vocabulary. The full label — including the variant a mark cannot show
 * (Windows 10 vs 11, Apple M1 vs Intel) — is the accessible name and the hover
 * title. Anything else (a profile made in GoLogin's own app for another OS)
 * renders nothing: it is not a platform this team uses, and a guessed mark
 * would be worse than none.
 */
export default function OsIcon({
  os,
  osSpec = '',
  className = 'size-3.5',
}: {
  os: string;
  osSpec?: string;
  className?: string;
}) {
  const Mark = MARK[os as keyof typeof MARK];
  if (!Mark) return null;
  const label = goLoginOsLabel(os, osSpec);
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center">
      <Mark className={className} stroke={1.75} aria-hidden />
    </span>
  );
}
