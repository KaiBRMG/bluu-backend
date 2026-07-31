'use client';

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  /** The short grey line under the label — form.md's `[subtext]`. */
  hint?: string;
  optional?: boolean;
  error?: string;
  className?: string;
  /**
   * True when the control is a set of choices (radios) or a composite rather
   * than one focusable input. A `<label for>` pointing at a group is invalid,
   * so the caption renders as plain text and the group is named by it instead.
   */
  group?: boolean;
  /** Receives the wiring every control needs to be announced correctly. */
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => React.ReactNode;
}

/**
 * One labelled control. Owns the label/description/error association so no
 * caller has to remember `aria-describedby`, and reserves no vertical space
 * for the error until there is one (the form must not jump as you fix it —
 * it grows downward from the field you are already looking at).
 */
export function Field({
  label,
  hint,
  optional,
  error,
  className,
  group,
  children,
}: FieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const caption = (
    <>
      {label}
      {optional && <span className="ml-1.5 font-normal text-white/55">Optional</span>}
    </>
  );

  return (
    <div
      className={cn('flex flex-col gap-2', className)}
      {...(group ? { role: 'group', 'aria-labelledby': labelId } : {})}
    >
      <div className="flex flex-col gap-1">
        {group ? (
          <span id={labelId} className="text-sm font-medium text-white">
            {caption}
          </span>
        ) : (
          <Label htmlFor={id} id={labelId} className="text-sm font-medium text-white">
            {caption}
          </Label>
        )}
        {hint && (
          <p id={hintId} className="text-sm leading-snug text-white/55">
            {hint}
          </p>
        )}
      </div>

      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}

      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
