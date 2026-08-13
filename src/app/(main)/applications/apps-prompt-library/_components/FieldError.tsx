'use client';

/**
 * A field-level validation message. Red is doing semantic work here — it marks
 * an error state, which is what the palette reserves it for — and the message
 * is wired to its field by `aria-describedby`, so the reason travels with the
 * control rather than living only in the colour of a border.
 */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-red-400">
      {message}
    </p>
  );
}
