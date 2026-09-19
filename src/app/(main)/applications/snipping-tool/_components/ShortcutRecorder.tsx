'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatSnipShortcut, isValidSnipShortcut } from '@/lib/snips';

/**
 * Maps a `KeyboardEvent` to an Electron accelerator.
 *
 * `event.code` rather than `event.key`, because `key` is the *character the
 * layout produces* — on an AZERTY keyboard `Shift+A` arrives as `Q`, and on any
 * layout a modified key can arrive as a dead key or an empty string. `code` is
 * the physical key, which is what a global accelerator binds to.
 */
function acceleratorFrom(event: React.KeyboardEvent): string | null {
  const modifiers: string[] = [];
  // `CommandOrControl` collapses ⌘ and Ctrl into one binding, which is what
  // makes a shortcut chosen on one platform work on the other. Meta and Control
  // are therefore folded together rather than recorded separately.
  if (event.metaKey || event.ctrlKey) modifiers.push('CommandOrControl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');

  const code = event.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (code === 'Space') key = 'Space';
  else if (code === 'Enter') key = 'Return';
  else if (code === 'Tab') key = 'Tab';

  if (!key || modifiers.length === 0) return null;
  return [...modifiers, key].join('+');
}

/**
 * Records a global shortcut by listening for one.
 *
 * A key-combination field, not a text input: typing `Cmd+Shift+S` into a box is
 * a transcription exercise, and what gets stored has to be an accelerator the OS
 * will accept rather than whatever the user wrote.
 *
 * While recording, the field swallows every keystroke (`preventDefault` +
 * `stopPropagation`) so the combination being *chosen* does not also fire
 * whatever it is currently bound to inside the app.
 */
export function ShortcutRecorder({
  value,
  onChange,
  disabled,
  platform,
}: {
  value: string;
  onChange: (accelerator: string) => void;
  disabled?: boolean;
  platform: 'darwin' | 'other';
}) {
  const [recording, setRecording] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Recording holds the keyboard, so it must not be possible to walk away and
  // leave it armed — clicking elsewhere ends it, exactly like Escape.
  useEffect(() => {
    if (!recording) return;
    const stop = () => setRecording(false);
    window.addEventListener('blur', stop);
    return () => window.removeEventListener('blur', stop);
  }, [recording]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!recording) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setRecording(false);
        return;
      }
      // A bare modifier is the user still on their way to a combination, not a
      // choice — keep listening rather than rejecting it.
      if (['Shift', 'Control', 'Alt', 'Meta', 'OS'].includes(event.key)) return;

      const accelerator = acceleratorFrom(event);
      if (!accelerator || !isValidSnipShortcut(accelerator)) return;

      onChange(accelerator);
      setRecording(false);
      buttonRef.current?.blur();
    },
    [onChange, recording],
  );

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      aria-label={recording ? 'Press a key combination' : `Shortcut: ${formatSnipShortcut(value, platform)}. Click to change.`}
      onClick={() => setRecording(r => !r)}
      onKeyDown={handleKeyDown}
      onBlur={() => setRecording(false)}
      className="h-7 min-w-[7.5rem] font-mono text-xs"
    >
      {recording ? 'Press keys…' : formatSnipShortcut(value, platform)}
    </Button>
  );
}
