'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2Icon, PlusIcon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parsePostLink } from '@/lib/growth/postLink';

/**
 * The primary way a post gets tracked: paste its link.
 *
 * It is a permanent bar rather than a button that opens a dialog. This is the
 * page's main verb — someone arrives here holding a link — and putting the one
 * action people came to do behind a modal is the "modal as first thought"
 * anti-pattern the product register bans outright. It also makes the tab's
 * purpose legible before any data loads.
 *
 * ── The wait is real and is not hidden ──────────────────────────────────────
 * Adding fires a live scraper call, so it takes 10–30 seconds, and the add is
 * all-or-nothing: a link the actor cannot resolve writes nothing. The pending
 * state therefore says what is happening rather than showing a bare spinner, and
 * the input stays mounted with its value intact so a failure leaves the user
 * exactly where they were.
 */
export function TrackPostBar({
  onTrack,
  disabled,
}: {
  onTrack: (url: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Parsed locally purely to enable the button; the server parses again and is
  // the authority. This is affordance, not validation.
  const looksValid = value.trim().length > 0 && parsePostLink(value) !== null;
  const looksWrong = value.trim().length > 0 && !looksValid;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!looksValid || pending) return;

    setPending(true);
    setError(null);
    try {
      await onTrack(value);
      setValue('');
      toast.success('Tracking that post. Its first refresh is already in.');
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not track that post.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor="track-post-url" className="sr-only">X post link</label>
          <Input
            id="track-post-url"
            ref={inputRef}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            disabled={disabled || pending}
            placeholder="Paste an X post link — https://x.com/handle/status/…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={looksWrong || error !== null}
            aria-describedby={error ? 'track-post-error' : looksWrong ? 'track-post-hint' : undefined}
            className="h-10"
          />
        </div>
        <Button type="submit" disabled={!looksValid || pending || disabled} className="h-10 shrink-0">
          {pending ? (
            <>
              <Loader2Icon className="activity-spinner size-4 animate-spin" aria-hidden />
              Tracking post…
            </>
          ) : (
            <>
              <PlusIcon className="size-4" aria-hidden />
              Track post
            </>
          )}
        </Button>
      </div>

      {/* Live region: the result of a 30-second wait must be announced, not just
          painted. `polite` because it never interrupts anything urgent. */}
      <div aria-live="polite" className="min-h-0">
        {error && (
          <p id="track-post-error" className="flex items-start gap-2 text-sm text-red-400">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {!error && looksWrong && (
          <p id="track-post-hint" className="text-sm text-zinc-400">
            That is not an X post link yet. It should look like{' '}
            <span className="font-mono text-zinc-300">x.com/handle/status/1839…</span>
          </p>
        )}
      </div>
    </form>
  );
}
