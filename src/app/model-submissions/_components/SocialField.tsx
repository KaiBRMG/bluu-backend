'use client';

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { PrefixedInput } from './PrefixedInput';

interface SocialFieldProps {
  label: string;
  /** `@` for Instagram and Twitter, `u/` for Reddit. */
  prefix: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

/**
 * One platform's username, inside the "social media pages" group.
 *
 * A sub-field rather than a full `Field`: the group above already carries the
 * question and the "at least one" rule, so each row needs only enough of a
 * label to say which platform it is. Its caption is therefore a step quieter
 * than a section label, which is what keeps the group reading as one question
 * with four boxes instead of four separate questions.
 */
export function SocialField({
  label,
  prefix,
  placeholder,
  value,
  onChange,
  error,
}: SocialFieldProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {/* One step below the group's own caption, on the surface's single
          de-emphasis value (`white/55`) — the same one the hints use. A fourth
          grey for one role is what the console's One-Grey Rule forbids. */}
      <Label htmlFor={id} className="text-xs font-medium text-white/55">
        {label}
      </Label>
      <PrefixedInput
        id={id}
        prefix={prefix}
        placeholder={placeholder}
        value={value}
        aria-invalid={!!error}
        aria-describedby={errorId}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
