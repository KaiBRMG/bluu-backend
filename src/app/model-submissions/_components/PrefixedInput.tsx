'use client';

import { cn } from '@/lib/utils';
import { FIELD } from '../_lib/theme';

interface PrefixedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** The fixed, non-editable lead-in: `@` for a handle, `u/` for Reddit. */
  prefix: string;
}

/**
 * A username box behind its platform's prefix.
 *
 * The prefix is chrome, not content: the applicant types `bluurock` and the
 * schema builds `https://www.instagram.com/bluurock` from it. Showing the `@`
 * or `u/` in the affix is what makes "just the username" self-evident, which is
 * cheaper than explaining it and far cheaper than parsing whatever a URL paste
 * would have produced.
 *
 * It is `aria-hidden` — a screen reader reading "at bluurock" as the field's
 * value would be wrong, and the field's own label plus its hint already carry
 * the meaning.
 */
export function PrefixedInput({ prefix, className, ...props }: PrefixedInputProps) {
  return (
    <div className="flex items-stretch">
      {/* `white/55`, not the `white/45` this affix used to be inlined at: on
          the affix's own `white/[0.06]` ground that measured 3.99:1 and failed
          AA for 16px text. aria-hidden does not exempt visible text. */}
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-l-xl border border-r-0 border-white/[0.10] bg-white/[0.06] px-3.5 text-base text-white/55"
      >
        {prefix}
      </span>
      <input
        {...props}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(FIELD, 'rounded-l-none', className)}
      />
    </div>
  );
}
