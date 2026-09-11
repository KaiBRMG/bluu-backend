'use client';

import { Button } from '@/components/ui/button';

/**
 * A dead end with an explanation, and the window's only full-screen message.
 *
 * Used for the states this window cannot act on from inside itself — usually the
 * remedy is a person, not a button. **One component, deliberately**: the guard
 * and the page each had their own copy, and they had already drifted (one set
 * `text-white` on the heading, the other inherited), which is exactly how two
 * spellings of one screen become two different screens.
 *
 * `action` is for the cases that *are* worth a control: a transient failure to
 * reach the server, or a key that has to be replaced. A seat you do not have
 * will not appear because you clicked, so it stays opt-in rather than always
 * present.
 */
export default function Notice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void; variant?: 'primary' | 'outline' };
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background px-8 text-center">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <p className="max-w-[52ch] text-sm text-zinc-400">{body}</p>
      {action && (
        <Button
          size="sm"
          variant={action.variant === 'primary' ? 'default' : 'outline'}
          className={
            action.variant === 'primary'
              ? 'mt-2 bg-[#2563eb] text-white hover:bg-[#1d4ed8]'
              : 'mt-2'
          }
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
